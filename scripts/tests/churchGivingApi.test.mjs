// Churches & Ministries expansion, Phase 7: giving and care FUND DEFINITIONS. The staff routes and the public loader, validated end to end and OFFLINE.
// The REAL route files (src/app/api/church/giving-funds/**), the REAL handlers, validation and actor resolution run against scratch in-memory PostgreSQL (PGlite) that holds the REAL migrations.
// This phase collects no money: the tests also prove nothing in the giving code touches the Shop ledger or Fapshi, and that a fund can never be opened. All data is synthetic.
//   Run:  node scripts/tests/churchGivingApi.test.mjs
import fs from "fs";
import path from "path";
import { createHarness, kit, SRC } from "./ministryApiHarness.mjs";

const H = await createHarness({ dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors: true, customers: true, bibleYear: true, counselling: true, giving: true });
const { F, jiti } = H;
const { u, prof } = F;
const { check, eq, is, section, summary } = kit();
console.error = () => {};
console.info = () => {};

const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const MODS = jiti(path.join(SRC, "lib/church/modules.ts"));
const GV = jiti(path.join(SRC, "lib/church/giving/handlers.ts"));
const PG = jiti(path.join(SRC, "lib/church/public/giving.ts"));
const FEAT = jiti(path.join(SRC, "lib/church/features/handlers.ts"));

const MANAGER = F.id("c", 741), OTHER = F.id("c", 742);
const R = { manage: F.id("b", 741), other: F.id("b", 742) };
const EXTRA = `
  insert into public.users (id, role, plan_id) values ('${MANAGER}','user','${F.plan.free}'), ('${OTHER}','user','${F.plan.free}');
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${R.manage}','${prof.c1}','gmanage','Giving manager','{church.giving.manage}'),
    ('${R.other}','${prof.c1}','gother','Members and care','{church.members.view,church.members.manage,church.care.manage,church.counselling.manage}');
  insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${MANAGER}','${R.manage}'), ('${prof.c1}','${OTHER}','${R.other}');
`;
const O = u.owner1;
const BODY = (o = {}) => ({ kind: "giving", title_en: "Building fund", title_fr: "Fonds de construction", description_en: "Help us build.", description_fr: "Aidez-nous à construire.", goal_xaf: 500000, is_published: false, ...o });
const list = (who) => H.call(who, "GET", "church/giving-funds");
const add = (who, body) => H.call(who, "POST", "church/giving-funds", { body });
const patch = (who, id, body) => H.call(who, "PATCH", "church/giving-funds/[id]", { params: { id }, body });
const del = (who, id, v) => H.call(who, "DELETE", `church/giving-funds/[id]${v ? "?expected_updated_at=" + encodeURIComponent(v) : ""}`, { params: { id } });
const stamp = (id) => H.stamp("church_giving_funds", id);
const count = async () => (await H.rows("select count(*)::int n from public.church_giving_funds"))[0].n;

section("A. pure rules: ");
{
  check("church.giving.manage is a registered, SENSITIVE church permission (owner-only to grant)", PERM.CHURCH_PERMISSIONS.includes("church.giving.manage") && PERM.isSensitiveChurchPermissionName("church.giving.manage"));
  check("capability manageGiving comes from church.giving.manage only", PERM.churchCapabilities(["church.giving.manage"]).manageGiving === true && PERM.churchCapabilities(["church.members.manage", "church.care.publish", "church.counselling.manage", "church.export"]).manageGiving === false);
  const keys = (p, owner = false) => MODS.accessibleChurchModules(PERM.churchCapabilities(p), owner).map((m) => m.key);
  check("the Giving module appears only for a person with the giving permission", keys(["church.giving.manage"]).includes("giving") && !keys(["church.members.view", "church.care.manage"]).includes("giving") && keys(PERM.CHURCH_PERMISSIONS, true).includes("giving"));
  eq("collection is not available in the application", FEAT.GIVING_AVAILABLE, false);
  const s = PG.shapeFund;
  check("public fund shape: a good row passes; a bad kind, a missing title or a negative goal does not leak through", s({ id: "x", kind: "giving", title_en: "A", title_fr: "B", description_en: " ", description_fr: "d", goal_xaf: 1000 }).description_en === null && s({ id: "x", kind: "loan", title_en: "A", title_fr: "B" }) === null && s({ id: "x", kind: "care", title_en: "", title_fr: "B" }) === null && s({ id: "x", kind: "care", title_en: "A", title_fr: "B", goal_xaf: -5 }).goal_xaf === null);
  check("public fund shape: only the public fields come out (no status, no dates, no profile id)", Object.keys(s({ id: "x", kind: "giving", title_en: "A", title_fr: "B", profile_id: "p", status: "open", created_at: "z", closed_at: "z", is_published: true })).sort().join() === "description_en,description_fr,goal_xaf,id,kind,title_en,title_fr");
}

section("B. who can reach the funds: ");
{
  await H.fresh(EXTRA);
  is("anonymous: 401", await list(null), 401);
  is("a stranger: 403", await list(u.stranger), 403);
  is("a members manager: 403", await list(u.mgr1), 403);
  is("a role with members, care and counselling rights but no giving right: 403", await list(OTHER), 403);
  is("a group leader (not staff): 403", await list(u.leader1), 403);
  is("a platform admin who is not the owner: 403", await list(u.admin), 403);
  is("a stranger cannot add: 403", await add(u.stranger, BODY()), 403);
  is("a members manager cannot add: 403", await add(u.mgr1, BODY()), 403);
  is("a platform admin who is not the owner cannot add: 403", await add(u.admin, BODY()), 403);
  eq("nothing was stored by the refused calls", await count(), 0);
  is("the owner reads the (empty) list", await list(O), 200, "ok");
  is("a giving manager reads the list", await list(MANAGER), 200, "ok");
  is("an unexpected query: 400", await H.call(O, "GET", "church/giving-funds?x=1"), 400, "unexpected_field");
  const other = await H.call(u.owner2, "GET", "church/giving-funds");
  check("the owner of another church sees only their own church's funds", other.status === 200 && other.body.items.length === 0);
}

section("C. adding, editing and the validation: ");
{
  await H.fresh(EXTRA);
  const made = await add(O, BODY());
  is("the owner adds a fund: 201", made, 201, "ok");
  check("it starts as a private draft", made.body.item.status === "draft" && made.body.item.is_published === false && made.body.item.closed_at === null, JSON.stringify(made.body.item));
  const id = made.body.item.id;
  is("a giving manager adds a care fund with no goal", await add(MANAGER, BODY({ kind: "care", goal_xaf: null, title_en: "Care fund", title_fr: "Fonds d'entraide" })), 201, "ok");
  is("a missing kind: 400", await add(O, (({ kind, ...r }) => r)(BODY())), 400, "invalid_kind");
  is("an unknown kind: 400", await add(O, BODY({ kind: "loan" })), 400, "invalid_kind");
  is("an empty title: 400", await add(O, BODY({ title_en: " " })), 400, "invalid_title");
  is("a title with markup: 400", await add(O, BODY({ title_fr: "<b>x</b>" })), 400, "invalid_title");
  is("a 121-character title: 400", await add(O, BODY({ title_en: "x".repeat(121) })), 400, "invalid_title");
  is("a description over 600 characters: 400", await add(O, BODY({ description_en: "x".repeat(601) })), 400, "invalid_description");
  for (const g of [500, 1000000001, 1500.5, "5000", -1000]) is(`a goal of ${JSON.stringify(g)}: 400`, await add(O, BODY({ goal_xaf: g })), 400, "invalid_goal");
  is("a status cannot be sent on creation: 400", await add(O, BODY({ status: "closed" })), 400, "unexpected_field");
  for (const f of ["profile_id", "id", "closed_at", "created_at", "received_xaf", "amount", "donor"]) is(`${f} is refused, never ignored: 400`, await add(O, BODY({ [f]: "x" })), 400, "unexpected_field");
  eq("only the two good funds were stored", await count(), 2);

  const v = await stamp(id);
  is("the version is mandatory: 400", await patch(O, id, { title_en: "Renamed" }), 400, "invalid_body");
  is("a stale version: 409", await patch(O, id, { title_en: "Renamed", expected_updated_at: "2020-01-01T00:00:00Z" }), 409, "stale");
  is("the kind cannot be changed: 400", await patch(O, id, { kind: "care", expected_updated_at: v }), 400, "unexpected_field");
  is("nothing to change: 400", await patch(O, id, { expected_updated_at: v }), 400, "empty_update");
  is("a stranger cannot edit: 403", await patch(u.stranger, id, { title_en: "Hack", expected_updated_at: v }), 403);
  is("a members manager cannot edit: 403", await patch(u.mgr1, id, { title_en: "Hack", expected_updated_at: v }), 403);
  const edited = await patch(O, id, { title_en: "Renamed", goal_xaf: 750000, is_published: true, expected_updated_at: v });
  is("the owner edits a fund", edited, 200, "ok");
  check("...the answer holds the new values", edited.body.item.title_en === "Renamed" && edited.body.item.goal_xaf === 750000 && edited.body.item.is_published === true);
  is("the old version can no longer be used: 409", await patch(O, id, { title_en: "Again", expected_updated_at: v }), 409, "stale");
}

section("D. a fund can never be opened: ");
{
  await H.fresh(EXTRA);
  const made = await add(O, BODY());
  const id = made.body.item.id;
  const v = await stamp(id);
  is("opening a fund is refused plainly: 409 giving_unavailable", await patch(O, id, { status: "open", expected_updated_at: v }), 409, "giving_unavailable");
  is("a giving manager is refused too", await patch(MANAGER, id, { status: "open", expected_updated_at: v }), 409, "giving_unavailable");
  is("an unknown status: 400", await patch(O, id, { status: "paid", expected_updated_at: v }), 400, "invalid_status");
  eq("the fund is still a draft", (await H.rows(`select status from public.church_giving_funds where id = '${id}'`))[0].status, "draft");
  // the database refuses it even if the application were bypassed
  const direct = await H.rows("select 1 as x").then(() => F.svcErr(H.db, `update public.church_giving_funds set status = 'open' where id = '${id}'`));
  check("the database refuses it as well (the server's own session included)", direct && direct.code === "23514", JSON.stringify(direct));
  const closed = await patch(O, id, { status: "closed", expected_updated_at: v });
  check("a fund can be closed, and the closing time is stamped by the database", closed.status === 200 && closed.body.item.status === "closed" && !!closed.body.item.closed_at, JSON.stringify(closed.body));
  const back = await patch(O, id, { status: "draft", expected_updated_at: await stamp(id) });
  check("and put back to draft, which clears it", back.status === 200 && back.body.item.status === "draft" && back.body.item.closed_at === null);
  is("the owner cannot switch giving on (feature gate)", await H.call(O, "PUT", "church/features", { body: { giving: true } }), 409, "giving_unavailable");
}

section("E. delete and the limit: ");
{
  await H.fresh(EXTRA);
  const a = (await add(O, BODY())).body.item;
  is("a stranger cannot delete: 403", await del(u.stranger, a.id, await stamp(a.id)), 403);
  is("a members manager cannot delete: 403", await del(u.mgr1, a.id, await stamp(a.id)), 403);
  is("the version is mandatory: 400", await del(O, a.id), 400, "invalid_body");
  is("a stale version: 409", await del(O, a.id, "2020-01-01T00:00:00Z"), 409, "stale");
  is("a bad id: 404", await del(O, "nope", "2020-01-01T00:00:00Z"), 404);
  is("a giving manager deletes", await del(MANAGER, a.id, await stamp(a.id)), 200, "ok");
  eq("...none is left", await count(), 0);
  is("deleting it again: 404", await del(MANAGER, a.id, "2020-01-01T00:00:00Z"), 404, "not_found");
  for (let i = 0; i < GV.FUND_LIMIT; i++) await F.svc(H.db, `insert into public.church_giving_funds (profile_id, kind, title_en, title_fr) values ('${prof.c1}','giving','F${i}','F${i}')`);
  const l = await list(O);
  check("the list never returns more than the limit", l.status === 200 && l.body.items.length === GV.FUND_LIMIT && l.body.limit === GV.FUND_LIMIT);
}

section("F. what the public sees: ");
{
  await H.fresh(EXTRA);
  const pub = (await add(O, BODY({ is_published: true }))).body.item;
  await add(O, BODY({ title_en: "Private draft", title_fr: "Brouillon", is_published: false }));
  const anon = F.sessionFor(H.db, null);
  eq("giving switched OFF: the public sees no fund, even a published one", await PG.loadPublicFunds(anon, prof.c1), []);
  await F.svc(H.db, `insert into public.church_features (profile_id, giving) values ('${prof.c1}', true)`);
  const seen = await PG.loadPublicFunds(anon, prof.c1);
  check("giving switched on (simulated by the server): only the published fund, with public fields only", seen.length === 1 && seen[0].id === pub.id && Object.keys(seen[0]).sort().join() === "description_en,description_fr,goal_xaf,id,kind,title_en,title_fr", JSON.stringify(seen));
  eq("another church has none", await PG.loadPublicFunds(anon, prof.c2), []);
  eq("a broken client gives an empty list, never an error", await PG.loadPublicFunds({ from() { throw new Error("x"); } }, prof.c1), []);
}

section("G. no money, no ledger (static): ");
{
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const files = ["lib/church/giving/handlers.ts", "lib/church/giving/kinds.ts", "lib/church/public/giving.ts", "app/api/church/giving-funds/route.ts", "app/api/church/giving-funds/[id]/route.ts", "components/church/giving/GivingView.tsx", "app/dashboard/church/giving/page.tsx"];
  const code = files.map((f) => strip(fs.readFileSync(path.join(SRC, f), "utf8")));
  check("no giving file mentions Fapshi, the Shop ledger, payments, payouts, commissions or the service role", code.every((t) => !/fapshi|commerce_|customer_payments|product_orders|payout|commission|createAdminClient|service_role|checkout/i.test(t)), files.filter((f, i) => /fapshi|commerce_|customer_payments|product_orders|payout|commission|createAdminClient|service_role|checkout/i.test(code[i])).join());
  const walk = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e.name)) out.push(p); } return out; };
  const zones = ["lib/ai", "lib/analytics", "lib/overview", "lib/reports", "lib/watchdog", "lib/activity", "lib/fapshi.ts", "lib/fapshiSafety.ts", "lib/applyPayment.ts"].map((z) => path.join(SRC, z)).filter((z) => fs.existsSync(z));
  const all = zones.flatMap((z) => (fs.statSync(z).isDirectory() ? walk(z) : [z]));
  const leaks = all.filter((f) => /church_giving|giving-funds/.test(strip(fs.readFileSync(f, "utf8"))));
  check("no AI, analytics, report, watchdog, activity or payment code reads the funds", leaks.length === 0, leaks.map((f) => path.relative(SRC, f)).join());
  const routes = walk(path.join(SRC, "app/api")).filter((f) => /church|giving/.test(f));
  const visitor = routes.filter((f) => /customer[\\/]church-giving|public[\\/]church-giving/.test(f));
  check("there is no visitor route to give: nothing can be paid", visitor.length === 0, visitor.join());
  check("GIVING_AVAILABLE is false in the source", /export const GIVING_AVAILABLE = false;/.test(fs.readFileSync(path.join(SRC, "lib/church/features/handlers.ts"), "utf8")));
  check("the decisions document exists and names all five open decisions", (() => { const d = fs.readFileSync(path.join(SRC, "../docs/church-giving-decisions.md"), "utf8"); return ["Ringo's percentage", "Fapshi's fee", "Receipts", "Refunds", "Closing a care fund early"].every((k) => d.includes(k)); })());
}

await H.close();
process.exit(summary());
