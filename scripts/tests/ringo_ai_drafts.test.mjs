// Ringo AI Phase 2 — drafts, Setup Assistant and explicit confirmation. No network, no database,
// no API key: loads the real TypeScript modules through jiti (as ringo_ai_unit.test.mjs does) and
// replaces only the I/O edges (Supabase clients, draft store, provider) with in-memory fakes.
//   * validators: profile/product/event drafts, missing/invalid data, category rules, plan/feature gates
//   * STRICT contact provenance: WhatsApp/phone/email only if the owner typed them in the conversation
//   * draft tools: identity always server-resolved (model-supplied ids ignored), conversation scoping,
//     review card emitted, nothing written to Ringo data
//   * apply pipeline: explicit claim outcomes (replay, double click, revision, expiry), re-validation,
//     plan re-check, stale detection, failure keeps the draft, audit trail, idempotent creates
//   * adapters write through the owner's session client with the editor's columns; events stay unpublished
//   * chat text ("looks good", "yes") can never apply a draft; no apply tool exists
//   * conversation → draft extraction end-to-end through the real orchestrator (fake provider)
//   * EN + FR: translation parity and the real DraftCard rendered in both languages
//
//   Run:  node scripts/tests/ringo_ai_drafts.test.mjs
import path from "path";
import fs from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const load = (p) => jiti(path.join(REPO, "src", p));

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

const { validateProfileDraft, profilePatch, profileUpdateDraft } = load("lib/ai/drafts/profileUpdate.ts");
const { validateProductDraft, productCreateDraft } = load("lib/ai/drafts/productCreate.ts");
const { validateEventDraft, eventCreateDraft } = load("lib/ai/drafts/eventCreate.ts");
const { validateProductUpdateDraft, productUpdateDraft } = load("lib/ai/drafts/productUpdate.ts");
const { phoneFromOwner, emailFromOwner, imageUrlFromOwner } = load("lib/ai/drafts/provenance.ts");
const { looksLikeImage, isOwnAiUploadUrl, extFromMime } = load("lib/ai/uploads.ts");
const { DRAFT_DEFINITIONS } = load("lib/ai/drafts/registry.ts");
const { toDraftView } = load("lib/ai/drafts/view.ts");
const { isSameOriginRequest } = load("lib/ai/drafts/http.ts");
const { AI_TOOLS } = load("lib/ai/tools/index.ts");
const { getAvailableTools, executeTool } = load("lib/ai/tools/registry.ts");
const { translations } = load("lib/i18n/translations.ts");

// ------------------------------------------------------------------ fixtures
const FACTS = (over = {}) => ({ category: "business_ecommerce", categories: ["business_ecommerce"], currency: "XAF", maxProducts: null, productCount: 3, eventCount: 0, ...over });
const CTX = (over = {}, userText = []) => ({ facts: FACTS(over), userText, today: "2026-09-23" });
const P = (over = {}) => ({
  name: null, bio: null, long_bio: null, location: null, category: null, extra_categories: null,
  music_role: null, restaurant_subcategory: null, whatsapp: null, phone: null, email: null, ...over,
});

// ------------------------------------------------------------------ profile draft validation
let v = validateProfileDraft(P({ name: "  Jay K ", bio: "Afrobeats artist from Cameroon." }), CTX());
check("profile: valid name + bio accepted (trimmed)", v.ok && v.payload.name === "Jay K" && v.payload.bio === "Afrobeats artist from Cameroon.");
check("profile: validation is idempotent (payload re-validates to itself)", v.ok && JSON.stringify(validateProfileDraft(v.payload, CTX()).payload) === JSON.stringify(v.payload));
check("profile: nothing to change rejected", validateProfileDraft(P(), CTX()).reason === "nothing_to_change");
check("profile: name over 80 chars rejected", validateProfileDraft(P({ name: "x".repeat(81) }), CTX()).reason === "invalid_input");
check("profile: unknown category id rejected (no second taxonomy)", validateProfileDraft(P({ category: "astrology" }), CTX()).reason === "invalid_input");
check("profile: wrong types rejected", validateProfileDraft(P({ bio: 42 }), CTX()).reason === "invalid_input");
check("profile: music role on a non-music page → feature_unavailable", validateProfileDraft(P({ music_role: "dj" }), CTX()).reason === "feature_unavailable");
v = validateProfileDraft(P({ category: "music_entertainment", music_role: "dj" }), CTX());
check("profile: music role OK when the draft makes the page Music & Entertainment", v.ok);
check("profile: restaurant sub-type needs Restaurant & Food", validateProfileDraft(P({ restaurant_subcategory: "cafe" }), CTX()).reason === "feature_unavailable");
check("profile: invalid restaurant sub-type rejected", validateProfileDraft(P({ category: "restaurant_food", restaurant_subcategory: "spaceship" }), CTX()).reason === "invalid_input");
check("profile: extra categories without any primary → missing category", validateProfileDraft(P({ extra_categories: ["music_entertainment"] }), CTX({ category: null, categories: [] })).reason === "missing_fields");
check(
  "profile: categories written exactly like CategoryCard ([primary, ...extras])",
  JSON.stringify(profilePatch(P({ category: "music_entertainment", extra_categories: ["events_experiences"] }), FACTS()).categories) === JSON.stringify(["music_entertainment", "events_experiences"])
);
const patchKeys = Object.keys(profilePatch(P({ name: "A", bio: "B", long_bio: "C", location: "D", whatsapp: null }), FACTS())).sort().join();
check("profile: only editor-card columns are written", patchKeys === "about_location,about_long_bio,bio,name", patchKeys);
check(
  "profile: payload never carries username/photos/published/verified/pixels",
  !Object.keys(P()).some((k) => /username|avatar|cover|published|verified|pixel|token|theme|plan/.test(k))
);

// ------------------------------------------------------------------ STRICT contact provenance
const said = ["I'm a DJ called DJ Nova in Yaoundé. My WhatsApp is 677 12 34 56 and email nova@example.cm"];
v = validateProfileDraft(P({ whatsapp: "677123456" }), CTX({}, said));
check("provenance: WhatsApp the owner typed is accepted (digits-only, like PhoneCountryInput)", v.ok && v.payload.whatsapp === "677123456");
v = validateProfileDraft(P({ whatsapp: "+237 677 12 34 56" }), CTX({}, said));
check("provenance: adding a country code in front is the only allowed change", v.ok && v.payload.whatsapp === "237677123456");
check("provenance: a number the owner never typed is refused", validateProfileDraft(P({ whatsapp: "237699000000" }), CTX({}, said)).reason === "contact_not_from_user");
check("provenance: nothing typed → any number refused", validateProfileDraft(P({ phone: "+237 677 12 34 56" }), CTX({}, [])).reason === "contact_not_from_user");
check("provenance: a changed digit is refused", !phoneFromOwner("237677123457", said));
check("provenance: only a trailing match counts, never a fragment", !phoneFromOwner("7712345", said) && !phoneFromOwner("67712345", said));
// Country-code normalization: the prefix must be a REAL calling code from Ringo's own list
// (src/lib/phoneCountryCodes.ts) — invented digits in front are refused.
check("provenance: +237 (Cameroon) in front of the typed number accepted", phoneFromOwner("237677123456", said));
check("provenance: +33 (France) in front accepted — it is a real code; the card shows the full number", phoneFromOwner("33677123456", said));
check("provenance: invented prefix '99' refused (not a calling code)", !phoneFromOwner("99677123456", said));
check("provenance: invented prefix '999' refused", !phoneFromOwner("999677123456", said));
check("provenance: a real code followed by invented digits refused", !phoneFromOwner("23799677123456", said));
check("provenance: prefix '2' / '23' (not codes) refused", !phoneFromOwner("2677123456", said) && !phoneFromOwner("23677123456", said));
check("provenance: email the owner typed accepted", validateProfileDraft(P({ email: "Nova@Example.cm" }), CTX({}, said)).ok);
check("provenance: invented email refused", validateProfileDraft(P({ email: "booking@djnova.com" }), CTX({}, said)).reason === "contact_not_from_user");
check("provenance: email must match exactly, not as a fragment", !emailFromOwner("ova@example.cm", said));
check("provenance: model's own text is never a source (only userText)", validateProfileDraft(P({ email: "nova@example.cm" }), CTX({}, [])).reason === "contact_not_from_user");

// ------------------------------------------------------------------ product draft validation + plan gate
v = validateProductDraft({ name: " Ndolé plate ", description: "Home-style ndolé.", price: 2500 }, CTX());
check("product: valid product accepted; currency comes from the store, not the model", v.ok && v.payload.name === "Ndolé plate" && v.payload.currency === "XAF");
check("product: model can't set the currency", validateProductDraft({ name: "A", description: null, price: 5, currency: "USD" }, CTX()).payload.currency === "XAF");
check("product: missing name → missing_fields", validateProductDraft({ name: "  ", description: null, price: null }, CTX()).reason === "missing_fields");
check("product: negative price rejected", validateProductDraft({ name: "A", description: null, price: -1 }, CTX()).reason === "invalid_input");
check("product: XAF price with decimals rejected", validateProductDraft({ name: "A", description: null, price: 99.5 }, CTX()).reason === "invalid_input");
check("product: USD price with cents accepted", validateProductDraft({ name: "A", description: null, price: 19.99 }, CTX({ currency: "USD" })).ok);
check("product: string price rejected (no coercion)", validateProductDraft({ name: "A", description: null, price: "5k" }, CTX()).reason === "invalid_input");
check("product: no price is allowed (shown as 'No price')", validateProductDraft({ name: "A", description: null, price: null }, CTX()).payload.price === null);
check("plan: catalog locked (max_products 0) → feature_unavailable, like Editor.tsx", productCreateDraft.availability(FACTS({ maxProducts: 0 })).reason === "feature_unavailable");
check("plan: at max_products → plan_limit_reached, like CatalogCard", productCreateDraft.availability(FACTS({ maxProducts: 3, productCount: 3 })).reason === "plan_limit_reached");
check("plan: under the limit / unlimited → ok", productCreateDraft.availability(FACTS({ maxProducts: 5 })).ok && productCreateDraft.availability(FACTS()).ok);

// ------------------------------------------------------------------ product UPDATE draft validation (edit an existing product)
const PID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PU = (over = {}) => ({ productId: PID, name: null, description: null, price: null, image_url: null, ...over });
v = validateProductUpdateDraft(PU({ name: "New name" }), CTX());
check("product update: a single field change accepted, others stay null", v.ok && v.payload.name === "New name" && v.payload.price === null);
check("product update: nothing to change (all null) rejected", validateProductUpdateDraft(PU(), CTX()).reason === "nothing_to_change");
check("product update: missing/invalid product_id rejected", validateProductUpdateDraft({ name: "A" }, CTX()).reason === "invalid_input" && validateProductUpdateDraft(PU({ productId: "not-a-uuid" }), CTX()).reason === "invalid_input");
check("product update: name over 120 chars rejected", validateProductUpdateDraft(PU({ name: "x".repeat(121) }), CTX()).reason === "invalid_input");
check("product update: negative price rejected", validateProductUpdateDraft(PU({ price: -1 }), CTX()).reason === "invalid_input");
check("product update: availability is always ok (no plan limit on edits)", productUpdateDraft.availability(FACTS({ maxProducts: 0 })).ok);
check("product update: currency still comes from the store, not the model", validateProductUpdateDraft(PU({ name: "A" }), CTX()).payload.currency === "XAF");

// image_url provenance: STRICT, same posture as phone/email — only a URL the
// owner actually got back from an upload in THIS conversation.
const uploadedUrl = "https://project.supabase.co/storage/v1/object/public/uploads/u1/ai-uploads/abc.jpg";
const saidImage = [`Use this for my product\n[image: ${uploadedUrl}]`];
check("provenance: an uploaded image url attached in this conversation is accepted", imageUrlFromOwner(uploadedUrl, saidImage));
check("provenance: a url the model invents (never attached) is refused", !imageUrlFromOwner("https://project.supabase.co/storage/v1/object/public/uploads/u1/ai-uploads/other.jpg", saidImage));
v = validateProductUpdateDraft(PU({ image_url: uploadedUrl }), CTX({}, saidImage));
check("product update: image_url the owner attached is accepted", v.ok && v.payload.imageUrl === uploadedUrl);
check("product update: an invented image_url is refused as contact_not_from_user", validateProductUpdateDraft(PU({ image_url: "https://evil.example/x.jpg" }), CTX({}, saidImage)).reason === "contact_not_from_user");

// ------------------------------------------------------------------ POST /api/ai/uploads/image validation helpers
const savedSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
check("upload: a real JPEG signature is recognized", looksLikeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])));
check("upload: a real PNG signature is recognized", looksLikeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])));
check("upload: a real WEBP (RIFF…WEBP) signature is recognized", looksLikeImage(new TextEncoder().encode("RIFF\0\0\0\0WEBP")));
check("upload: a spoofed Content-Type with non-image bytes is rejected (magic-byte sniff)", !looksLikeImage(new TextEncoder().encode("<html><body>not an image</body></html>")));
check("upload: empty bytes rejected", !looksLikeImage(new Uint8Array([])));
check("upload: extension is derived from the sniffed/declared type, never the filename", extFromMime("image/png") === "png" && extFromMime("image/webp") === "webp" && extFromMime("image/jpeg") === "jpg");
check(
  "upload: a URL under the caller's own ai-uploads prefix is accepted",
  isOwnAiUploadUrl("https://project.supabase.co/storage/v1/object/public/uploads/u1/ai-uploads/abc.jpg", "u1")
);
check(
  "upload: another user's ai-uploads URL is refused",
  !isOwnAiUploadUrl("https://project.supabase.co/storage/v1/object/public/uploads/u2/ai-uploads/abc.jpg", "u1")
);
check(
  "upload: a URL outside the ai-uploads folder (e.g. the products folder) is refused",
  !isOwnAiUploadUrl("https://project.supabase.co/storage/v1/object/public/uploads/u1/products/abc.jpg", "u1")
);
check("upload: an arbitrary external URL is refused", !isOwnAiUploadUrl("https://evil.example/u1/ai-uploads/abc.jpg", "u1"));
check(
  "upload: a path-traversal attempt is refused",
  !isOwnAiUploadUrl("https://project.supabase.co/storage/v1/object/public/uploads/u1/ai-uploads/../../other/x.jpg", "u1")
);
process.env.NEXT_PUBLIC_SUPABASE_URL = savedSupabaseUrl;

// ------------------------------------------------------------------ event draft validation + ticketing gate
v = validateEventDraft({ title: "Afro Night", date: "2026-10-10", time: "21:00", location: "Yaoundé" }, CTX());
check("event: valid event accepted", v.ok && v.payload.date === "2026-10-10");
check("event: missing date → missing_fields (ask, don't invent)", JSON.stringify(validateEventDraft({ title: "X", date: null, time: null, location: null }, CTX()).fields) === '["date"]');
check("event: past date refused", validateEventDraft({ title: "X", date: "2026-09-01", time: null, location: null }, CTX()).reason === "date_in_past");
check("event: impossible date refused", validateEventDraft({ title: "X", date: "2026-02-30", time: null, location: null }, CTX()).reason === "invalid_input");
check("event: only on pages with ticketing (profileHasTicketing)", eventCreateDraft.availability(FACTS()).reason === "feature_unavailable" && eventCreateDraft.availability(FACTS({ category: "music_entertainment", categories: ["music_entertainment"] })).ok);

// ------------------------------------------------------------------ fake Supabase (session client) for adapters
function fakeDb(resolver) {
  const db = {
    calls: [],
    from(table) {
      const st = { table, op: "select", filters: {}, payload: null };
      const b = {
        select(cols) { if (st.op === "select") st.cols = cols; return b; },
        insert(p) { st.op = "insert"; st.payload = p; return b; },
        update(p) { st.op = "update"; st.payload = p; return b; },
        delete() { st.op = "delete"; return b; },
        eq(k, val) { st.filters[k] = val; return b; },
        in(k, val) { st.filters[k] = val; return b; },
        order() { return b; },
        limit() { return b; },
        maybeSingle() { return b; },
        single() { return b; },
        then(res, rej) { db.calls.push(st); return Promise.resolve(resolver(st)).then(res, rej); },
      };
      return b;
    },
    rpc(name, args) {
      const st = { op: "rpc", name, args };
      db.calls.push(st);
      return Promise.resolve(resolver(st));
    },
  };
  return db;
}
const WS = { userId: "11111111-1111-4111-8111-111111111111", profileId: "22222222-2222-4222-8222-222222222222", username: "nova", actor: { kind: "owner" } };
const TARGET = "33333333-3333-4333-8333-333333333333";

// profile apply: ONE atomic compare-and-set call (ai_apply_profile_update), through the session client.
// The transactional behaviour itself (row lock, stale refusal under a real concurrent edit) is proven
// on real Postgres in supabase/support/tests/ringo_ai_drafts.test.mjs; here: what is sent, and mapping.
const payloadP = validateProfileDraft(P({ name: "DJ Nova", bio: "New bio" }), CTX()).payload;
const base = { name: "Old", bio: "Old bio" };
const profileWith = (reply) => fakeDb((st) => (st.op === "rpc" ? reply : { data: null, error: { message: "unexpected table access" } }));
let db = profileWith({ data: "updated", error: null });
let ar = await profileUpdateDraft.apply(db, WS, { payload: payloadP, base, targetId: TARGET }, FACTS());
const rpcP = db.calls.find((c) => c.op === "rpc");
check("apply profile: a single atomic RPC via the given (session) client — no direct table write", ar.ok && db.calls.length === 1 && rpcP?.name === "ai_apply_profile_update");
check("apply profile: sends own profile id, only the reviewed columns, and the draft-time base", rpcP && rpcP.args.p_profile_id === WS.profileId && Object.keys(rpcP.args.p_patch).sort().join() === "bio,name" && JSON.stringify(rpcP.args.p_base) === JSON.stringify(base));
check("apply profile: never sends a user id (the function uses auth.uid())", rpcP && !JSON.stringify(rpcP.args).includes(WS.userId));
ar = await profileUpdateDraft.apply(profileWith({ data: "stale", error: null }), WS, { payload: payloadP, base, targetId: TARGET }, FACTS());
check("apply profile: 'stale' (newer manual edit) → stale, not applied", !ar.ok && ar.code === "stale");
ar = await profileUpdateDraft.apply(profileWith({ data: "already_applied", error: null }), WS, { payload: payloadP, base, targetId: TARGET }, FACTS());
check("apply profile: 'already_applied' (retry) → idempotent success", ar.ok && ar.alreadyApplied);
ar = await profileUpdateDraft.apply(profileWith({ data: "not_found", error: null }), WS, { payload: payloadP, base, targetId: TARGET }, FACTS());
check("apply profile: 'not_found' (not the owner / RLS) → write_failed, never 'applied'", !ar.ok && ar.code === "write_failed");
ar = await profileUpdateDraft.apply(profileWith({ data: null, error: { code: "42501", message: "column not allowed" } }), WS, { payload: payloadP, base, targetId: TARGET }, FACTS());
check("apply profile: database refusal → write_failed", !ar.ok && ar.code === "write_failed");

// product apply: ONE atomic plan-limited insert (ai_create_product_within_limit), through the session client.
const payloadProd = validateProductDraft({ name: "Merch tee", description: null, price: 5000 }, CTX()).payload;
const productWith = (reply) => fakeDb((st) => (st.op === "rpc" ? reply : { data: null, error: { message: "unexpected table access" } }));
db = productWith({ data: [{ outcome: "inserted", product_id: TARGET }], error: null });
ar = await productCreateDraft.apply(db, WS, { payload: payloadProd, base: null, targetId: TARGET }, FACTS());
const rpcC = db.calls.find((c) => c.op === "rpc");
check("apply product: a single atomic RPC via the session client — no direct insert", ar.ok && db.calls.length === 1 && rpcC?.name === "ai_create_product_within_limit");
check("apply product: pre-assigned id + own profile + reviewed values", rpcC && rpcC.args.p_id === TARGET && rpcC.args.p_profile_id === WS.profileId && rpcC.args.p_name === "Merch tee" && rpcC.args.p_price === 5000);
ar = await productCreateDraft.apply(productWith({ data: [{ outcome: "already_exists", product_id: TARGET }], error: null }), WS, { payload: payloadProd, base: null, targetId: TARGET }, FACTS());
check("apply product: retry of a committed insert → idempotent, no duplicate", ar.ok && ar.alreadyApplied && ar.resultId === TARGET);
ar = await productCreateDraft.apply(productWith({ data: [{ outcome: "limit_reached", product_id: null }], error: null }), WS, { payload: payloadProd, base: null, targetId: TARGET }, FACTS());
check("apply product: limit reached at insert time → plan_limit_reached", !ar.ok && ar.code === "plan_limit_reached");
ar = await productCreateDraft.apply(productWith({ data: [{ outcome: "catalog_locked", product_id: null }], error: null }), WS, { payload: payloadProd, base: null, targetId: TARGET }, FACTS());
check("apply product: catalog locked → feature_unavailable", !ar.ok && ar.code === "feature_unavailable");
ar = await productCreateDraft.apply(productWith({ data: [{ outcome: "not_owner", product_id: null }], error: null }), WS, { payload: payloadProd, base: null, targetId: TARGET }, FACTS());
check("apply product: not the owner → write_failed", !ar.ok && ar.code === "write_failed");
ar = await productCreateDraft.apply(productWith({ data: null, error: { code: "42501", message: "rls" } }), WS, { payload: payloadProd, base: null, targetId: TARGET }, FACTS());
check("apply product: RLS refusal → write_failed", !ar.ok && ar.code === "write_failed");
check("apply product: store currency changed since the draft → stale, nothing sent", (await productCreateDraft.apply(productWith({ data: [{ outcome: "inserted" }], error: null }), WS, { payload: payloadProd, base: null, targetId: TARGET }, FACTS({ currency: "USD" }))).code === "stale");

// event apply
const payloadEv = validateEventDraft({ title: "Afro Night", date: "2026-10-10", time: "21:00", location: "Yaoundé" }, CTX()).payload;
db = fakeDb(() => ({ data: null, error: null }));
ar = await eventCreateDraft.apply(db, WS, { payload: payloadEv, base: null, targetId: TARGET }, FACTS({ category: "music_entertainment" }));
const evIns = db.calls.find((c) => c.op === "insert");
check("apply event: always inserted UNPUBLISHED (status 'draft', never the 'published' default)", ar.ok && evIns.table === "events" && evIns.payload.status === "draft");
check("apply event: review path is the existing event editor", eventCreateDraft.reviewPath(TARGET) === `/dashboard/tickets/${TARGET}`);

// product UPDATE apply: ONE atomic compare-and-set (ai_apply_product_update), through the session client.
const payloadPU = validateProductUpdateDraft(PU({ name: "New name", price: 3000 }), CTX()).payload;
const baseProduct = { name: "Old name", description: null, price: 2000, image_url: null };
const productUpdateWith = (reply) => fakeDb((st) => (st.op === "rpc" ? reply : { data: null, error: { message: "unexpected table access" } }));
db = productUpdateWith({ data: "updated", error: null });
ar = await productUpdateDraft.apply(db, WS, { payload: payloadPU, base: baseProduct, targetId: PID }, FACTS());
const rpcPU = db.calls.find((c) => c.op === "rpc");
check("apply product update: a single atomic RPC via the session client", ar.ok && db.calls.length === 1 && rpcPU?.name === "ai_apply_product_update");
check(
  "apply product update: sends the product + profile id, only the changed columns, and the draft-time base",
  rpcPU && rpcPU.args.p_product_id === PID && rpcPU.args.p_profile_id === WS.profileId && Object.keys(rpcPU.args.p_patch).sort().join() === "name,price" && JSON.stringify(rpcPU.args.p_base) === JSON.stringify(baseProduct)
);
ar = await productUpdateDraft.apply(productUpdateWith({ data: "stale", error: null }), WS, { payload: payloadPU, base: baseProduct, targetId: PID }, FACTS());
check("apply product update: 'stale' (page changed since) → stale, not applied", !ar.ok && ar.code === "stale");
ar = await productUpdateDraft.apply(productUpdateWith({ data: "already_applied", error: null }), WS, { payload: payloadPU, base: baseProduct, targetId: PID }, FACTS());
check("apply product update: 'already_applied' (retry) → idempotent success", ar.ok && ar.alreadyApplied);
ar = await productUpdateDraft.apply(productUpdateWith({ data: "not_found", error: null }), WS, { payload: payloadPU, base: baseProduct, targetId: PID }, FACTS());
check("apply product update: 'not_found' (not the owner / product deleted) → write_failed, never applied", !ar.ok && ar.code === "write_failed");
ar = await productUpdateDraft.apply(productUpdateWith({ data: null, error: { code: "42501", message: "column not allowed" } }), WS, { payload: payloadPU, base: baseProduct, targetId: PID }, FACTS());
check("apply product update: database refusal → write_failed", !ar.ok && ar.code === "write_failed");
check(
  "apply product update: store currency changed since the draft → stale, nothing sent",
  (await productUpdateDraft.apply(productUpdateWith({ data: "updated", error: null }), WS, { payload: payloadPU, base: baseProduct, targetId: PID }, FACTS({ currency: "USD" }))).code === "stale"
);

// ------------------------------------------------------------------ draft view (what the browser gets)
const row = { id: "d1", draft_type: "profile.update", status: "awaiting_confirmation", payload: payloadP, base, revision: 2, result_id: null, error_code: null, created_at: "2026-09-23T10:00:00+00:00", expires_at: "2099-01-01T00:00:00+00:00" };
let view = toDraftView(row);
check("view: before → after rows for changed fields only", view.changes.length === 2 && view.changes.find((c) => c.field === "name").before === "Old" && view.changes.find((c) => c.field === "name").after === "DJ Nova");
check("view: AI-written bio is labelled as generated", view.changes.find((c) => c.field === "bio").generated === true);
check("view: exposes no target id / user id / profile id", !/target|user_id|profile_id/.test(JSON.stringify(view)));
check("view: an expired pending draft shows as expired", toDraftView({ ...row, expires_at: "2020-01-01T00:00:00+00:00" }).status === "expired");
check("view: unknown draft type → not shown", toDraftView({ ...row, draft_type: "payment.refund" }) === null);

// ------------------------------------------------------------------ tool registry: exposure + schemas
const snap = (over = {}) => ({
  loadedAt: new Date().toISOString(),
  profile: { username: "nova", displayName: null, location: null, category: "business_ecommerce", categories: [], musicRole: null, restaurantSubcategory: null, published: true, verified: false, currency: "XAF", hasAvatar: true, hasBio: true, hasCoverImage: false, hasLongDescription: false, hasWhatsapp: false, hasAboutEmail: false, hasAboutPhone: false, bookingsEnabled: false, createdAt: null },
  isMusic: false, isRestaurant: false, hasTicketing: false, restaurant: null,
  plan: { name: "free", displayName: "Free", maxLinks: 5, maxProducts: 10, pixelsEnabled: false, customThemeEnabled: false, fullAnalyticsEnabled: false, badgeRemoved: false, teamEnabled: false, maxTeamSeats: null, expiresAt: null },
  onboardingCompleted: true, loyaltyAvailability: "optional",
  counts: { links: 1, socialLinks: 0, products: 3, tracks: 0, sellableStandaloneTracks: 0, unpricedStandaloneTracks: 0, releases: 0, events: 0, upcomingPublishedEvents: 0, upcomingEventsWithoutTicketing: 0, menuCategories: 0, menuItems: 0, availableMenuItems: 0, restaurantTables: 0, bookingServices: 0, activeConnections: 0, activeCommunitySubscribers: 0, activeLoyaltyPrograms: 0 },
  ...over,
});
const toolNames = (s) => getAvailableTools({ workspace: WS, snapshot: s, locale: "en" }).map((t) => t.name);
check("tools: profile + product drafts offered to a business owner", ["create_profile_draft", "create_product_draft", "get_setup_options"].every((n) => toolNames(snap()).includes(n)));
check("tools: event drafts only where ticketing exists", !toolNames(snap()).includes("create_event_draft") && toolNames(snap({ hasTicketing: true })).includes("create_event_draft"));
const UNSUPPORTED = /"(minLength|maxLength|minimum|maximum|multipleOf|pattern)"/;
check("tools: draft schemas use only strict-mode-supported JSON Schema", AI_TOOLS.every((t) => !UNSUPPORTED.test(JSON.stringify(t.inputSchema))));
check("tools: no schema lets the model send user/profile/org/customer ids", AI_TOOLS.every((t) => !Object.keys(t.inputSchema.properties || {}).some((p) => /user|profile_id|org|customer/.test(p))));
check("tools: every registered draft type has a definition", ["profile.update", "product.create", "event.create", "product.update"].every((ty) => DRAFT_DEFINITIONS[ty]));

// ------------------------------------------------------------------ draft tools with fake I/O
const serverMod = load("lib/supabase/server.ts");
const factsMod = load("lib/ai/drafts/facts.ts");
const storeMod = load("lib/ai/drafts/store.ts");
let ownerSaid = [];
let factsNow = FACTS();
let inserted = [];
let audits = [];
let existingDrafts = {};
serverMod.createClient = () => fakeDb((st) => (st.table === "profiles" ? { data: { name: "Old", bio: null, category: "business_ecommerce", categories: ["business_ecommerce"] }, error: null } : { data: [], error: null }));
serverMod.createAdminClient = () => { throw new Error("service role must not be used by this test path"); };
factsMod.loadDraftFacts = async () => factsNow;
factsMod.loadOwnerMessages = async () => ownerSaid;
storeMod.listConversationDrafts = async () => [];
storeMod.recordDraftEvent = async (e) => { audits.push(e); };
storeMod.insertDraft = async (input) => {
  inserted.push(input);
  return { id: "44444444-4444-4444-8444-444444444444", draft_type: input.type, status: "awaiting_confirmation", payload: input.payload, base: input.base, revision: 1, result_id: null, error_code: null, created_at: "2026-09-23T10:00:00+00:00", expires_at: "2099-01-01T00:00:00+00:00" };
};
storeMod.getOwnDraft = async (ws, id, conv) => existingDrafts[`${ws.userId}|${ws.profileId}|${conv}|${id}`] ?? null;
storeMod.reviseDraft = async (_ws, d, next) => ({ ...d, ...next, revision: d.revision + 1 });

const emitted = [];
const toolCtx = { workspace: WS, snapshot: snap(), locale: "en", conversationId: "55555555-5555-4555-8555-555555555555", emitDraft: (d) => emitted.push(d) };
const avail = getAvailableTools(toolCtx);
ownerSaid = said;
let tr = await executeTool(
  "create_profile_draft",
  { ...P({ name: "DJ Nova", category: "music_entertainment", music_role: "dj", location: "Yaoundé", whatsapp: "237677123456" }), draft_id: null, user_id: "attacker", profile_id: "victim" },
  toolCtx,
  avail
);
let out = JSON.parse(tr.content);
check("tool: conversation → structured profile draft (DJ, music, Yaoundé, typed WhatsApp)", out.ok && inserted[0]?.payload.music_role === "dj" && inserted[0].payload.category === "music_entertainment" && inserted[0].payload.whatsapp === "237677123456");
check("tool: identity is the server workspace — model-supplied user_id/profile_id ignored", inserted[0]?.workspace === WS && !JSON.stringify(inserted[0].payload).includes("attacker") && !JSON.stringify(inserted[0].payload).includes("victim"));
check("tool: draft scoped to the current conversation", inserted[0]?.conversationId === toolCtx.conversationId);
check("tool: review card streamed to the panel", emitted.length === 1 && emitted[0].type === "profile.update" && emitted[0].status === "awaiting_confirmation");
check("tool: the result sent back to the model echoes no contact values (field names only)", !tr.content.includes("677123456") && !tr.content.includes("Yaoundé") && tr.content.includes("whatsapp_number"));
check("tool: tells the model nothing changed yet and chat can't confirm", /NOTHING has changed/.test(out.important) && /looks good/.test(out.important));
check("tool: audit row written with field names only", audits.some((a) => a.action === "created" && Array.isArray(a.fields)) && !JSON.stringify(audits).includes("677"));

inserted = [];
tr = await executeTool("create_profile_draft", { ...P({ email: "invented@djnova.com" }), draft_id: null }, toolCtx, avail);
out = JSON.parse(tr.content);
check("tool: invented contact detail refused and model told to ask", !out.ok && out.reason === "contact_not_from_user" && inserted.length === 0 && /Ask the user to type/.test(out.hint));

// A number that already exists ELSEWHERE in the account (e.g. About → phone) but was never typed in
// this conversation must not be reused: provenance only looks at what the owner typed here.
const storedPhone = "699887766";
const realCreate = serverMod.createClient;
serverMod.createClient = () =>
  fakeDb((st) => (st.table === "profiles" ? { data: { name: "Old", bio: null, about_phone: storedPhone, whatsapp_number: `237${storedPhone}`, category: "business_ecommerce", categories: ["business_ecommerce"] }, error: null } : { data: [], error: null }));
const savedOwner = ownerSaid;
ownerSaid = ["Please add my phone number to my page."];
inserted = [];
for (const [field, value] of [["phone", storedPhone], ["whatsapp", `237${storedPhone}`], ["phone", `+237 ${storedPhone}`]]) {
  tr = await executeTool("create_profile_draft", { ...P({ [field]: value }), draft_id: null }, toolCtx, avail);
  out = JSON.parse(tr.content);
  check(`provenance: stored account ${field} ${value} not typed in this conversation → refused, model asks`, !out.ok && out.reason === "contact_not_from_user" && inserted.length === 0);
}
ownerSaid = savedOwner;
serverMod.createClient = realCreate;
tr = await executeTool("create_product_draft", { name: "Tee", description: null, price: 5000, draft_id: null }, { ...toolCtx, snapshot: snap() }, avail);
check("tool: product draft prepared (not created)", JSON.parse(tr.content).ok && inserted.length === 1 && inserted[0].type === "product.create");
factsNow = FACTS({ maxProducts: 3, productCount: 3 });
inserted = [];
tr = await executeTool("create_product_draft", { name: "Tee", description: null, price: 5000, draft_id: null }, toolCtx, avail);
check("tool: plan limit reached → no draft, model told why", JSON.parse(tr.content).reason === "plan_limit_reached" && inserted.length === 0);
factsNow = FACTS();
tr = await executeTool("create_product_draft", { name: "Tee", description: null, price: 5000, draft_id: "66666666-6666-4666-8666-666666666666" }, toolCtx, avail);
check("tool: revising a draft id not in THIS conversation/owner → draft_not_found", JSON.parse(tr.content).reason === "draft_not_found");
existingDrafts[`${WS.userId}|${WS.profileId}|${toolCtx.conversationId}|66666666-6666-4666-8666-666666666666`] = { id: "66666666-6666-4666-8666-666666666666", draft_type: "product.create", status: "awaiting_confirmation", revision: 1, payload: {}, base: null, result_id: null, error_code: null, created_at: "2026-09-23T10:00:00+00:00", expires_at: "2099-01-01T00:00:00+00:00" };
tr = await executeTool("create_product_draft", { name: "Tee v2", description: null, price: 6000, draft_id: "66666666-6666-4666-8666-666666666666" }, toolCtx, avail);
out = JSON.parse(tr.content);
check("tool: revising own draft bumps the revision (old confirmation becomes invalid)", out.ok && out.revision === 2);
const otherWs = { ...WS, userId: "77777777-7777-4777-8777-777777777777", profileId: "88888888-8888-4888-8888-888888888888" };
tr = await executeTool("create_product_draft", { name: "X", description: null, price: null, draft_id: "66666666-6666-4666-8666-666666666666" }, { ...toolCtx, workspace: otherWs }, getAvailableTools({ ...toolCtx, workspace: otherWs }));
check("tool: another user/profile can't touch this draft (cross-user/cross-profile)", JSON.parse(tr.content).reason === "draft_not_found");

// update_product_draft: loadBase reads the "products" table, scoped to this workspace's profile.
serverMod.createClient = () =>
  fakeDb((st) => (st.table === "products" ? { data: baseProduct, error: null } : { data: [], error: null }));
ownerSaid = saidImage;
inserted = [];
tr = await executeTool("update_product_draft", { draft_id: null, product_id: PID, name: "Repainted", description: null, price: null, image_url: null }, toolCtx, avail);
out = JSON.parse(tr.content);
check("tool: update_product_draft prepared (not applied) against the real current product", out.ok && inserted.length === 1 && inserted[0].type === "product.update" && inserted[0].payload.productId === PID);
inserted = [];
tr = await executeTool("update_product_draft", { draft_id: null, product_id: PID, name: null, description: null, price: null, image_url: uploadedUrl }, toolCtx, avail);
out = JSON.parse(tr.content);
check("tool: update_product_draft accepts an image the owner attached in this conversation", out.ok && inserted[0]?.payload.imageUrl === uploadedUrl);
inserted = [];
tr = await executeTool("update_product_draft", { draft_id: null, product_id: PID, name: null, description: null, price: null, image_url: "https://evil.example/x.jpg" }, toolCtx, avail);
out = JSON.parse(tr.content);
check("tool: update_product_draft refuses an image url the owner never attached", !out.ok && out.reason === "contact_not_from_user" && inserted.length === 0);
ownerSaid = [];
serverMod.createClient = () => fakeDb((st) => (st.table === "products" ? { data: null, error: null } : { data: [], error: null }));
inserted = [];
tr = await executeTool("update_product_draft", { draft_id: null, product_id: PID, name: "X", description: null, price: null, image_url: null }, toolCtx, avail);
check("tool: a product_id that doesn't exist/isn't owned → facts_unavailable, no draft", JSON.parse(tr.content).reason === "facts_unavailable" && inserted.length === 0);
serverMod.createClient = realCreate;

// ------------------------------------------------------------------ apply pipeline (applyDraft) with fake store
const applyMod = load("lib/ai/drafts/apply.ts");
const DRAFT_ID = "99999999-9999-4999-8999-999999999999";
let claimOutcome;
let finished = [];
let applyAudits = [];
let storedDraft;
let writeResult;
storeMod.getOwnDraft = async (ws, id) => (ws.userId === WS.userId && ws.profileId === WS.profileId && id === DRAFT_ID ? storedDraft : null);
storeMod.claimDraft = async (_ws, _id, revision) => ({ ...claimOutcome, revision });
storeMod.finishDraft = async (_ws, _id, result) => { finished.push(result); return { ...storedDraft, status: result.status, error_code: result.errorCode ?? null, result_id: result.resultId ?? null }; };
storeMod.recordDraftEvent = async (e) => { applyAudits.push(e.action); };
serverMod.createClient = () =>
  fakeDb((st) => (st.op === "rpc" ? (writeResult.error ? writeResult : { data: [{ outcome: "inserted", product_id: TARGET }], error: null }) : { data: null, error: null }));
const resetApply = (over = {}) => {
  finished = [];
  applyAudits = [];
  writeResult = { data: null, error: null };
  factsNow = FACTS();
  storedDraft = { id: DRAFT_ID, conversation_id: toolCtx.conversationId, draft_type: "product.create", status: "awaiting_confirmation", payload: payloadProd, base: null, revision: 1, result_id: null, error_code: null, created_at: "2026-09-23T10:00:00+00:00", expires_at: "2099-01-01T00:00:00+00:00" };
  claimOutcome = { outcome: "claimed", draft_type: "product.create", payload: payloadProd, base: null, target_id: TARGET, result_id: null, ...over };
};

resetApply();
let res = await applyMod.applyDraft(WS, DRAFT_ID, 1);
check("apply: confirmed + valid → applied, audit apply_started → applied", res.ok && finished[0]?.status === "applied" && applyAudits.join() === "apply_started,applied");
resetApply({ outcome: "applied" });
res = await applyMod.applyDraft(WS, DRAFT_ID, 1);
check("apply: second click / replay of an applied draft → already_applied, nothing written", !res.ok && res.code === "already_applied" && finished.length === 0);
for (const [outcome, code] of [["in_progress", "in_progress"], ["revision_mismatch", "revision_mismatch"], ["rejected", "discarded"], ["expired", "expired"], ["stale", "stale"]]) {
  resetApply({ outcome });
  res = await applyMod.applyDraft(WS, DRAFT_ID, 1);
  check(`apply: claim '${outcome}' → ${code}, nothing written`, !res.ok && res.code === code && finished.length === 0);
}
resetApply();
res = await applyMod.applyDraft(otherWs, DRAFT_ID, 1);
check("apply: someone else's draft → not_found (cross-user/cross-profile)", !res.ok && res.code === "not_found");
resetApply();
factsNow = FACTS({ maxProducts: 3, productCount: 3 });
res = await applyMod.applyDraft(WS, DRAFT_ID, 1);
check("apply: plan limit re-checked at apply time → failed, draft kept", !res.ok && res.code === "plan_limit_reached" && finished[0]?.status === "failed" && applyAudits.includes("apply_failed"));
resetApply();
factsNow = FACTS({ currency: "USD" });
res = await applyMod.applyDraft(WS, DRAFT_ID, 1);
check("apply: page changed since the draft (store currency) → stale, not applied", !res.ok && res.code === "stale" && finished[0]?.status === "stale");
resetApply();
writeResult = { data: null, error: { code: "42501", message: "rls" } };
res = await applyMod.applyDraft(WS, DRAFT_ID, 1);
check("apply: write fails → status failed (retryable), never 'applied'", !res.ok && res.code === "write_failed" && finished[0]?.status === "failed" && res.draft?.status === "failed");
resetApply({ payload: { ...payloadProd, price: -5 } });
res = await applyMod.applyDraft(WS, DRAFT_ID, 1);
check("apply: a tampered stored payload fails re-validation → not applied", !res.ok && finished[0]?.status !== "applied");
resetApply();
factsMod.loadDraftFacts = async () => null;
res = await applyMod.applyDraft(WS, DRAFT_ID, 1);
factsMod.loadDraftFacts = async () => factsNow;
check("apply: can't read facts → fail closed (facts_unavailable), nothing written", !res.ok && res.code === "facts_unavailable");

// ------------------------------------------------------------------ same(): order-independent value equality
// Regression for a real production false-positive: the draft's STORED payload (as it comes back out
// of the ai_drafts.payload JSONB column) can legitimately enumerate its keys in a different order
// than a fresh re-validation call produces. Only VALUES should decide staleness, never key order —
// but array element order (e.g. `categories`) is a real, meaningful difference and must still count.
check("same(): identical values, different key order → equal", applyMod.same({ a: 1, b: 2, c: null }, { c: null, b: 2, a: 1 }));
check("same(): identical values, different key order, nested → equal", applyMod.same({ x: { p: 1, q: 2 }, y: [1, 2] }, { y: [1, 2], x: { q: 2, p: 1 } }));
check("same(): a genuinely different value → not equal", !applyMod.same({ a: 1 }, { a: 2 }));
check("same(): a missing key → not equal", !applyMod.same({ a: 1, b: 2 }, { a: 1 }));
check("same(): null vs a real value → not equal", !applyMod.same({ a: null }, { a: "x" }));
check("same(): array order still matters (e.g. categories)", !applyMod.same({ categories: ["a", "b"] }, { categories: ["b", "a"] }));
check("same(): identical array order → equal", applyMod.same({ categories: ["a", "b"] }, { categories: ["a", "b"] }));

// ------------------------------------------------------------------ regression: profile.update Confirm & Apply must not false-positive stale
// Reproduces the real production incident end-to-end through applyDraft(): an untouched draft whose
// stored payload happens to enumerate keys in a different order than validateProfileDraft() would
// produce must still apply successfully — and a page that genuinely changed must still be rejected.
const reorderKeys = (obj) => Object.fromEntries(Object.keys(obj).sort().reverse().map((k) => [k, obj[k]]));
const payloadPReordered = reorderKeys(payloadP);
check(
  "regression setup: the reordered payload really has a different key order (same values)",
  JSON.stringify(Object.keys(payloadPReordered)) !== JSON.stringify(Object.keys(payloadP)) && JSON.stringify(payloadPReordered) !== JSON.stringify(payloadP)
);

const rpcCreateClient = serverMod.createClient;

serverMod.createClient = () => fakeDb((st) => (st.op === "rpc" && st.name === "ai_apply_profile_update" ? { data: "updated", error: null } : { data: null, error: { message: "unexpected call" } }));
resetApply({ draft_type: "profile.update", payload: payloadPReordered, base });
storedDraft.draft_type = "profile.update";
res = await applyMod.applyDraft(WS, DRAFT_ID, 1);
check("regression: untouched profile draft, reordered stored payload → applies successfully, not stale", res.ok === true && finished[0]?.status === "applied", JSON.stringify(res));

serverMod.createClient = () => fakeDb((st) => (st.op === "rpc" && st.name === "ai_apply_profile_update" ? { data: "stale", error: null } : { data: null, error: { message: "unexpected call" } }));
resetApply({ draft_type: "profile.update", payload: payloadPReordered, base });
storedDraft.draft_type = "profile.update";
res = await applyMod.applyDraft(WS, DRAFT_ID, 1);
check("regression: a genuine page change (RPC-level stale) is still rejected — protection not weakened", !res.ok && res.code === "stale" && finished[0]?.status === "stale");

serverMod.createClient = rpcCreateClient;

// ------------------------------------------------------------------ chat can never apply a draft
const usageMod = load("lib/ai/usage.ts");
const convMod = load("lib/ai/conversations.ts");
const snapMod = load("lib/ai/context/snapshot.ts");
let applyCalls = 0;
const realApply = applyMod.applyDraft;
applyMod.applyDraft = async (...args) => { applyCalls += 1; return realApply(...args); };
usageMod.recordUsageEvent = async () => {};
convMod.createConversation = async () => toolCtx.conversationId;
convMod.getOwnConversation = async () => ({ id: toolCtx.conversationId, profile_id: WS.profileId });
convMod.listConversationMessages = async () => [];
convMod.appendMessage = async () => "msg-1";
snapMod.loadWorkspaceSnapshot = async () => snap();
const { runChat } = load("lib/ai/orchestrator.ts");
const { mapAiSettingsRow } = load("lib/ai/settings.ts");
const settings = mapAiSettingsRow({ enabled: true, access_mode: "allowlist", provider: "anthropic", model_chat: "m", effort: "low", daily_message_limit: 30, monthly_user_token_limit: 3000000, monthly_global_budget_usd: 50, max_tool_rounds: 4, max_output_tokens: 4096, history_message_limit: 12 });
const U0 = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
const scripted = (steps) => {
  let i = 0;
  return {
    id: "fake",
    isConfigured: () => true,
    runTurn: async (req, handlers) => {
      const step = steps[Math.min(i++, steps.length - 1)];
      const turn = typeof step === "function" ? step(req) : step;
      for (const part of turn.message.parts) if (part.type === "text") handlers?.onTextDelta?.(part.text);
      return turn;
    },
  };
};
const say = (text) => ({ message: { role: "assistant", parts: [{ type: "text", text }] }, stopReason: "end", usage: U0 });
const callTool = (name, input) => ({ message: { role: "assistant", parts: [{ type: "tool_call", id: "t1", name, input }] }, stopReason: "tool_calls", usage: U0 });
const chatEvents = async (message, provider) => {
  const events = [];
  await runChat({ access: { workspace: WS, settings, provider, dailyMessageLimit: 30, isPlatformAdmin: false }, locale: "en", conversationId: toolCtx.conversationId, message, emit: (e) => events.push(e) });
  return events;
};
let seenTools = [];
for (const msg of ["looks good", "yes", "ok apply it", "Confirm & Apply", "confirm draft 99999999-9999-4999-8999-999999999999"]) {
  const ev = await chatEvents(msg, scripted([(req) => { seenTools = req.tools.map((t) => t.name); return callTool("apply_draft", { draft_id: DRAFT_ID }); }, say("Please press Confirm & Apply on the card.")]));
  check(`chat "${msg}" never applies a draft`, applyCalls === 0 && ev.some((e) => e.type === "done"));
}
check("chat: the model is never offered an apply/confirm tool", seenTools.length > 0 && !seenTools.some((n) => /apply|confirm|publish/.test(n)));

// End-to-end extraction through the real orchestrator: one owner message → one draft card.
inserted = [];
ownerSaid = ["I'm a DJ called DJ Nova. I play Afrobeats and Amapiano in Yaoundé. My WhatsApp is 677 12 34 56"];
factsMod.loadOwnerMessages = async () => ownerSaid;
serverMod.createClient = () => fakeDb((st) => (st.table === "profiles" ? { data: { name: null, bio: null, category: "business_ecommerce", categories: ["business_ecommerce"], music_role: null, about_location: null, whatsapp_number: null }, error: null } : { data: [], error: null }));
storeMod.recordDraftEvent = async () => {};
const ev = await chatEvents(
  ownerSaid[0],
  scripted([
    callTool("create_profile_draft", { draft_id: null, ...P({ name: "DJ Nova", category: "music_entertainment", music_role: "dj", location: "Yaoundé", bio: "DJ playing Afrobeats and Amapiano in Yaoundé.", whatsapp: "237677123456" }) }),
    say("I prepared a profile draft for you — review it and press Confirm & Apply."),
  ])
);
const draftEvent = ev.find((e) => e.type === "draft");
check("e2e: owner's description becomes ONE profile draft card in the stream", !!draftEvent && inserted.length === 1 && draftEvent.draft.changes.some((c) => c.field === "music_role" && c.after === "dj"));
check("e2e: nothing was applied — only a draft exists", applyCalls === 0 && draftEvent.draft.status === "awaiting_confirmation");
applyMod.applyDraft = realApply;

// ------------------------------------------------------------------ the REAL apply route + REAL access guard
// Only the I/O edges are faked (Supabase session/admin clients, settings, provider, org cookie).
// Proves Confirm & Apply is refused — before any draft is touched — for disabled AI, demo accounts,
// staff workspaces, owners outside the beta, signed-out users and cross-site requests; and that the
// workspace the apply runs under comes from the session, never from the request body.
{
  const settingsMod = load("lib/ai/settings.ts");
  const providersMod = load("lib/ai/providers/index.ts");
  const teamAccessMod = load("lib/team/access.ts");
  const route = load("app/api/ai/drafts/[id]/apply/route.ts");
  const OWNER = { id: WS.userId };
  let world;
  const resetWorld = (over = {}) => {
    world = { user: OWNER, enabled: true, status: "active", isDemo: false, orgCookie: null, staffMembership: false, inBeta: true, ...over };
  };
  settingsMod.getAiSettings = async () => ({ ...settings, enabled: world.enabled, accessMode: "allowlist" });
  providersMod.getAiProvider = () => ({ id: "fake", isConfigured: () => true });
  teamAccessMod.getActiveOrgCookie = () => world.orgCookie;
  const guardDb = () => ({
    auth: { getUser: async () => ({ data: { user: world.user } }) },
    from(table) {
      const b = {
        select() { return b; }, eq() { return b; },
        maybeSingle: async () => {
          if (table === "users") return { data: { status: world.status, role: "creator" } };
          if (table === "profiles") return { data: { id: WS.profileId, username: WS.username, is_demo: world.isDemo } };
          if (table === "organization_members") return { data: world.staffMembership ? { id: "m1" } : null };
          if (table === "ai_beta_access") return { data: world.inBeta ? { user_id: OWNER.id, daily_message_limit_override: null } : null };
          return { data: null };
        },
      };
      return b;
    },
  });
  serverMod.createClient = guardDb;
  serverMod.createAdminClient = guardDb;
  let applied = [];
  applyMod.applyDraft = async (ws, id, revision) => {
    applied.push({ ws, id, revision });
    return { ok: true, draft: { id, status: "applied" }, alreadyApplied: false };
  };
  const post = (body, headers = {}) =>
    route.POST(
      new Request(`https://ringo.example/api/ai/drafts/${DRAFT_ID}/apply`, {
        method: "POST",
        headers: { origin: "https://ringo.example", host: "ringo.example", "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
      { params: { id: DRAFT_ID } }
    );

  resetWorld();
  let resp = await post({ revision: 1, user_id: "attacker", profile_id: "victim", userId: "x", profileId: "y" });
  check("route: owner in beta can confirm; applies under the SESSION workspace", resp.status === 200 && applied.length === 1 && applied[0].ws.userId === WS.userId && applied[0].ws.profileId === WS.profileId);
  check("route: ids in the request body are ignored (can't pick another user's/profile's draft)", !JSON.stringify(applied[0].ws).includes("attacker") && !JSON.stringify(applied[0].ws).includes("victim"));
  for (const [label, over, code] of [
    ["Ringo AI disabled (kill switch)", { enabled: false }, "disabled"],
    ["demo account", { isDemo: true }, "demo_account"],
    ["staff acting in someone else's workspace", { orgCookie: "99999999-0000-4000-8000-000000000000", staffMembership: true }, "staff_workspace"],
    ["owner not in the beta allowlist", { inBeta: false }, "not_in_beta"],
    ["inactive account", { status: "suspended" }, "account_inactive"],
    ["signed out", { user: null }, "not_authenticated"],
  ]) {
    resetWorld(over);
    applied = [];
    resp = await post({ revision: 1 });
    const body = await resp.json();
    check(`route: ${label} → refused (${code}), nothing applied`, resp.status >= 400 && body.error === code && applied.length === 0, `${resp.status} ${JSON.stringify(body)}`);
  }
  resetWorld();
  applied = [];
  resp = await post({ revision: 1 }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
  check("route: cross-site request refused before the guard, nothing applied", resp.status === 403 && applied.length === 0);
  for (const bad of [{}, { revision: "1" }, { revision: 0 }, { revision: 1.5 }]) {
    applied = [];
    resp = await post(bad);
    check(`route: invalid revision ${JSON.stringify(bad)} → 400, nothing applied`, resp.status === 400 && applied.length === 0);
  }
  applyMod.applyDraft = realApply;
}

// ------------------------------------------------------------------ same-origin guard for apply/discard
const reqWith = (headers) => new Request("https://ringo.example/api/ai/drafts/x/apply", { method: "POST", headers });
check("csrf: same-origin browser request allowed", isSameOriginRequest(reqWith({ origin: "https://ringo.example", host: "ringo.example", "sec-fetch-site": "same-origin" })));
check("csrf: cross-site request refused", !isSameOriginRequest(reqWith({ origin: "https://evil.example", host: "ringo.example", "sec-fetch-site": "cross-site" })));
check("csrf: foreign Origin refused even without Sec-Fetch-Site", !isSameOriginRequest(reqWith({ origin: "https://evil.example", host: "ringo.example" })));
check("csrf: no Origin and no Sec-Fetch-Site refused", !isSameOriginRequest(reqWith({ host: "ringo.example" })));

// ------------------------------------------------------------------ EN + FR
const keysDeep = (o, prefix = "") =>
  Object.entries(o).flatMap(([k, val]) => (val && typeof val === "object" && !Array.isArray(val) ? keysDeep(val, `${prefix}${k}.`) : [`${prefix}${k}`])).sort();
const enD = translations.en.ringoAi.drafts;
const frD = translations.fr.ringoAi.drafts;
check("i18n: EN and FR draft strings have identical keys", JSON.stringify(keysDeep(enD)) === JSON.stringify(keysDeep(frD)));
const allFields = new Set();
for (const def of Object.values(DRAFT_DEFINITIONS)) {
  const sample = def.type === "profile.update" ? toDraftView({ ...row, payload: validateProfileDraft(P({ name: "a", bio: "b", long_bio: "c", location: "d", category: "restaurant_food", extra_categories: ["events_experiences"], restaurant_subcategory: "cafe", whatsapp: "677123456", phone: "677 12 34 56", email: "nova@example.cm" }), CTX({}, said)).payload, base: {} }) : null;
  (sample?.changes || []).forEach((c) => allFields.add(c.field));
}
const payloadPUWithImage = validateProductUpdateDraft(PU({ image_url: uploadedUrl }), CTX({}, saidImage)).payload;
[...productCreateDraft.changes({ ...payloadProd, description: "d" }), ...eventCreateDraft.changes(payloadEv), ...productUpdateDraft.changes(payloadPU, baseProduct), ...productUpdateDraft.changes(payloadPUWithImage, baseProduct)].forEach((c) => allFields.add(c.field));
allFields.add("music_role");
for (const loc of ["en", "fr"]) {
  const d = translations[loc].ringoAi.drafts;
  check(`i18n ${loc}: every card field has a label`, [...allFields].every((f) => typeof d.fields[f] === "string"), [...allFields].filter((f) => !d.fields[f]).join());
  check(`i18n ${loc}: every status has a label`, ["awaiting_confirmation", "applying", "applied", "failed", "rejected", "expired", "stale"].every((st) => typeof d.status[st] === "string"));
  check(
    `i18n ${loc}: every apply error code has a message`,
    ["not_found", "already_applied", "in_progress", "revision_mismatch", "discarded", "expired", "stale", "feature_unavailable", "plan_limit_reached", "invalid_payload", "facts_unavailable", "claim_failed", "write_failed", "forbidden", "internal"].every((c) => typeof d.errors[c] === "string")
  );
  check(`i18n ${loc}: every draft type has title, public note, won't-change and applied texts`, Object.keys(DRAFT_DEFINITIONS).every((ty) => [d.typeTitle, d.publicNote, d.wontChange, d.appliedNote].every((m) => typeof m[ty] === "string")));
}
check("i18n: the product card says it goes public (EN+FR)", /public/i.test(enD.publicNote["product.create"]) && /publique/i.test(frD.publicNote["product.create"]));
check("i18n: the event card says it stays unpublished (EN+FR)", /unpublished/i.test(enD.publicNote["event.create"]) && /non publié/i.test(frD.publicNote["event.create"]));

// The real DraftCard, rendered server-side in both languages (sucrase-transpiled; useLanguage supplied per locale).
const sucrase = require("sucrase");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const cardSource = fs.readFileSync(path.join(REPO, "src/components/ai/DraftCard.tsx"), "utf8");
const { code } = sucrase.transform(cardSource, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true });
const renderCard = (locale, draftView) => {
  const mod = { exports: {} };
  const localRequire = (id) => {
    if (id === "@/components/LanguageProvider") return { useLanguage: () => ({ locale, t: translations[locale], setLocale() {} }) };
    if (id.startsWith("@/")) return load(id.slice(2) + ".ts");
    return require(id);
  };
  new Function("require", "module", "exports", code)(localRequire, mod, mod.exports);
  return renderToStaticMarkup(React.createElement(mod.exports.default, { draft: draftView, onChange() {} }));
};
const productView = toDraftView({ ...row, draft_type: "product.create", payload: payloadProd, base: null });
const htmlEn = renderCard("en", productView);
const htmlFr = renderCard("fr", productView);
check("UI en: card renders the confirmation button, discard and the public warning", htmlEn.includes("Confirm &amp; Apply") && htmlEn.includes("Discard") && htmlEn.includes("public Ringo page"));
check("UI en: price shown clearly in the store currency", /5,000\s*FCFA|FCFA\s*5,000|XAF\s*5,000/.test(htmlEn), htmlEn.match(/[^>]*5[\s,.  ]?000[^<]*/)?.[0]);
check("UI fr: card renders in French (Confirmer et appliquer, publique)", htmlFr.includes("Confirmer et appliquer") && htmlFr.includes("publique") && !htmlFr.includes("Confirm &amp; Apply"));
const profileHtml = renderCard("fr", view);
check("UI fr: profile card shows before → after and the AI-written label", profileHtml.includes("Old") && profileHtml.includes("DJ Nova") && profileHtml.includes("Écrit par Ringo AI"));
const appliedHtml = renderCard("en", toDraftView({ ...row, draft_type: "event.create", payload: payloadEv, base: null, status: "applied", result_id: TARGET }));
check("UI en: applied event links to its editor and has no confirm button", appliedHtml.includes(`/dashboard/tickets/${TARGET}`) && !appliedHtml.includes("Confirm &amp; Apply"));

const failed = results.filter((x) => !x.pass);
console.log(`\nringo_ai_drafts: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
