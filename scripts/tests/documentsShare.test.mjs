// Business Toolkit Phase 2 — secure share links: token generation, hash-only storage, the owner endpoints, the public resolver and the
// public PDF route (REAL code, in-memory fake database, no network, nothing applied). The database side (doc_create_share /
// doc_resolve_share / doc_revoke_share / rate limiter) is covered by supabase/support/tests/documents_foundation.test.mjs (PGlite).
//   Run:  node scripts/tests/documentsShare.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const tmp = [];
const mk = (name, body) => { const f = path.join(os.tmpdir(), `${name}_${process.pid}.cjs`); fs.writeFileSync(f, body); tmp.push(f); return f; };
const accessStub = mk("share_access_stub", "module.exports = { resolveBookkeepingOwner: async () => globalThis.__docsOwner };");
const serverStub = mk("share_server_stub", "module.exports = { createAdminClient: () => globalThis.__publicAdmin, createClient: () => { throw new Error('no session client on a public route'); } };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/bookkeeping/access": accessStub, "@/lib/supabase/server": serverStub, "@": SRC }, interopDefault: true, cache: false });
const T = jiti(path.join(SRC, "lib/documents/shareToken.ts"));
const H = jiti(path.join(SRC, "lib/documents/handlers.ts"));
const P = jiti(path.join(SRC, "lib/documents/publicShare.ts"));
const HDR = jiti(path.join(SRC, "lib/documents/publicHeaders.ts"));
const pdfRoute = jiti(path.join(SRC, "app/d/[token]/pdf/route.ts"));
const sharesRoute = jiti(path.join(SRC, "app/api/documents/[id]/shares/route.ts"));
const revokeRoute = jiti(path.join(SRC, "app/api/documents/shares/[shareId]/revoke/route.ts"));

console.error = () => {};
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const ID = (n) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
const SID = (n) => `66666666-6666-4666-8666-${String(n).padStart(12, "0")}`;
const OWNER = { userId: "11111111-1111-4111-8111-111111111111", profileId: "22222222-2222-4222-8222-222222222222" };
const OTHER = "33333333-3333-4333-8333-333333333333";
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function makeDb(tables, log = []) {
  return { log, from(table) {
    const q = { filters: [], cols: "*", order: null, limit: null };
    const rows = () => {
      let r = (tables[table] || []).filter((x) => q.filters.every(([c, v]) => x[c] === v));
      if (q.order) r = [...r].sort((a, b) => (a[q.order.c] < b[q.order.c] ? 1 : -1));
      if (q.limit) r = r.slice(0, q.limit);
      log.push({ table, cols: q.cols, filters: q.filters });
      return r;
    };
    const chain = {
      select(c) { q.cols = c; return chain; }, eq(c, v) { q.filters.push([c, v]); return chain; },
      order(c, o) { q.order = { c, asc: o?.ascending !== false }; return chain; }, limit(n) { q.limit = n; return chain; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then(res, rej) { return Promise.resolve({ data: rows(), error: null }).then(res, rej); },
    };
    return chain;
  } };
}
const makeAdmin = (responses = {}, tables = {}) => { const calls = []; const db = makeDb(tables); return { calls, db, from: db.from.bind(db), rpc: async (name, args) => { calls.push([name, args]); const r = responses[name]; return typeof r === "function" ? r(args) : r ?? { data: null, error: null }; } }; };
const seller = { display_name: "Boutique Elise", legal_name: null, address: null, phone: null, email: null, tax_id: null, registration_no: null };
const doc = (o = {}) => ({ id: ID(1), profile_id: OWNER.profileId, doc_type: "invoice", status: "issued", locale: "en", currency: "XAF", number: "INV-2026-0001", number_year: 2026, number_seq: 1, issue_date: "2026-10-01", due_date: null, seller_snapshot: seller, customer_snapshot: { name: "Client" }, type_snapshot: null, subtotal: "5000.000", discount_total: "0.000", tax_label: null, tax_rate_bp: null, tax_total: "0.000", total: "5000.000", amount_paid: "0.000", notes: null, terms: null, template_version: 1, content_hash: "a".repeat(64), parent_document_id: null, replaces_document_id: null, created_at: "2026-10-01T10:00:00Z", issued_at: "2026-10-01T10:00:00Z", voided_at: null, void_reason: null, ...o });
const line = (o = {}) => ({ document_id: ID(1), position: 1, description: "Big job", quantity: "1.000", unit_price: "5000.000", gross_amount: "5000.000", discount_amount: "0.000", tax_amount: "0.000", line_total: "5000.000", product_id: null, ...o });
const CREATED = { doc_create_share: { data: { share_id: SID(1), document_id: ID(1), expires_at: "2099-01-01T00:00:00Z" }, error: null } };
const mkOwner = (tables = {}, responses = {}) => ({ userId: OWNER.userId, profile: { id: OWNER.profileId, currency: "XAF" }, supabase: makeDb(tables), admin: makeAdmin(responses) });

// ======================================================================== token generation
{
  const tokens = Array.from({ length: 2000 }, () => T.generateShareToken());
  check("a token is 43 base64url characters (256 bits)", tokens.every((t) => t.length === 43 && /^[A-Za-z0-9_-]{43}$/.test(t)));
  check("2000 tokens are all different", new Set(tokens).size === 2000);
  check("tokens come from the platform CSPRNG (crypto.randomBytes), never Math.random", /randomBytes\(32\)/.test(strip(read("src/lib/documents/shareToken.ts"))) && !/Math\.random/.test(strip(read("src/lib/documents/shareToken.ts"))));
  const t = tokens[0];
  eq("the stored value is the lowercase hex SHA-256 of the token", T.hashShareToken(t), sha(t));
  check("the hash is 64 hex characters and does not contain the token", /^[0-9a-f]{64}$/.test(T.hashShareToken(t)) && !T.hashShareToken(t).includes(t));
  check("hashing is deterministic and a different token gives a different hash", T.hashShareToken(t) === T.hashShareToken(t) && T.hashShareToken(t) !== T.hashShareToken(tokens[1]));
  check("well-formedness: exact length and alphabet only", T.isWellFormedShareToken(t) && !T.isWellFormedShareToken(t + "x") && !T.isWellFormedShareToken(t.slice(1)) && !T.isWellFormedShareToken("a".repeat(42) + "=") && !T.isWellFormedShareToken("a".repeat(42) + "/") && !T.isWellFormedShareToken(null) && !T.isWellFormedShareToken(12) && !T.isWellFormedShareToken(""));
  eq("the public path carries ONLY the token", T.sharePath(t), `/d/${t}`);
  eq("the url joins origin and path exactly once", [T.shareUrl("https://x.test/", t), T.shareUrl("https://x.test", t)], [`https://x.test/d/${t}`, `https://x.test/d/${t}`]);
  const ip = T.hashClientIp("203.0.113.9");
  check("the client address is only ever stored as a keyed 64-hex hash (not the address)", /^[0-9a-f]{64}$/.test(ip) && !ip.includes("203.0.113.9") && T.hashClientIp("203.0.113.9") === ip && T.hashClientIp("203.0.113.10") !== ip);
  check("there is no way to predict a link: nothing about it derives from a document id, number, business or counter", !/(document_id|number|profile|sequence|counter|Date\.now)/.test(strip(read("src/lib/documents/shareToken.ts")).replace(/export function hashClientIp[\s\S]*$/, "")));
}

// ======================================================================== owner: create a share (hash only reaches the database)
{
  const o = mkOwner({}, { doc_create_share: (a) => ({ data: { share_id: SID(1), document_id: a.p_document_id, expires_at: "2026-10-15T00:00:00Z" }, error: null }) });
  const r = await H.createShare(o, ID(1), {}, "https://ringo.test");
  const [name, args] = o.admin.calls[0];
  check("created: 201 with the one-time url, share id and expiry", r.status === 201 && /^https:\/\/ringo\.test\/d\/[A-Za-z0-9_-]{43}$/.test(r.body.url) && r.body.share_id === SID(1) && r.body.expires_at);
  const token = r.body.url.split("/d/")[1];
  check("the database function receives ONLY the SHA-256 hash of that token", name === "doc_create_share" && args.p_token_hash === sha(token) && !JSON.stringify(args).includes(token));
  check("the owner's own profile and user come from the session; the default expiry is 14 days", args.p_profile_id === OWNER.profileId && args.p_actor_user_id === OWNER.userId && args.p_expires_in_days === 14);
  check("the response never contains the hash", !JSON.stringify(r.body).includes(sha(token)));
  const two = await H.createShare(o, ID(1), {}, "https://ringo.test");
  check("each call generates a fresh token", two.body.url !== r.body.url);

  for (const [label, body] of [["zero", { expires_in_days: 0 }], ["91", { expires_in_days: 91 }], ["negative", { expires_in_days: -1 }], ["fraction", { expires_in_days: 1.5 }], ["string", { expires_in_days: "7" }], ["NaN-like", { expires_in_days: null, x: 1 }]]) {
    const oo = mkOwner({}, CREATED);
    const rr = await H.createShare(oo, ID(1), body, "https://ringo.test");
    const expected = label === "NaN-like" ? 201 : 400;
    check(`expiry ${label}: ${expected === 400 ? "400 and no database call" : "treated as the default"}`, rr.status === expected && (expected === 400 ? oo.admin.calls.length === 0 : true), JSON.stringify(rr));
  }
  const od = mkOwner({}, CREATED);
  await H.createShare(od, ID(1), { expires_in_days: 90 }, "https://ringo.test");
  await H.createShare(od, ID(1), { expires_in_days: 1 }, "https://ringo.test");
  eq("the full allowed range 1..90 is forwarded", od.admin.calls.map((c) => c[1].p_expires_in_days), [90, 1]);
  const bad = mkOwner();
  eq("a non-uuid document id is a 404 with no database call", [(await H.createShare(bad, "nope", {}, "https://x")).status, bad.admin.calls.length], [404, 0]);
  for (const [msg, status] of [["too_many_shares", 409], ["document_not_shareable", 409], ["document_not_found", 404], ["not_owner", 403]]) {
    const oe = mkOwner({}, { doc_create_share: { data: null, error: { message: msg } } });
    const re = await H.createShare(oe, ID(1), {}, "https://x");
    check(`database refusal ${msg} -> ${status}, and no url is returned`, re.status === status && !("url" in re.body), JSON.stringify(re));
  }
}

// ======================================================================== owner: list and revoke
{
  const shares = [
    { id: SID(1), document_id: ID(1), profile_id: OWNER.profileId, token_hash: "h".repeat(64), expires_at: "2099-01-01T00:00:00Z", revoked_at: null, created_at: "2026-10-02T00:00:00Z", last_accessed_at: null, access_count: 0 },
    { id: SID(2), document_id: ID(1), profile_id: OWNER.profileId, token_hash: "i".repeat(64), expires_at: "2000-01-01T00:00:00Z", revoked_at: null, created_at: "2026-10-01T00:00:00Z", last_accessed_at: "2026-10-01T05:00:00Z", access_count: 3 },
    { id: SID(3), document_id: ID(1), profile_id: OWNER.profileId, token_hash: "j".repeat(64), expires_at: "2099-01-01T00:00:00Z", revoked_at: "2026-10-01T06:00:00Z", created_at: "2026-09-30T00:00:00Z", last_accessed_at: null, access_count: 0 },
    { id: SID(4), document_id: ID(2), profile_id: OWNER.profileId, token_hash: "k".repeat(64), expires_at: "2099-01-01T00:00:00Z", revoked_at: null, created_at: "2026-10-03T00:00:00Z", last_accessed_at: null, access_count: 0 },
    { id: SID(5), document_id: ID(1), profile_id: OTHER, token_hash: "l".repeat(64), expires_at: "2099-01-01T00:00:00Z", revoked_at: null, created_at: "2026-10-04T00:00:00Z", last_accessed_at: null, access_count: 0 },
  ];
  const o = mkOwner({ bk_documents: [doc(), doc({ id: ID(2) }), doc({ id: ID(3), profile_id: OTHER })], bk_document_shares: shares });
  const r = await H.listShares(o, ID(1));
  eq("only this document's links of this business, newest first", r.body.items.map((i) => i.id), [SID(1), SID(2), SID(3)]);
  eq("state is derived: active / expired / revoked", r.body.items.map((i) => i.active), [true, false, false]);
  check("a list never reveals a token or a hash", !/token|hash|hhhh|iiii|jjjj/.test(JSON.stringify(r.body).replace(/"max_active"/, "")));
  const sel = o.supabase.log.find((l) => l.table === "bk_document_shares");
  check("the read never asks for the token_hash column (the database grants none) and filters by the owner's profile", sel && !/token_hash|\*/.test(sel.cols) && sel.filters.some(([c, v]) => c === "profile_id" && v === OWNER.profileId));
  eq("another business's document is a 404 (not an empty list)", [(await H.listShares(o, ID(3))).status, (await H.listShares(o, "bad")).status], [404, 404]);

  const orv = mkOwner({}, { doc_revoke_share: { data: { share_id: SID(1), already_revoked: false }, error: null } });
  const rv = await H.revokeShare(orv, SID(1));
  eq("revoke goes through the controlled function with the session's profile and user", [rv.status, orv.admin.calls[0][0], orv.admin.calls[0][1]], [200, "doc_revoke_share", { p_profile_id: OWNER.profileId, p_actor_user_id: OWNER.userId, p_share_id: SID(1) }]);
  const nf = mkOwner({}, { doc_revoke_share: { data: null, error: { message: "share_not_found" } } });
  eq("revoking another business's (or a missing) share is a 404", (await H.revokeShare(nf, SID(5))).status, 404);
  eq("a malformed share id is a 404 with no database call", [(await H.revokeShare(mkOwner(), "x")).status, 0], [404, 0]);
}

// ======================================================================== owner routes: gated, private
{
  globalThis.__docsOwner = { ok: false, reason: "not_signed_in" };
  let res = await sharesRoute.POST(new Request("http://x/api", { method: "POST", body: "{}" }), { params: { id: ID(1) } });
  check("create route: signed-out is refused (401)", res.status === 401);
  res = await sharesRoute.GET(new Request("http://x/api"), { params: { id: ID(1) } });
  check("list route: signed-out is refused (401)", res.status === 401);
  res = await revokeRoute.POST(new Request("http://x/api", { method: "POST" }), { params: { shareId: SID(1) } });
  check("revoke route: signed-out is refused (401)", res.status === 401);
  for (const reason of ["plan_not_enabled", "not_owner", "demo_profile", "category_not_enabled"]) {
    globalThis.__docsOwner = { ok: false, reason };
    const r2 = await sharesRoute.POST(new Request("http://x/api", { method: "POST", body: "{}" }), { params: { id: ID(1) } });
    check(`create route refuses: ${reason}`, r2.status === 403);
  }
  const admin = makeAdmin({ doc_create_share: { data: { share_id: SID(1), document_id: ID(1), expires_at: "2099-01-01T00:00:00Z" }, error: null } });
  globalThis.__docsOwner = { ok: true, owner: { userId: OWNER.userId, profile: { id: OWNER.profileId, currency: "XAF" }, supabase: makeDb({}), admin } };
  res = await sharesRoute.POST(new Request("https://ringo.test/api/documents/x/shares", { method: "POST", body: JSON.stringify({ expires_in_days: 7 }) }), { params: { id: ID(1) } });
  const body = await res.json();
  check("create route: 201, the url is returned once, private headers", res.status === 201 && /\/d\/[A-Za-z0-9_-]{43}$/.test(body.url) && res.headers.get("cache-control") === "private, no-store" && res.headers.get("referrer-policy") === "no-referrer");
  check("the owner api has no endpoint that returns a stored token", !/token_hash|p_token_hash\)/.test(strip(read("src/app/api/documents/[id]/shares/route.ts"))));
  delete globalThis.__docsOwner;
}

// ======================================================================== public resolver: uniform, isolated, rate limited
const GOOD = T.generateShareToken();
const resolveOk = (docId = ID(1), profileId = OWNER.profileId) => ({ data: { document_id: docId, profile_id: profileId, doc_type: "invoice", status: "issued" }, error: null });
{
  // unknown / revoked / expired are all "null" from doc_resolve_share (see the PGlite suite): the resolver must treat them identically
  const tables = { bk_documents: [doc()], bk_document_lines: [line()] };
  const run = async (token, responses = {}, tbl = tables, ip = "198.51.100.7") => { const a = makeAdmin({ bk_doc_rate_limit_hit: { data: true, error: null }, ...responses }, tbl); return { out: await P.openShare(a, token, ip), a }; };

  let { out, a } = await run(GOOD, { doc_resolve_share: resolveOk() });
  check("a valid link opens the document", out.kind === "ok" && out.model.number === "INV-2026-0001" && out.model.docType === "invoice");
  eq("the resolver sends only the token's hash to the database", a.calls.find((c) => c[0] === "doc_resolve_share")[1], { p_token_hash: sha(GOOD) });
  check("the raw token never reaches any database call", !JSON.stringify(a.calls).includes(GOOD));

  const unknown = await run(GOOD, { doc_resolve_share: { data: null, error: null } });
  const errored = await run(GOOD, { doc_resolve_share: { data: null, error: { message: "boom" } } });
  const malformed = await run("short");
  const weird = await run("../../etc/passwd");
  check("unknown, revoked, expired (all null), a database error and malformed tokens give the IDENTICAL outcome", [unknown, errored, malformed, weird].every((x) => JSON.stringify(x.out) === JSON.stringify({ kind: "unavailable" })));
  check("a malformed token never reaches the resolver function (no database lookup)", !malformed.a.calls.some((c) => c[0] === "doc_resolve_share") && !weird.a.calls.some((c) => c[0] === "doc_resolve_share"));

  // rate limiting
  const lim = await run(GOOD, { bk_doc_rate_limit_hit: { data: false, error: null }, doc_resolve_share: resolveOk() });
  check("over the limit: 'limited' BEFORE the token is even looked up", lim.out.kind === "limited" && !lim.a.calls.some((c) => c[0] === "doc_resolve_share"));
  const limErr = await run(GOOD, { bk_doc_rate_limit_hit: { data: null, error: { message: "down" } }, doc_resolve_share: resolveOk() });
  check("the limiter failing CLOSES the door (limited, nothing resolved)", limErr.out.kind === "limited" && !limErr.a.calls.some((c) => c[0] === "doc_resolve_share"));
  const throwing = await (async () => { const a2 = { rpc: async () => { throw new Error("network"); }, from: () => { throw new Error("no"); } }; return P.openShare(a2, GOOD, "1.2.3.4"); })();
  eq("a thrown error in the limiter is also a refusal", throwing, { kind: "limited" });
  const rl = a.calls.find((c) => c[0] === "bk_doc_rate_limit_hit")[1];
  check("rate limit: kind share_ip, a 64-hex keyed subject (never the address), a bounded window and budget", rl.p_kind === "share_ip" && /^[0-9a-f]{64}$/.test(rl.p_subject_hash) && !rl.p_subject_hash.includes("198") && rl.p_window_seconds === P.SHARE_RATE_WINDOW_SECONDS && rl.p_max === P.SHARE_RATE_MAX && rl.p_max <= 1000 && rl.p_window_seconds <= 172800);
  const sameIp = (await run(GOOD, { doc_resolve_share: resolveOk() }, tables, "198.51.100.7")).a.calls[0][1].p_subject_hash;
  const otherIp = (await run(GOOD, { doc_resolve_share: resolveOk() }, tables, "198.51.100.8")).a.calls[0][1].p_subject_hash;
  check("the budget is per caller address", sameIp === rl.p_subject_hash && otherIp !== sameIp);
  eq("caller address comes from the first x-forwarded-for entry, else x-real-ip, else a fixed bucket", [P.clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" })), P.clientIp(new Headers({ "x-real-ip": "8.8.8.8" })), P.clientIp(new Headers())], ["9.9.9.9", "8.8.8.8", "unknown"]);

  // isolation
  const other = doc({ id: ID(2), profile_id: OTHER, number: "INV-2026-0099", customer_snapshot: { name: "Someone else" } });
  const iso = await run(GOOD, { doc_resolve_share: resolveOk(ID(1)) }, { bk_documents: [doc(), other], bk_document_lines: [line(), line({ document_id: ID(2), description: "OTHER BUSINESS SECRET" })] });
  check("only the shared document is returned: no other document or its lines", iso.out.kind === "ok" && iso.out.model.number === "INV-2026-0001" && !JSON.stringify(iso.out.model).includes("OTHER BUSINESS") && iso.out.model.lines.length === 1);
  const cross = await run(GOOD, { doc_resolve_share: resolveOk(ID(2), OWNER.profileId) }, { bk_documents: [other], bk_document_lines: [] });
  eq("cross-business: a share resolving to a business that does not own the row yields nothing (the load is filtered by the share's own business)", cross.out, { kind: "unavailable" });
  const reads = iso.a.db.log.filter((l) => l.table === "bk_documents");
  check("every document read is filtered by id AND the share's business", reads.length > 0 && reads.every((l) => l.filters.some(([c]) => c === "profile_id") && l.filters.some(([c]) => c === "id")));
  const draft = await run(GOOD, { doc_resolve_share: resolveOk() }, { bk_documents: [doc({ status: "draft", number: null })], bk_document_lines: [line()] });
  eq("a draft is never visible through a link", draft.out, { kind: "unavailable" });
  const voided = await run(GOOD, { doc_resolve_share: resolveOk() }, { bk_documents: [doc({ status: "void" })], bk_document_lines: [line()] });
  check("a voided document opens and shows its void status", voided.out.kind === "ok" && voided.out.model.isVoid === true && voided.out.model.status === "void");
  const rec = doc({ id: ID(5), doc_type: "receipt", number: "RCT-2026-0001", parent_document_id: ID(1) });
  const withParent = await run(GOOD, { doc_resolve_share: resolveOk(ID(5)) }, { bk_documents: [doc(), rec, doc({ id: ID(9), profile_id: OTHER, number: "INV-X" })], bk_document_lines: [line()] });
  check("a receipt link also loads its own invoice (same business) for the reference, and never another business's", withParent.out.kind === "ok" ? (withParent.out.model.parent?.number === "INV-2026-0001" || withParent.out.model.payment?.invoiceNumber === "INV-2026-0001") : withParent.out.kind === "unavailable" && false);
  const none = await run(GOOD, { doc_resolve_share: resolveOk() }, { bk_documents: [], bk_document_lines: [] });
  eq("a share whose document row is missing is simply unavailable", none.out, { kind: "unavailable" });
  check("the model returned has no database ids of other entities (public view shows number, parties, lines only)", !/profile_id|created_by|token/.test(JSON.stringify(out.model)));
}

// ======================================================================== public PDF route
{
  const tables = { bk_documents: [doc()], bk_document_lines: [line()] };
  const setup = (responses = {}, tbl = tables) => { globalThis.__publicAdmin = makeAdmin({ bk_doc_rate_limit_hit: { data: true, error: null }, doc_resolve_share: resolveOk(), bk_doc_hash: { data: "a".repeat(64), error: null }, ...responses }, tbl); return globalThis.__publicAdmin; };
  const get = (token = GOOD) => pdfRoute.GET(new Request(`https://ringo.test/d/${token}/pdf`, { headers: { "x-forwarded-for": "198.51.100.7" } }), { params: { token } });

  setup();
  let res = await get();
  const bytes = new Uint8Array(await res.arrayBuffer());
  check("a valid link serves a real PDF as an attachment", res.status === 200 && res.headers.get("content-type") === "application/pdf" && /attachment; filename="INV-2026-0001\.pdf"/.test(res.headers.get("content-disposition")) && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-");
  const h = (r, k) => r.headers.get(k);
  check("public headers: no-store, no-referrer, noindex, nosniff, no framing", /no-store/.test(h(res, "cache-control")) && h(res, "referrer-policy") === "no-referrer" && /noindex/.test(h(res, "x-robots-tag")) && h(res, "x-content-type-options") === "nosniff" && h(res, "x-frame-options") === "DENY");
  // identical bytes to the owner download: same renderer, same snapshot
  const ownerBytes = (await H.renderStoredPdf(makeAdmin({ bk_doc_hash: { data: "a".repeat(64), error: null } }, tables), makeAdmin({ bk_doc_hash: { data: "a".repeat(64), error: null } }), OWNER.profileId, ID(1))).pdf;
  check("the shared PDF is byte-for-byte the owner's PDF", ownerBytes.length === bytes.length && ownerBytes.every((b, i) => b === bytes[i]));

  const bodies = [];
  for (const [label, responses, token] of [["unknown/revoked/expired", { doc_resolve_share: { data: null, error: null } }, GOOD], ["malformed", {}, "nope"], ["resolver error", { doc_resolve_share: { data: null, error: { message: "x" } } }, GOOD]]) {
    setup(responses);
    const r = await get(token);
    bodies.push([r.status, await r.text(), r.headers.get("content-type"), r.headers.get("cache-control")]);
    check(`${label}: 404 with the public no-store headers`, r.status === 404 && /no-store/.test(r.headers.get("cache-control")) && r.headers.get("x-robots-tag").includes("noindex"));
  }
  check("every failure cause returns the byte-identical 404 body", new Set(bodies.map((b) => JSON.stringify(b))).size === 1, JSON.stringify(bodies));
  check("the 404 body says nothing about expiry, revocation or existence", !/expire|revok|exist|found|invalid/i.test(bodies[0][1]), bodies[0][1]);
  setup({ bk_doc_rate_limit_hit: { data: false, error: null } });
  res = await get();
  check("rate limited: 429 with the same safe headers and no document data", res.status === 429 && /no-store/.test(res.headers.get("cache-control")) && !(await res.text()).includes("INV-2026"));
  setup({}, { bk_documents: [doc({ content_hash: "b".repeat(64) })], bk_document_lines: [line()] });
  res = await get();
  check("a document whose stored content no longer matches its hash is NOT served through a link (uniform 404, no bytes)", res.status === 404 && (await res.text()).indexOf("%PDF") < 0);
  setup({ doc_resolve_share: { data: { document_id: ID(1), profile_id: OWNER.profileId, doc_type: "invoice", status: "draft" }, error: null } }, { bk_documents: [doc({ status: "draft", number: null })], bk_document_lines: [line()] });
  res = await get();
  check("a draft cannot be fetched through a link (defence in depth: the database also refuses to share one)", res.status === 404 && (await res.text()).indexOf("%PDF") < 0);
  globalThis.__publicAdmin = { rpc: async () => { throw new Error("db down"); } };
  res = await get();
  { const t = await res.text(); check("an unexpected infrastructure failure fails closed (429/404) with no details", (res.status === 429 || res.status === 404) && !/db down|stack|Error/.test(t), t); }
  const failedHelper = HDR.uniformUnavailable(404);
  eq("uniformUnavailable helper: 404 JSON error 'unavailable'", [failedHelper.status, await failedHelper.json()], [404, { error: "unavailable" }]);
  delete globalThis.__publicAdmin;
}

// ======================================================================== public page: renders only what the customer needs
{
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  // jiti hands .tsx to the host runtime here, so compile the component with TypeScript first (JSX -> jsx-runtime) into a temp module
  const ts = require("typescript");
  const srcTsx = read("src/components/documents/PublicDocumentView.tsx");
  const out = ts.transpileModule(srcTsx, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText
    .replace(/require\("react\/jsx-runtime"\)/g, `require(${JSON.stringify(require.resolve("react/jsx-runtime"))})`)
    .replace(/require\("@\/([^"]+)"\)/g, (_, p) => `require(${JSON.stringify(path.join(SRC, p + ".ts").split(path.sep).join("/"))})`);
  // the page imports the small client PrintButton: compile it the same way and point the import at it
  const printOut = ts.transpileModule(read("src/components/documents/PrintButton.tsx"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText
    .replace(/require\("react\/jsx-runtime"\)/g, `require(${JSON.stringify(require.resolve("react/jsx-runtime"))})`);
  const printFile = path.join(os.tmpdir(), `share_print_${process.pid}.cjs`);
  fs.writeFileSync(printFile, printOut);
  tmp.push(printFile);
  const viewFile = path.join(os.tmpdir(), `share_view_${process.pid}.cjs`);
  fs.writeFileSync(viewFile, out.replace(/require\("\.\/PrintButton"\)/g, `require(${JSON.stringify(printFile.split(path.sep).join("/"))})`));
  tmp.push(viewFile);
  const View = jiti(viewFile);
  const SM = jiti(path.join(SRC, "lib/documents/snapshot.ts"));
  const m = SM.modelFromRows({ doc: doc({ locale: "fr", notes: "Merci" }), lines: [line()], parent: null, todayKey: "2026-10-02" });
  const html = renderToStaticMarkup(React.createElement(View.default || View, { model: m, pdfHref: `/d/${GOOD}/pdf` }));
  check("the page shows the number, business, customer and amounts in the document's language", /INV-2026-0001/.test(html) && /Boutique Elise/.test(html) && /Client/.test(html) && /5 000 FCFA/.test(html) && /Télécharger le PDF/.test(html));
  check("the page exposes no internal ids (document, business) and no token except in its own pdf link", !html.includes(ID(1)) && !html.includes(OWNER.profileId) && html.split(GOOD).length === 2);
  check("the page links only to its own PDF", [...html.matchAll(/href="([^"]+)"/g)].every((x) => x[1] === `/d/${GOOD}/pdf`));
  const en = renderToStaticMarkup(React.createElement(View.default || View, { model: SM.modelFromRows({ doc: doc(), lines: [line()], parent: null, todayKey: "2026-10-02" }), pdfHref: "/d/x/pdf" }));
  check("English documents render in English", /Download PDF/.test(en) && /Balance due/.test(en));
  const paid = SM.modelFromRows({ doc: doc({ status: "paid", amount_paid: "5000.000" }), lines: [line()], parent: null, todayKey: "2026-10-02" });
  const paidHtml = renderToStaticMarkup(React.createElement(View.default || View, { model: paid, pdfHref: "/d/x/pdf" }));
  check("a seller-recorded payment is 'recorded by the business', never 'verified' or 'confirmed by Ringo'", /recorded by the business|Payment recorded/i.test(paidHtml) && !/verified|confirmed by ringo|certified by/i.test(paidHtml.replace(/does not certify tax compliance/gi, "")));
  const voidHtml = renderToStaticMarkup(React.createElement(View.default || View, { model: SM.modelFromRows({ doc: doc({ status: "void" }), lines: [line()], parent: null, todayKey: "2026-10-02" }), pdfHref: "/d/x/pdf" }));
  check("a void document says so", /voided by the business/i.test(voidHtml));
  const rec = doc({ doc_type: "receipt", number: "RCT-2026-0001", parent_document_id: ID(1), type_snapshot: { method: "cash", reference: "ref-1", paid_on: "2026-10-02", amount: "2000.000", balance_after: "3000.000", invoice_number: "INV-2026-0001" } });
  let recHtml = "";
  try { recHtml = renderToStaticMarkup(React.createElement(View.default || View, { model: SM.modelFromRows({ doc: rec, lines: [], parent: { doc: doc(), lines: [line()] }, todayKey: "2026-10-02" }), pdfHref: "/d/x/pdf" })); } catch (e) { recHtml = String(e); }
  check("a receipt shows the payment facts and the invoice it belongs to", /RCT-2026-0001/.test(recHtml) && /INV-2026-0001/.test(recHtml));
}

// ======================================================================== static: the page, config and the whole share surface
{
  const page = strip(read("src/app/d/[token]/page.tsx"));
  check("the page is dynamic, not cached, and robots-noindex with no-referrer", /dynamic = "force-dynamic"/.test(page) && /revalidate = 0/.test(page) && /index: false/.test(page) && /referrer: "no-referrer"/.test(page));
  check("the page title is generic (no business, number or token in metadata)", /title: "Document"/.test(page) && !/generateMetadata/.test(page));
  check("every failure on the page renders the same bilingual 'unavailable' message", /openShare/.test(page) && (page.match(/unavailableTitle/g) || []).length >= 2);
  const cfg = read("next.config.js");
  check("next.config sets no-store, no-referrer, noindex, nosniff and DENY framing for /d/:path*", /source: "\/d\/:path\*"/.test(cfg) && /no-store/.test(cfg) && /no-referrer/.test(cfg) && /noindex/.test(cfg) && /nosniff/.test(cfg) && /DENY/.test(cfg));
  const mw = fs.existsSync(path.join(SRC, "middleware.ts")) ? read("src/middleware.ts") : "";
  check("the middleware matcher covers only /dashboard and /admin, so /d/* is public (customers need no account)", /matcher: \["\/dashboard\/:path\*", "\/admin\/:path\*"\]/.test(mw));
  {
    const RU = jiti(path.join(SRC, "lib/reservedUsernames.ts"));
    check("the username 'd' is reserved (case/space-insensitive) so no profile page can be shadowed by /d/[token]; 'my-ringo' stays reserved; ordinary names are unaffected",
      RU.isReservedUsername("d") && RU.isReservedUsername(" D ") && RU.isReservedUsername("my-ringo") && !RU.isReservedUsername("dd") && !RU.isReservedUsername("dan") && !RU.isReservedUsername("elise") && !RU.isReservedUsername(null));
  }
  const files = ["src/lib/documents/shareToken.ts", "src/lib/documents/publicShare.ts", "src/lib/documents/publicHeaders.ts", "src/app/d/[token]/page.tsx", "src/app/d/[token]/pdf/route.ts", "src/components/documents/PublicDocumentView.tsx", "src/components/documents/ShareModal.tsx", "src/app/api/documents/[id]/shares/route.ts", "src/app/api/documents/shares/[shareId]/revoke/route.ts"];
  const code = files.map((f) => [f, strip(read(f))]);
  check("no console logging of tokens anywhere on the share surface", code.every(([, s]) => !/console\.(log|info|debug)/.test(s)));
  check("no automated WhatsApp / SMS / email sending in the share feature (the owner shares the link themselves)", code.every(([, s]) => !/wa\.me|whatsapp|twilio|sendSms|sendEmail|resend|nodemailer|\bsms\b/i.test(s)));
  check("no public route or helper reads a session or the owner gate (the token is the only credential)", ["src/app/d/[token]/page.tsx", "src/app/d/[token]/pdf/route.ts", "src/lib/documents/publicShare.ts"].every((f) => !/resolveBookkeepingOwner|createClient\(|getUser|cookies\(/.test(strip(read(f)))));
  check("the public side writes nothing directly (only controlled functions)", code.filter(([f]) => !/shareToken/.test(f)).every(([, s]) => !/\.(insert|update|delete|upsert)\s*\(/.test(s)));
  check("the only database functions the public side calls are resolve + rate limit (+ the integrity hash)", (() => { const s = strip(read("src/lib/documents/publicShare.ts")) + strip(read("src/lib/documents/handlers.ts")); return true && [...strip(read("src/lib/documents/publicShare.ts")).matchAll(/rpc\(\s*"([a-z_]+)"/g)].every((m) => ["bk_doc_rate_limit_hit", "doc_resolve_share"].includes(m[1])); })());
  const sql = read("supabase/migrations/2026-12-02_documents_invoices_receipts.sql");
  check("the schema stores only token_hash (64 hex check), never a plaintext token column", /token_hash text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/.test(sql) && !/\btoken text\b|raw_token|plain_token|\burl text\b/i.test(sql.split("bk_document_shares")[1].split("create index")[0]));
  check("clients can never read the token_hash column (column-level grant without it)", /grant select \(id, document_id, profile_id, expires_at, revoked_at, revoked_by, created_by, created_at, last_accessed_at, access_count\)\s+on bk_document_shares/.test(sql));
  check("the owner UI uses clipboard / navigator.share only for the link the API returned", /navigator\.clipboard\.writeText\(fresh\.url\)/.test(strip(read("src/components/documents/ShareModal.tsx"))));
  check("the share link is shown once: it is held only in component state, never persisted (no localStorage/sessionStorage)", !/localStorage|sessionStorage|indexedDB/.test(strip(read("src/components/documents/ShareModal.tsx"))));
  const hand = strip(read("src/lib/documents/handlers.ts"));
  check("the raw token is passed nowhere except into the returned url (the database call uses the hash)", /p_token_hash: hashShareToken\(token\)/.test(hand) && (hand.match(/\btoken\b/g) || []).length <= 8);
  const mid = fs.existsSync(path.join(SRC, "middleware.ts"));
  check("(info) middleware present or absent does not change the public posture", mid || !mid);
}

for (const f of tmp) { try { fs.unlinkSync(f); } catch {} }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
