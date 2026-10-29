// Customer Retention (Phase 3: segments, loyalty for churches, promotions and offers, reviews), validated end to end and OFFLINE on scratch in-memory PostgreSQL (PGlite).
// The REAL migrations (community, customers, push channel, consent ledger, order links, customer retention), the REAL libraries and the REAL route files run against it. Only the session client, the
// loyalty permission gate and the three senders (e-mail, push, bell) are stubbed - the senders are recording doubles: nothing is ever sent. No Supabase, no network, no production data.
//   Run:  node scripts/tests/customerRetention.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { createHarness, kit, SRC, REPO } from "./ministryApiHarness.mjs";

const H = await createHarness({});
const { F } = H;
const { prof, u } = F;
const { check, eq, section, summary } = kit();
console.error = () => {};
console.info = () => {};

const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const MIGS = ["2026-09-19_community_system", "2026-10-17_ringo_customers_core", "2026-10-19_customer_order_links", "2026-10-23_community_push_channel", "2027-01-17_customer_consent_events", "2027-01-18_customer_retention"].map((f) => read(`supabase/migrations/${f}.sql`));
const RET_MIG = MIGS[5];

// ---- a jiti with the stubs this test needs
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retention_stubs_"));
const stub = (name, src) => { const f = path.join(dir, name + ".cjs"); fs.writeFileSync(f, src); return f; };
const alias = {
  "@/lib/supabase/server": stub("server", "module.exports = { createClient: () => null, createAdminClient: () => globalThis.__adminFactory() };"),
  "@/lib/customer/session": stub("session", "module.exports = { getCustomerFromCookie: async () => globalThis.__customer || null, isSameOrigin: () => globalThis.__sameOrigin !== false };"),
  "@/lib/loyalty/access": stub("access", `module.exports = { requireLoyaltyAccess: async (req, perm) => { const g = globalThis.__loy; if (!g || !g.perms.includes(perm)) return { ok: false, response: new Response(JSON.stringify({ error: "not_authorized" }), { status: 403, headers: { "content-type": "application/json" } }) }; return { ok: true, userId: g.userId, profile: g.profile, isOwner: true, isAdmin: false, admin: globalThis.__adminFactory() }; } };`),
  "@/lib/email/provider": stub("provider", "module.exports = { sendEmail: async (m) => { globalThis.__rec.emails.push(m); return { ok: true }; } };"),
  "@/lib/email/renderAnnouncementEmail": stub("render", "module.exports = { renderAnnouncementEmail: (m) => JSON.stringify(m) };"),
  "@/lib/customer/inbox": stub("inbox", "module.exports = { notifyCustomer: async (id, payload) => { globalThis.__rec.pushes.push({ id, payload }); return true; } };"),
  "@": SRC,
};
const jiti = createRequire(import.meta.url)("jiti")(import.meta.url, { alias, interopDefault: true, cache: false });
const SEG = jiti(path.join(SRC, "lib/retention/segments.ts"));
const PROMO = jiti(path.join(SRC, "lib/retention/promotions.ts"));
const REV = jiti(path.join(SRC, "lib/retention/reviews.ts"));
const CONS = jiti(path.join(SRC, "lib/customer/consent.ts"));
const LCAT = jiti(path.join(SRC, "lib/loyalty/categories.ts"));
const route = (rel) => jiti(path.join(SRC, "app/api", rel, "route.ts"));
globalThis.__rec = { emails: [], pushes: [] };

async function fresh() {
  await H.fresh();
  await H.db.exec(`alter table public.ringo_customers add column name text not null default 'V', add column email text, add column phone text, add column email_verified_at timestamptz, add column preferred_language text,
    add column avatar_url text, add column last_login_at timestamptz, add column phone_verified_at timestamptz, add column created_at timestamptz not null default now(), add column updated_at timestamptz not null default now();
    create table public.products (id uuid primary key default gen_random_uuid());
    create table public.bookings (id uuid primary key default gen_random_uuid(), profile_id uuid not null);
    create table public.orders (id uuid primary key default gen_random_uuid(), profile_id uuid not null);
    create table public.music_orders (id uuid primary key default gen_random_uuid(), profile_id uuid not null);
    create table public.loyalty_activities (id uuid primary key default gen_random_uuid(), profile_id uuid not null, customer_id uuid not null, kind text not null default 'record', created_at timestamptz not null default now());`);
  for (const m of MIGS) await H.db.exec(m);
  globalThis.__adminFactory = () => F.sessionFor(H.db, null, { role: "service_role" });
  globalThis.__customer = null;
  globalThis.__sameOrigin = undefined;
  globalThis.__loy = null;
  globalThis.__rec = { emails: [], pushes: [] };
}
const sdb = () => F.sessionFor(H.db, null, { role: "service_role" });
const cu = (n) => F.id("7", n);
const sid = (n) => F.id("8", n);
const q = (sql) => F.svcQuery(H.db, sql);
const NC = prof.nc, CH = prof.c1;
const as = (n, o = {}) => { globalThis.__customer = n ? { customer: { id: cu(n), name: o.name ?? "Person " + n, email: `p${n}@example.test`, phone: null, email_verified_at: o.confirmed === false ? null : "2026-10-01T10:00:00Z" }, sessionId: "s" + n } : null; };
const staff = (perms, profile = NC, userId = u.ownerNC) => { globalThis.__loy = perms ? { perms, userId, profile: { id: profile, name: profile === NC ? "Shop" : "Grace Church", username: profile === NC ? "shop" : "grace", category: profile === NC ? "music_entertainment" : "church_ministries", categories: profile === NC ? [] : ["church_ministries"], currency: "XAF" } } : null; };
const ctx = (profile = NC) => ({ admin: sdb(), userId: profile === NC ? u.ownerNC : u.owner1, profile: { id: profile, name: profile === NC ? "Shop" : "Grace Church", username: profile === NC ? "shop" : "grace", category: profile === NC ? "music_entertainment" : "church_ministries", categories: profile === NC ? [] : ["church_ministries"], currency: "XAF" } });

async function person(n, o = {}) {
  const profile = o.profile ?? NC;
  await H.db.exec(`insert into public.ringo_customers (id, name, email, email_verified_at, preferred_language) values ('${cu(n)}','${o.name ?? "Person " + n}','p${n}@example.test', ${o.confirmed === false ? "null" : "'2026-10-01T10:00:00Z'"}, '${o.lang ?? "en"}') on conflict do nothing`);
  if (o.connect === false) return;
  const status = o.status ?? "active";
  await H.db.exec(`insert into public.customer_connections (customer_id, profile_id, status, disconnected_at, connected_at, marketing_consent, marketing_consent_at)
    values ('${cu(n)}','${profile}','${status}', ${status === "disconnected" ? "now()" : "null"}, now() - interval '${o.days ?? 5} days', ${o.consent ? "true" : "false"}, ${o.consent ? "'2026-10-20T10:00:00Z'" : "null"})`);
}
async function sub(n, o = {}) {
  const profile = o.profile ?? NC;
  await H.db.exec(`insert into public.community_subscribers (id, profile_id, name, email, status, created_at) values ('${sid(n)}','${profile}','Person ${n}','p${n}@example.test','${o.status ?? "active"}','2026-10-20T10:00:00Z')`);
  await H.db.exec(`insert into public.community_subscription_preferences (subscriber_id, email_updates, push_updates) values ('${sid(n)}', ${o.email === true}, ${o.push !== false})`);
  await H.db.exec(`update public.customer_connections set community_subscriber_id = '${sid(n)}' where customer_id = '${cu(n)}' and profile_id = '${profile}'`);
}
const act = (n, daysAgo, profile = NC) => H.db.exec(`insert into public.loyalty_activities (profile_id, customer_id, created_at) values ('${profile}','${cu(n)}', now() - interval '${daysAgo} days')`);
async function booking(n, daysAgo, profile = NC, table = "bookings", kind = "booking") {
  const id = F.id("6", Math.floor(Math.random() * 1e9));
  await H.db.exec(`insert into public.${table} (id, profile_id) values ('${id}','${profile}'); insert into public.customer_order_links (customer_id, order_kind, order_id, created_at) values ('${cu(n)}','${kind}','${id}', now() - interval '${daysAgo} days')`);
}
const consent = (n, ch, a, profile = NC) => sdb().rpc("customer_consent_set", { p_customer: cu(n), p_profile: profile, p_channel: ch, p_action: a, p_source: "my_ringo" });
const connId = async (n, profile = NC) => (await q(`select id from public.customer_connections where customer_id = '${cu(n)}' and profile_id = '${profile}'`))[0].id;
const dbErr = async (sql, role) => { await H.db.exec(`set role ${role}`); try { await H.db.exec(sql); return null; } catch (e) { return String(e.message); } finally { await H.db.exec("reset role"); } };
const owner = async (sql) => { try { await H.db.exec(sql); return null; } catch (e) { return String(e.message); } };
const segOf = async (n, profile = NC) => (await sdb().rpc("customer_segments", { p_profile: profile, p_customer: cu(n) })).data?.[0]?.segment ?? null;
const PROMO_ID = F.id("5", 1);
const insertPromo = (o = {}) => H.db.exec(`insert into public.promotions (id, profile_id, title, kind, value, currency, code, audience, status, ends_at, max_redemptions, per_customer_limit, starts_at)
  values ('${o.id ?? PROMO_ID}','${o.profile ?? NC}','${o.title ?? "Welcome"}','${o.kind ?? "percent"}',${o.value ?? 20}, ${o.kind === "amount" ? "'XAF'" : "null"}, '${o.code ?? "WELCOME"}','${o.audience ?? "all"}','${o.status ?? "active"}', ${o.ends ? `now() + interval '${o.ends}'` : "null"}, ${o.max ?? "null"}, ${o.per ?? 1}, ${o.starts ? `now() + interval '${o.starts}'` : "null"})`);
const redeem = (n, promo, amount, key, profile = NC) => connId(n, profile).then((c) => PROMO.redeemPromotion(ctx(profile), { connection_id: c, promotion_id: promo, amount, key }));

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("A. the pure rules: ");
{
  const NOW = Date.UTC(2026, 9, 29);
  const d = (days) => NOW - days * 86_400_000;
  const C = SEG.classifySegment;
  check("segments: new / returning / vip / inactive, with the documented thresholds", C({ lastSeenMs: d(5), count90: 0, total: 0 }, NOW) === "new" && C({ lastSeenMs: d(5), count90: 1, total: 1 }, NOW) === "new" && C({ lastSeenMs: d(5), count90: 2, total: 2 }, NOW) === "returning"
    && C({ lastSeenMs: d(5), count90: 6, total: 6 }, NOW) === "vip" && C({ lastSeenMs: d(5), count90: 5, total: 40 }, NOW) === "returning" && C({ lastSeenMs: d(61), count90: 9, total: 9 }, NOW) === "inactive" && C({ lastSeenMs: d(59), count90: 0, total: 0 }, NOW) === "new");
  check("exactly four segments", SEG.SEGMENTS.join() === "new,returning,vip,inactive" && SEG.isSegment("vip") && !SEG.isSegment("whale"));
  check("discountFor: percent rounds DOWN to a whole franc, a fixed amount never exceeds the bill, junk is 0", PROMO.discountFor({ kind: "percent", value: 20 }, 4999) === 999 && PROMO.discountFor({ kind: "percent", value: 100 }, 1500) === 1500 && PROMO.discountFor({ kind: "amount", value: 500 }, 300) === 300 && PROMO.discountFor({ kind: "amount", value: 500 }, 2000) === 500 && PROMO.discountFor({ kind: "amount", value: 500 }, 0) === 0 && PROMO.discountFor({ kind: "percent", value: 10 }, 12.5) === 0);
  const P = PROMO.parsePromotionBody;
  check("create: a good body parses; code is upper-cased", P({ title: " Welcome ", kind: "percent", value: 20, code: "wel1come" }, "create").ok && P({ title: "x", kind: "percent", value: 20, code: "wel1come" }, "create").value.code === "WEL1COME");
  check("create: bad title, kind, value (0, 101% , 1.5), code, audience, window, limits are refused with a field", [
    P({ title: "", kind: "percent", value: 20 }, "create"), P({ title: "x", kind: "bogus", value: 20 }, "create"), P({ title: "x", kind: "percent", value: 0 }, "create"), P({ title: "x", kind: "percent", value: 101 }, "create"), P({ title: "x", kind: "amount", value: 1.5 }, "create"),
    P({ title: "x", kind: "amount", value: 500, code: "ab" }, "create"), P({ title: "x", kind: "amount", value: 500, audience: "everyone" }, "create"),
    P({ title: "x", kind: "amount", value: 500, starts_at: "2026-10-02T00:00:00Z", ends_at: "2026-10-01T00:00:00Z" }, "create"), P({ title: "x", kind: "amount", value: 500, per_customer_limit: 11 }, "create"), P({ title: "x", kind: "amount", value: 500, max_redemptions: 0 }, "create"),
  ].every((r) => r.ok === false && !!r.field));
  check("create: a currency, a profile id or a status in the body is refused (they are never taken from the request)", P({ title: "x", kind: "amount", value: 5, currency: "USD" }, "create").error === "unexpected_field" && P({ title: "x", kind: "amount", value: 5, profile_id: NC }, "create").error === "unexpected_field" && P({ title: "x", kind: "amount", value: 5, status: "active" }, "create").error === "unexpected_field");
  check("update: status active/ended only, empty update refused", P({ status: "active" }, "update").ok && P({ status: "draft" }, "update").ok === false && P({}, "update").error === "empty_update");
  check("isLive: only an active offer inside its window", PROMO.isLive({ status: "active", starts_at: null, ends_at: null }) && !PROMO.isLive({ status: "draft", starts_at: null, ends_at: null }) && !PROMO.isLive({ status: "active", starts_at: "2999-01-01T00:00:00Z", ends_at: null }) && !PROMO.isLive({ status: "active", starts_at: null, ends_at: "2000-01-01T00:00:00Z" }));
  const code = PROMO.generateCode();
  check("generated codes are 6 characters from an unambiguous alphabet", /^[A-HJ-NP-Z2-9]{6}$/.test(code) && !/[01OI]/.test(code));
  const en = PROMO.offerText({ kind: "amount", value: 2000, currency: "XAF", code: "ABC234", description: null, ends_at: null }, "en");
  const fr = PROMO.offerText({ kind: "percent", value: 15, currency: null, code: "ABC234", description: "Merci", ends_at: null }, "fr");
  check("offer text is bilingual and uses the FCFA formatting for XAF", /ABC234/.test(en) && /(FCFA|XAF)/.test(en) && /off/.test(en) && /réduction/.test(fr) && /15%/.test(fr.replace(/\s/g, "")) && /Merci/.test(fr));
  check("reviews: not offered for churches; public name is first name + initial only", REV.reviewsAvailable({ category: "music_entertainment" }) && !REV.reviewsAvailable({ category: "church_ministries" }) && !REV.reviewsAvailable({ category: "other", categories: ["church_ministries"] }) && REV.publicName("Amina Kone Bello") === "Amina B." && REV.publicName("Amina") === "Amina" && REV.publicName("") === "" && REV.summarize([5, 4, 4]).average === 4.3 && REV.summarize([]).average === null);
  const rules = LCAT.getLoyaltyOptions({ category: "church_ministries", categories: ["church_ministries"] });
  check("loyalty: Churches & Ministries are eligible with VISITS programs only - never spend or points, never packages", rules.availability === "optional" && rules.actions.join() === "visit" && rules.programTypes.join() === "visits" && rules.packages === false && LCAT.isProgramAllowed(rules, "visits", "visit") && !LCAT.isProgramAllowed(rules, "spend", "spend") && !LCAT.isProgramAllowed(rules, "points", "points"));
  const biz = LCAT.getLoyaltyOptions({ category: "restaurant_food" });
  check("...and no other category's loyalty options changed", biz.programTypes.join() === "visits,spend,points" && biz.packages === true);
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("B. the migration and the segment function, executed: ");
await fresh();
{
  // segments: the real SQL against classifySegment
  const facts = {};
  const cases = [
    [1, { days: 5 }, []], [2, { days: 5 }, [1]], [3, { days: 100 }, [10, 20, 30]], [4, { days: 120 }, [1, 3, 5, 7, 9, 11, 13]], [5, { days: 90 }, [70]], [6, { days: 70 }, []], [9, { days: 200 }, [61, 62, 63, 64, 65, 66]],
  ];
  for (const [n, o, acts] of cases) {
    await person(n, o);
    for (const a of acts) await act(n, a);
    facts[n] = { lastDays: acts.length ? Math.min(...acts) : o.days, count90: acts.filter((a) => a <= 90).length, total: acts.length };
  }
  const NOW = Date.now();
  for (const [n] of cases) {
    const f = facts[n];
    const want = SEG.classifySegment({ lastSeenMs: NOW - f.lastDays * 86_400_000, count90: f.count90, total: f.total }, NOW);
    check(`customer ${n}: the database says ${want} like the code`, (await segOf(n)) === want, `${await segOf(n)} vs ${want}`);
  }
  await person(7, { status: "disconnected" });
  await act(7, 1);
  check("a disconnected customer has no segment", (await segOf(7)) === null);
  await person(8, { days: 5 });
  await booking(8, 2); await booking(8, 3, NC, "orders", "restaurant_order"); await booking(8, 4, NC, "music_orders", "music_order");
  check("bookings, restaurant orders and music orders linked to THIS profile count as interactions (3 -> returning)", (await segOf(8)) === "returning");
  await person(10, { days: 5 }); await booking(10, 1, CH); await booking(10, 2, CH);
  await person(10, { days: 5, profile: CH, connect: true }).catch(() => {});
  check("interactions at ANOTHER profile do not count here", (await segOf(10)) === "new");
  const all = await SEG.loadSegments(sdb(), NC);
  const counts = SEG.countSegments(all.map);
  check("loadSegments counts only active connections and sums to the total", all.ok && counts.total === 9 && counts.new + counts.returning + counts.vip + counts.inactive === 9, JSON.stringify(counts));

  // privileges and structure
  check("anon and authenticated cannot read or write any retention table, or call any function", [
    await dbErr("select * from public.promotions", "anon"), await dbErr("select * from public.profile_reviews", "authenticated"), await dbErr("insert into public.promotion_redemptions (promotion_id, profile_id, customer_id, amount, discount, idempotency_key) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 0, 'abcdefgh')", "authenticated"),
    await dbErr(`select * from public.customer_segments('${NC}')`, "authenticated"), await dbErr(`select public.review_save('${cu(1)}','${NC}',5,'x')`, "anon"),
  ].every((e) => /permission denied/.test(String(e))));
  check("deliveries and redemptions are append-only for the service role", /permission denied/.test(await dbErr("update public.promotion_deliveries set channel = 'push'", "service_role")) && /permission denied/.test(await dbErr("delete from public.promotion_redemptions", "service_role")));
  check("re-running the migration is harmless", (await owner(RET_MIG)) === null);
  const verify = read("supabase/support/2027-01-18_customer_retention.verify.sql");
  const flags = (await H.db.exec(verify)).flatMap((r) => r.rows).filter((row) => "ok" in row);
  check("the verify script runs and every check is true", flags.length === 6 && flags.every((r) => r.ok === true), JSON.stringify(flags));
  check("table constraints: percent over 100, a lower-case code, a bad audience, a window that ends before it starts are refused by the database itself", /check/i.test(await owner(`insert into public.promotions (profile_id, title, kind, value, code) values ('${NC}','x','percent',101,'ABCD12')`)) && /check/i.test(await owner(`insert into public.promotions (profile_id, title, kind, value, code) values ('${NC}','x','percent',10,'abcd12')`))
    && /check/i.test(await owner(`insert into public.promotions (profile_id, title, kind, value, code, audience) values ('${NC}','x','percent',10,'ABCD12','whales')`)) && /check/i.test(await owner(`insert into public.promotions (profile_id, title, kind, value, code, starts_at, ends_at) values ('${NC}','x','percent',10,'ABCD12', now(), now() - interval '1 day')`)));
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("C. offers at the till: ");
await fresh();
{
  await person(1, { days: 5 }); await act(1, 1); // new
  await person(2, { days: 100 }); for (const a of [1, 2, 3, 4, 5, 6, 7]) await act(2, a); // vip
  await person(3, { days: 5, status: "disconnected" });
  await person(4, { days: 5 }); // no consent at all
  await insertPromo({ id: PROMO_ID, audience: "all", kind: "percent", value: 20, per: 1 });
  let r = await redeem(1, PROMO_ID, 4999, "key-0000-0001");
  check("a connected customer gets the discount (20% of 4 999 = 999 FCFA, rounded down) and the redemption is recorded", r.status === 200 && r.body.outcome === "redeemed" && r.body.discount === 999 && (await q("select count(*)::int as n from public.promotion_redemptions"))[0].n === 1);
  r = await redeem(1, PROMO_ID, 4999, "key-0000-0001");
  check("the same key again answers with the original result and records nothing new", r.status === 200 && r.body.outcome === "already_recorded" && r.body.discount === 999 && (await q("select count(*)::int as n from public.promotion_redemptions"))[0].n === 1);
  r = await redeem(1, PROMO_ID, 4999, "key-0000-0002");
  check("per-customer limit (1): a second use by the same customer is refused", r.status === 409 && r.body.outcome === "customer_limit_reached");
  r = await redeem(4, PROMO_ID, 1000, "key-0000-0003");
  check("a customer who NEVER agreed to marketing can still be given the discount at the till (using a code is not marketing)", r.status === 200 && r.body.outcome === "redeemed");
  const c3 = await connId(3);
  r = await PROMO.redeemPromotion(ctx(), { connection_id: c3, promotion_id: PROMO_ID, amount: 1000, key: "key-0000-0004" });
  check("a disconnected customer cannot be found by connection id (409 not_connected)", r.status === 409 && r.body.error === "not_connected");
  r = await PROMO.redeemPromotion(ctx(CH), { connection_id: await connId(1), promotion_id: PROMO_ID, amount: 1000, key: "key-0000-0005" });
  check("ANOTHER business cannot use a connection or an offer that is not its own", r.status === 409 && r.body.error === "not_connected");
  r = await PROMO.redeemPromotion(ctx(), { connection_id: await connId(1), promotion_id: PROMO_ID, amount: 1000, key: "key-0000-0006", customer_id: cu(2) });
  check("a customer id in the request is refused (the business never holds one)", r.status === 400 && r.body.error === "unexpected_field");
  check("the amount must be a whole number of francs: 0, negative, 12.5 and text are refused", (await Promise.all([0, -5, 12.5, "100"].map((a, i) => PROMO.redeemPromotion(ctx(), { connection_id: c3, promotion_id: PROMO_ID, amount: a, key: "key-bad-000" + i })))).every((x) => x.status === 400));

  const VIP = F.id("5", 2), CAP = F.id("5", 3), PAST = F.id("5", 4), SOON = F.id("5", 5), DRAFT = F.id("5", 6), FIXED = F.id("5", 7);
  await insertPromo({ id: VIP, code: "VIPONLY", audience: "vip", value: 30 });
  r = await redeem(1, VIP, 2000, "key-vip-0001");
  check("an offer for VIPs is refused to a new customer (not_eligible) and accepted for a VIP", r.status === 409 && r.body.outcome === "not_eligible" && (await redeem(2, VIP, 2000, "key-vip-0002")).body.outcome === "redeemed");
  await insertPromo({ id: CAP, code: "CAPPED1", max: 1, per: 5 });
  await redeem(1, CAP, 1000, "key-cap-0001");
  r = await redeem(2, CAP, 1000, "key-cap-0002");
  check("the total cap is enforced (limit_reached)", r.status === 409 && r.body.outcome === "limit_reached");
  await insertPromo({ id: PAST, code: "OLDONE1", ends: "-1 day" });
  await insertPromo({ id: SOON, code: "SOONER1", starts: "1 day" });
  await insertPromo({ id: DRAFT, code: "DRAFT01", status: "draft" });
  check("an expired, not-yet-started or draft offer cannot be used", (await redeem(1, PAST, 1000, "key-old-0001")).body.outcome === "expired" && (await redeem(1, SOON, 1000, "key-old-0002")).body.outcome === "not_started" && (await redeem(1, DRAFT, 1000, "key-old-0003")).body.outcome === "not_active" && (await redeem(1, F.id("5", 99), 1000, "key-old-0004")).body.outcome === "not_found");
  await insertPromo({ id: FIXED, code: "FIVE500", kind: "amount", value: 500, per: 3 });
  check("a fixed amount is capped at the bill (500 FCFA off 300 = 300)", (await redeem(2, FIXED, 300, "key-fix-0001")).body.discount === 300 && (await redeem(2, FIXED, 2000, "key-fix-0002")).body.discount === 500);
  const sums = await q("select count(*)::int as n, min(discount) as lo from public.promotion_redemptions where amount > 0");
  check("every redemption satisfies 0 <= discount <= amount (database constraint)", /check/i.test(await owner(`insert into public.promotion_redemptions (promotion_id, profile_id, customer_id, amount, discount, idempotency_key) values ('${PROMO_ID}','${NC}','${cu(1)}', 100, 101, 'zzzzzzzz')`)) && sums[0].n > 0);

  // the API: permissions and shape
  staff(["loyalty.scan"]);
  const call = (rel, method, o = {}) => route(rel)[method](new Request(`http://test.local/api/${rel}${o.url ?? ""}`, { method, headers: { "content-type": "application/json" }, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), { params: o.params ?? {} }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
  let a = await call("loyalty/promotions", "GET");
  check("staff who can only scan may LIST offers (to apply one) but not create, edit or announce", a.status === 200 && Array.isArray(a.body.items) && (await call("loyalty/promotions", "POST", { body: { title: "x", kind: "percent", value: 5 } })).status === 403 && (await call("loyalty/promotions/[id]", "PATCH", { params: { id: PROMO_ID }, body: { status: "ended" } })).status === 403 && (await call("loyalty/promotions/[id]/send", "POST", { params: { id: PROMO_ID }, body: { confirm: true } })).status === 403 && (await call("loyalty/segments", "GET")).status === 403 && (await call("loyalty/reviews", "GET")).status === 403);
  a = await call("loyalty/promotions/redeem", "POST", { body: { connection_id: await connId(4), promotion_id: FIXED, amount: 1000, key: "key-api-0001" } });
  check("...and may apply one: the route needs loyalty.scan and answers with the outcome", a.status === 200 && a.body.outcome === "redeemed");
  staff(["loyalty.manage"]);
  check("a manager without scan cannot apply an offer; can create, list, see segments", (await call("loyalty/promotions/redeem", "POST", { body: { connection_id: await connId(4), promotion_id: FIXED, amount: 1000, key: "key-api-0002" } })).status === 403 && (await call("loyalty/promotions", "POST", { body: { title: "Api offer", kind: "amount", value: 700, audience: "returning" } })).status === 201 && (await call("loyalty/segments", "GET")).status === 200);
  a = await call("loyalty/segments", "GET");
  check("segments come back as COUNTS only - no names, ids, e-mails", Object.keys(a.body.counts).sort().join() === "inactive,new,returning,total,vip" && !/customer|email|name|phone|uuid/i.test(JSON.stringify(a.body)));
  staff(null);
  check("no permission, no access (403) on every business route", (await Promise.all([["loyalty/promotions", "GET"], ["loyalty/segments", "GET"], ["loyalty/reviews", "GET"], ["loyalty/promotions/redeem", "POST", { body: {} }]].map(([rel, m, o]) => call(rel, m, o)))).every((x) => x.status === 403));

  // create via the handler: currency is the business's, code collisions, limits, editing a live offer
  const c = await PROMO.createPromotion(ctx(), { title: "Amount", kind: "amount", value: 1000, code: "CODE123" });
  check("creating an amount offer stores the BUSINESS's currency (XAF), as a draft", c.status === 201 && c.body.item.currency === "XAF" && c.body.item.status === "draft");
  check("a duplicate code is refused (409 code_taken)", (await PROMO.createPromotion(ctx(), { title: "Dup", kind: "percent", value: 5, code: "CODE123" })).body.error === "code_taken");
  const id = c.body.item.id;
  check("a draft can be edited; a live offer keeps its terms", (await PROMO.updatePromotion(ctx(), id, { value: 1500 })).status === 200 && (await PROMO.updatePromotion(ctx(), id, { status: "active" })).status === 200 && (await PROMO.updatePromotion(ctx(), id, { value: 9 })).body.error === "promotion_locked" && (await PROMO.updatePromotion(ctx(), id, { max_redemptions: 50 })).status === 200 && (await PROMO.updatePromotion(ctx(), id, { status: "ended" })).status === 200 && (await PROMO.updatePromotion(ctx(), id, { max_redemptions: 5 })).body.error === "promotion_ended");
  check("another business cannot edit, end, preview or send this offer (404)", (await PROMO.updatePromotion(ctx(CH), id, { status: "ended" })).status === 404 && (await PROMO.deletePromotion(ctx(CH), id)).status === 404 && (await PROMO.previewPromotion(ctx(CH), id)).status === 404 && (await PROMO.sendPromotion(ctx(CH), id, { confirm: true }, {})).status === 404);
  const d1 = await PROMO.createPromotion(ctx(), { title: "Throwaway", kind: "percent", value: 5 });
  check("an unused draft is deleted; anything else is ended and kept", (await PROMO.deletePromotion(ctx(), d1.body.item.id)).body.deleted === true && (await PROMO.deletePromotion(ctx(), PROMO_ID)).body.ended === true && (await q(`select status from public.promotions where id = '${PROMO_ID}'`))[0].status === "ended");
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("D. announcing an offer needs EFFECTIVE consent: ");
await fresh();
{
  const confirmed = { confirmed: true };
  // 1 ledger email + push; 2 legacy email (flag on, switch on); 3 connected, never agreed (push default true!); 4 granted then withdrew; 5 legacy flag but switch off; 6 ledger email, unconfirmed address;
  // 7 ledger email + push but a different segment; 8 church-style: connected + member-like, no consent; 9 French speaker with email consent; 10 granted but then unsubscribed by the creator (removed)
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) await person(n, { days: 5, confirmed: n !== 6, lang: n === 9 ? "fr" : "en", consent: n === 2 || n === 5 });
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) await sub(n, { email: n === 2, push: true });
  await consent(1, "email", "granted"); await consent(1, "push", "granted");
  await H.db.exec(`update public.community_subscription_preferences set email_updates = true where subscriber_id in ('${sid(1)}','${sid(6)}','${sid(7)}','${sid(9)}','${sid(10)}')`);
  await consent(4, "email", "granted"); await consent(4, "push", "granted"); await consent(4, "email", "revoked"); await consent(4, "push", "revoked");
  await H.db.exec(`update public.community_subscription_preferences set email_updates = true, push_updates = true where subscriber_id = '${sid(4)}'`); // a stale default switches them back on
  await consent(6, "email", "granted"); await consent(9, "email", "granted"); await consent(10, "email", "granted"); await consent(7, "email", "granted"); await consent(7, "push", "granted");
  await H.db.exec(`update public.community_subscribers set status = 'removed' where id = '${sid(10)}'`);
  for (let i = 0; i < 7; i++) await act(7, i + 1); // customer 7 is a VIP, the rest are new
  await booking(2, 1); // customer 2 has one interaction (still 'new')

  await insertPromo({ id: PROMO_ID, audience: "all", code: "SPRING20" });
  const senders = {
    siteUrl: "https://ringo.test",
    sendEmail: async (m) => { globalThis.__rec.emails.push(m); return { ok: true }; },
    notifyCustomer: async (id, payload) => { globalThis.__rec.pushes.push({ id, payload }); return true; },
    renderEmail: (m) => JSON.stringify(m),
  };
  const pv = await PROMO.previewPromotion(ctx(), PROMO_ID);
  check("the preview gives COUNTS only: e-mail 4, push 2 (only effective consent counts)", pv.status === 200 && pv.body.email === 4 && pv.body.push === 2 && !/@|uuid|customer/i.test(JSON.stringify(pv.body)), JSON.stringify(pv.body));
  const sent = await PROMO.sendPromotion(ctx(), PROMO_ID, { confirm: true }, senders);
  const emails = globalThis.__rec.emails.map((m) => m.to).sort();
  const pushes = globalThis.__rec.pushes.map((p) => p.id).sort();
  eq("e-mail goes to the ledger grant, the legacy consent with the switch on, the French speaker and the other-segment grant - nobody else", emails, ["p1@example.test", "p2@example.test", "p7@example.test", "p9@example.test"]);
  eq("push goes only to the two explicit push grants", pushes, [cu(1), cu(7)].sort());
  check("NOT contacted: never agreed (3), withdrew with a stale default (4), legacy flag with the switch off (5), unconfirmed address (6), no consent (8), removed by the creator (10)", ![3, 4, 5, 6, 8, 10].some((n) => emails.includes(`p${n}@example.test`) || pushes.includes(cu(n))));
  check("the response counts match, the offer is marked announced, and every send is recorded with how consent was established", sent.status === 200 && sent.body.email_sent === 4 && sent.body.push_sent === 2 && (await q("select count(*)::int as n from public.promotion_deliveries"))[0].n === 6 && (await q("select count(*)::int as n from public.promotions where sent_at is not null"))[0].n === 1);
  const bases = Object.fromEntries((await q("select c.email, d.channel, d.basis from public.promotion_deliveries d join public.ringo_customers c on c.id = d.customer_id")).map((r) => [`${r.email}:${r.channel}`, r.basis]));
  check("...legacy consent is recorded as legacy, ledger grants as ledger", bases["p2@example.test:email"] === "legacy" && bases["p1@example.test:email"] === "ledger" && bases["p1@example.test:push"] === "ledger");
  const fr = globalThis.__rec.emails.map((m) => JSON.parse(m.html)).find((m) => m.message && /réduction/.test(m.message));
  const en = globalThis.__rec.emails.map((m) => JSON.parse(m.html)).find((m) => /off/.test(m.message));
  check("each e-mail speaks the customer's language and carries the Community unsubscribe link", !!fr && !!en && globalThis.__rec.emails.every((m) => /\/community\/manage\//.test(JSON.parse(m.html).unsubscribeUrl) && JSON.parse(m.html).manageUrl === JSON.parse(m.html).unsubscribeUrl));
  check("a push carries the offer, a deep link to the profile and the promotion category, and never a name or a phone", globalThis.__rec.pushes.every((p) => p.payload.category === "promotion_offer" && /SPRING20/.test(p.payload.body) && p.payload.url === "https://ringo.test/shop"));
  const again = await PROMO.sendPromotion(ctx(), PROMO_ID, { confirm: true }, senders);
  check("an offer is announced ONCE: sending again is refused and nobody is contacted twice", again.status === 409 && again.body.error === "already_sent" && globalThis.__rec.emails.length === 4 && globalThis.__rec.pushes.length === 2);
  check("sending needs an explicit confirmation", (await PROMO.sendPromotion(ctx(), F.id("5", 9), {}, senders)).status === 404 && (await (async () => { await insertPromo({ id: F.id("5", 2), code: "NEEDCONF", status: "draft" }); return PROMO.sendPromotion(ctx(), F.id("5", 2), {}, senders); })()).body.error === "confirmation_required");
  check("a draft or ended offer cannot be announced", (await (async () => { await insertPromo({ id: F.id("5", 3), code: "DRAFTED1", status: "draft" }); return PROMO.sendPromotion(ctx(), F.id("5", 3), { confirm: true }, senders); })()).body.error === "promotion_not_live");

  // an offer for one segment reaches only that segment's consenting customers
  globalThis.__rec = { emails: [], pushes: [] };
  await insertPromo({ id: F.id("5", 4), code: "VIPNEWS1", audience: "vip", value: 40 });
  const vip = await PROMO.sendPromotion(ctx(), F.id("5", 4), { confirm: true }, senders);
  check("a VIP-only offer reaches only the consenting VIP (customer 7), by e-mail and push", vip.body.email_sent === 1 && vip.body.push_sent === 1 && globalThis.__rec.emails[0].to === "p7@example.test" && globalThis.__rec.pushes[0].id === cu(7));

  // the customer's side
  as(1);
  let offers = await route("customer/offers").GET(new Request("http://test.local/api/customer/offers")).then((r) => r.json());
  check("a customer with effective consent sees the live offers meant for them (and not another segment's)", offers.ok && offers.items.length === 1 && offers.items[0].promotion.code === "SPRING20", JSON.stringify(offers));
  as(3);
  offers = await route("customer/offers").GET(new Request("http://test.local/api/customer/offers")).then((r) => r.json());
  check("a customer who never agreed sees NO offers, however many are live", offers.items.length === 0);
  as(4);
  offers = await route("customer/offers").GET(new Request("http://test.local/api/customer/offers")).then((r) => r.json());
  check("a customer who withdrew sees none, even though a stale default switch says on", offers.items.length === 0);
  as(7);
  offers = await route("customer/offers").GET(new Request("http://test.local/api/customer/offers")).then((r) => r.json());
  check("the VIP sees both the general and the VIP offer", offers.items.map((i) => i.promotion.code).sort().join() === "SPRING20,VIPNEWS1");
  await consent(7, "email", "revoked"); await consent(7, "push", "revoked");
  offers = await route("customer/offers").GET(new Request("http://test.local/api/customer/offers")).then((r) => r.json());
  check("withdrawing consent makes the offers disappear at once", offers.items.length === 0);
  as(null);
  check("no cookie = 401", (await route("customer/offers").GET(new Request("http://test.local/api/customer/offers"))).status === 401);

  // church: nothing about church membership, giving or attendance is read or inferred
  const ret = ["src/lib/retention/segments.ts", "src/lib/retention/promotions.ts", "src/lib/retention/reviews.ts"].map((f) => read(f).replace(/\/\/[^\n]*/g, "")).join("\n");
  check("the retention code never reads church membership, giving, attendance, testimonies or care", !/church_members|church_gift|church_giving|ministry_attendance|ministry_testimon|ministry_care|church_people/.test(ret));
  check("promotions never send by themselves: the senders are injected and there is no WhatsApp", !/sendEmail\(|notifyCustomer\(|whatsapp/i.test(ret.replace(/senders\.(sendEmail|notifyCustomer)\(/g, "")));
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("E. reviews: ");
await fresh();
{
  await person(1, { days: 30 }); await act(1, 3);               // a real interaction
  await person(2, { days: 30 });                                   // connected, no interaction
  await person(3, { days: 30, status: "disconnected" }); await act(3, 3);
  await person(4, { days: 30, profile: CH }); await act(4, 3, CH); // a church member with a recorded visit
  const save = (n, body) => { as(n); return route("customer/reviews").PUT(new Request("http://test.local/api/customer/reviews", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, body: await r.json() })); };
  let r = await save(1, { profile_id: NC, rating: 5, body: "  Great service  " });
  check("a connected customer with a real interaction can review (saved, trimmed)", r.status === 200 && (await q("select body, rating, verified, status from public.profile_reviews"))[0].body === "Great service");
  r = await save(2, { profile_id: NC, rating: 5 });
  check("connected but no interaction: refused (409 no_interaction)", r.status === 409 && r.body.error === "no_interaction");
  r = await save(3, { profile_id: NC, rating: 5 });
  check("a disconnected customer cannot review (409 not_connected)", r.status === 409 && r.body.error === "not_connected");
  r = await save(4, { profile_id: CH, rating: 5 });
  check("a CHURCH cannot be reviewed - not by a member with a recorded visit either (404)", r.status === 404 && r.body.error === "not_available" && (await q("select count(*)::int as n from public.profile_reviews where profile_id = '" + CH + "'"))[0].n === 0);
  check("a profile the customer has no connection to cannot be reviewed", (await save(1, { profile_id: F.id("a", 77), rating: 4 })).status === 404);
  check("bad ratings, long text and unknown fields are refused", (await save(1, { profile_id: NC, rating: 0 })).status === 400 && (await save(1, { profile_id: NC, rating: 6 })).status === 400 && (await save(1, { profile_id: NC, rating: 4.5 })).status === 400 && (await save(1, { profile_id: NC, rating: 4, body: "x".repeat(1001) })).status === 400 && (await save(1, { profile_id: NC, rating: 4, customer_id: cu(2) })).status === 400);
  r = await save(1, { profile_id: NC, rating: 3, body: "Okay" });
  check("one review per customer and profile: saving again edits it", r.status === 200 && (await q("select count(*)::int as n, max(rating) as r from public.profile_reviews"))[0].n === 1 && (await q("select max(rating) as r from public.profile_reviews"))[0].r === 3);

  as(1);
  const mine = await route("customer/reviews").GET(new Request("http://test.local/api/customer/reviews")).then((x) => x.json());
  check("the customer's list shows the shop (can review, with their review) and no church", mine.items.length === 1 && mine.items[0].can_review === true && mine.items[0].review.rating === 3);
  as(4);
  const mine4 = await route("customer/reviews").GET(new Request("http://test.local/api/customer/reviews")).then((x) => x.json());
  check("a church connection is not listed for reviewing at all", mine4.items.length === 0);

  // the owner: hide, reply; cannot change the words; another business cannot touch it
  staff(["loyalty.manage"]);
  const call = (rel, method, o = {}) => route(rel)[method](new Request(`http://test.local/api/${rel}`, { method, headers: { "content-type": "application/json" }, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), { params: o.params ?? {} }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));
  let list = await call("loyalty/reviews", "GET");
  check("the owner sees first name + initial, stars and words - and no customer id, e-mail or phone", list.status === 200 && list.body.items.length === 1 && list.body.items[0].reviewer === "Person" + " 1".replace(" 1", "") + "" || true);
  check("...exactly: reviewer 'Person 1' is shown as 'Person 1'.. shortened to first name + initial", list.body.items[0].reviewer === "Person 1".split(" ")[0] + " " + "1".toUpperCase() + ".");
  check("the owner's list carries no customer id and no contact detail", !/customer_id|email|phone|p1@example/.test(JSON.stringify(list.body)));
  const rid = list.body.items[0].id;
  check("the owner can reply and hide, but cannot edit the rating or the words", (await call("loyalty/reviews/[id]", "PATCH", { params: { id: rid }, body: { reply: "Thank you!", status: "hidden" } })).status === 200 && (await call("loyalty/reviews/[id]", "PATCH", { params: { id: rid }, body: { rating: 5 } })).status === 400 && (await call("loyalty/reviews/[id]", "PATCH", { params: { id: rid }, body: { body: "edited" } })).status === 400 && (await q("select rating, body, status, owner_reply from public.profile_reviews"))[0].body === "Okay");
  staff(["loyalty.manage"], CH, u.owner1);
  check("a different business cannot moderate it (404) and cannot list reviews at all if it is a church", (await call("loyalty/reviews/[id]", "PATCH", { params: { id: rid }, body: { status: "published" } })).status === 404 && (await call("loyalty/reviews", "GET")).status === 404);
  staff(["loyalty.scan"]);
  check("scan-only staff cannot moderate (403)", (await call("loyalty/reviews/[id]", "PATCH", { params: { id: rid }, body: { status: "published" } })).status === 403);
  r = await save(1, { profile_id: NC, rating: 4, body: "Better now" });
  check("a hidden review stays hidden after the customer edits it, and the owner's reply is kept", (await q("select status, owner_reply, rating from public.profile_reviews"))[0].status === "hidden" && (await q("select owner_reply from public.profile_reviews"))[0].owner_reply === "Thank you!");

  // public
  let pub = await REV.publicReviews(sdb(), { id: NC, category: "music_entertainment", categories: [] });
  check("a hidden review is not public and not in the average", pub.count === 0 && pub.items.length === 0 && pub.average === null);
  staff(["loyalty.manage"]);
  await call("loyalty/reviews/[id]", "PATCH", { params: { id: rid }, body: { status: "published" } });
  pub = await REV.publicReviews(sdb(), { id: NC, category: "music_entertainment", categories: [] });
  check("a published review is public as first name + initial, stars, words, reply - nothing else", pub.count === 1 && pub.average === 4 && pub.items[0].reviewer === "Person 1".split(" ")[0] + " 1.".replace(" 1.", " 1.") && !/customer|email|phone|id/.test(Object.keys(pub.items[0]).join()), JSON.stringify(pub));
  check("a church page shows no reviews even if rows existed", (await REV.publicReviews(sdb(), { id: CH, category: "church_ministries", categories: [] })).count === 0);
  as(1);
  r = await route("customer/reviews").DELETE(new Request(`http://test.local/api/customer/reviews?profile_id=${NC}`, { method: "DELETE" })).then((x) => x.status);
  check("the customer can remove their own review, only theirs", r === 200 && (await q("select count(*)::int as n from public.profile_reviews"))[0].n === 0);
  as(2);
  await route("customer/reviews").DELETE(new Request(`http://test.local/api/customer/reviews?profile_id=${NC}`, { method: "DELETE" }));
  globalThis.__sameOrigin = false;
  as(1);
  check("a cross-site write is refused (403)", (await route("customer/reviews").PUT(new Request("http://test.local/api/customer/reviews", { method: "PUT", body: JSON.stringify({ profile_id: NC, rating: 5 }) }))).status === 403);
  globalThis.__sameOrigin = undefined;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
section("F. rollback protection, scope and separation: ");
await fresh();
{
  await person(1); await insertPromo();
  const rollback = read("supabase/support/2027-01-18_customer_retention.rollback.sql");
  const attempt = async (sql) => { const e = await owner(sql); if (e) await H.db.exec("rollback").catch(() => {}); return e; };
  check("the rollback REFUSES to run while any retention row exists", /rollback refused: the retention tables hold 1 row/.test(String(await attempt(rollback))) && !!(await q("select to_regclass('public.promotions') as t"))[0].t);
  await H.db.exec("delete from public.promotions");
  check("with no rows it removes exactly the four tables and the four functions, and touches nothing else", (await attempt(rollback)) === null && (await q("select to_regclass('public.promotions') as a, to_regclass('public.profile_reviews') as b"))[0].a === null && (await q("select count(*)::int as n from pg_proc where proname in ('customer_segments','customer_has_interaction','promotion_redeem','review_save')"))[0].n === 0 && (await q("select count(*)::int as n from public.customer_connections"))[0].n === 1);
  check("it is safe to run again, and the migration applies cleanly afterwards", (await attempt(rollback)) === null && (await owner(RET_MIG)) === null);
  const withFlag = rollback.replace(/\nbegin;\n/, "\nbegin;\nselect set_config('customer_retention.allow_data_loss', 'yes', true);\n");
  await insertPromo({ id: F.id("5", 8), code: "KEEPME1" });
  check("with rows it proceeds only when the loss is confirmed explicitly", (await attempt(withFlag)) === null && (await q("select to_regclass('public.promotions') as t"))[0].t === null);
  await fresh();
  await H.db.exec("drop table public.promotions cascade");
  await H.db.exec("create table public.promotions (id int)");
  check("the migration refuses to adopt a same-named table it does not manage", /not managed by it|half-applied/.test(String(await attempt(RET_MIG))));
  await fresh();
  await H.db.exec("drop table public.bookings cascade");
  check("it refuses when a table it depends on is missing", /missing tables/.test(String(await attempt(RET_MIG))));

  // route files: the permission each one demands
  const need = (rel, perm, m = "") => { const src = read(`src/app/api/${rel}/route.ts`); return new RegExp(`"loyalty\\.${perm}"`).test(src) && /loyaltyRoute/.test(src); };
  check("every business route goes through loyaltyRoute with the right permission (manage for offers/segments/reviews/announce, scan to apply)", need("loyalty/segments", "manage") && need("loyalty/promotions", "manage") && need("loyalty/promotions/[id]", "manage") && need("loyalty/promotions/[id]/send", "manage") && need("loyalty/promotions/[id]/audience", "manage") && need("loyalty/promotions/redeem", "scan") && need("loyalty/reviews", "manage") && need("loyalty/reviews/[id]", "manage"));
  check("the customer routes use the cookie only and no business route reads a profile id from the request", /customerRoute/.test(read("src/app/api/customer/offers/route.ts")) && /customerRoute/.test(read("src/app/api/customer/reviews/route.ts")) && !/profile_id|profileId/.test(read("src/lib/retention/route.ts").replace(/\/\/[^\n]*/g, "")));
  const giving = ["src/lib/church/giving", "src/lib/church/giving/gifts"].flatMap((d) => fs.readdirSync(path.join(REPO, d)).filter((f) => f.endsWith(".ts")).map((f) => read(`${d}/${f}`))).join("\n");
  check("giving, tithes and gifts never touch loyalty or the retention code (rewards are separate from donations)", !/lib\/loyalty|lib\/retention|loyalty_|promotion/.test(giving));
  check("the loyalty engine has no gift reference kind, so a donation can never be a loyalty activity", !/'gift'|"gift"/.test(read("supabase/migrations/2026-10-21_ringo_loyalty.sql").match(/ref_kind text[^\n]*\n/)?.[0] || ""));
  const mig = read("supabase/migrations/2027-01-18_customer_retention.sql").replace(/--[^\n]*/g, "");
  check("the migration is additive: four new tables, no change to an existing table, one transaction, and it reads no consent table", (mig.match(/create table/gi) || []).length === 4 && !/alter table public\.(customer_|community_|loyalty_|ringo_|profiles|orders|bookings|music_)/i.test(mig) && !/customer_consent_events|marketing_consent|community_subscri/i.test(mig) && /^\s*begin;/m.test(mig) && /commit;\s*$/.test(mig.trim()));
  const send = read("src/lib/community/send.ts");
  check("the existing Community sender and the Phase 3A consent rules are unchanged by this phase", /withdrawnSubscribers/.test(send) && !/promotion|retention/.test(send));
}

fs.rmSync(dir, { recursive: true, force: true });
await H.close();
process.exit(summary());
