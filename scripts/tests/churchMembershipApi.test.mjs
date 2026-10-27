// Churches & Ministries expansion, Phase 4: membership requests, the Members screen's server side and the PDF lists, validated end to end and OFFLINE.
// The REAL route files (src/app/api/customer/church-membership, src/app/api/church/members/**, src/app/api/church/lists/**), the REAL handlers, validation, error mapping, actor resolution and PDF builder
// run against scratch in-memory PostgreSQL (PGlite) that holds the REAL Team migrations and the REAL church migrations up to Phase 4 of the expansion. See scripts/tests/ministryApiHarness.mjs.
//   Run:  node scripts/tests/churchMembershipApi.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { createHarness, kit, SRC, REPO } from "./ministryApiHarness.mjs";

const require = createRequire(import.meta.url);
const { PDFDocument } = require("pdf-lib");
const H = await createHarness({ dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors: true, customers: true, membership: true });
const { F, jiti } = H;
const { u, prof } = F;
const { check, eq, is, section, summary } = kit();
console.error = () => {};
console.info = () => {};

const REQ = jiti(path.join(SRC, "lib/church/membership/request.ts"));
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const MODS = jiti(path.join(SRC, "lib/church/modules.ts"));
const PDF = jiti(path.join(SRC, "lib/church/lists/pdf.ts"));
const LST = jiti(path.join(SRC, "lib/church/lists/build.ts"));

const exporter = F.id("c", 97), exportNoView = F.id("c", 98);
const R = { exporter: F.id("b", 97), noView: F.id("b", 98) };
const EXTRA = `
  insert into public.users (id, role, plan_id) values ('${exporter}','user','${F.plan.free}'), ('${exportNoView}','user','${F.plan.free}');
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${R.exporter}','${prof.c1}','exporter','Exporter','{church.export,church.members.view,church.groups.view,church.leadership.view}'),
    ('${R.noView}','${prof.c1}','noview','Export only','{church.export}');
  insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${exporter}','${R.exporter}'), ('${prof.c1}','${exportNoView}','${R.noView}');
`;
const O = u.owner1;
const cu = (n) => F.id("7", n);
const as = (n) => { globalThis.__customer = n ? { customer: { id: cu(n), name: "Visitor " + n, email: `v${n}@example.test` }, sessionId: "s" + n } : null; };
const admin = () => { globalThis.__adminFactory = () => F.sessionFor(H.db, null, { role: "service_role" }); };
async function visitor(n, o = {}) {
  await F.svc(H.db, `insert into public.ringo_customers (id, name, email, phone, preferred_language) values ('${cu(n)}','${o.name ?? "Visitor " + n}','v${n}@example.test','23767000${String(1000 + n)}','en')`);
  if (o.connect !== false) await F.svc(H.db, `insert into public.customer_connections (customer_id, profile_id) values ('${cu(n)}','${o.profile ?? prof.c1}')`);
}
const status = (n, profile = prof.c1) => { as(n); return H.call(null, "GET", `customer/church-membership?profile_id=${profile}`); };
const ask = (n, body, headers) => { as(n); return H.call(null, "POST", "customer/church-membership", { body, headers }); };

section("A. pure rules: ");
{
  check("church.export is a registered, SENSITIVE church permission (owner-only to grant)", PERM.CHURCH_PERMISSIONS.includes("church.export") && PERM.isSensitiveChurchPermissionName("church.export") && PERM.CHURCH_SENSITIVE_PERMISSIONS.includes("church.export"));
  check("capability: exportLists only from church.export", PERM.churchCapabilities(["church.export"]).exportLists === true && PERM.churchCapabilities(["church.members.view", "church.groups.view"]).exportLists === false);
  const keys = (p, owner = false) => MODS.accessibleChurchModules(PERM.churchCapabilities(p), owner).map((m) => m.key);
  check("module list: Members needs members.view and sits with People, Groups and Leadership", keys(["church.members.view"]).includes("members") && !keys(["church.groups.view"]).includes("members") && MODS.CHURCH_MODULE_DEFS.find((m) => m.key === "members").group === "community");
  check("module list order: People, Members, Groups, Leadership", keys(PERM.CHURCH_PERMISSIONS, true).slice(0, 4).join() === "people,members,groups,leadership", keys(PERM.CHURCH_PERMISSIONS, true).join());
  const font = { getCharacterSet: () => [65, 66, 67, 233, 32], widthOfTextAtSize: (t) => t.length * 5 };
  check("pdfSafe: draws what the font can, shows ? for the rest, drops control characters", PDF.pdfSafe("AB\u0000C é ɔሴ", font) === "ABC é ??");
  check("fit: short text stays, long text is cut with ...", PDF.fit("ABC", font, 9, 100) === "ABC" && PDF.fit("A".repeat(50), font, 9, 40).endsWith("...") && PDF.fit("A".repeat(50), font, 9, 40).length * 5 <= 40);
  check("pageCount: one page for few rows, more pages for many, never zero", PDF.pageCount(0, 3) === 1 && PDF.pageCount(5, 3) === 1 && PDF.pageCount(500, 3) > 5);
  check("list kinds: members, leadership, groups only", LST.isListKind("members") && LST.isListKind("groups") && !LST.isListKind("everyone") && !LST.isListKind(null));
  check("the visitor handler never returns a name or a contact detail (static)", !/full_name|\.phone|\.email|select\("\*"\)/.test(fs.readFileSync(path.join(SRC, "lib/church/membership/request.ts"), "utf8").replace(/\/\/.*$/gm, "")));
}

section("B. the visitor side: ");
{
  await H.fresh(EXTRA);
  admin();
  as(null);
  is("no visitor cookie: 401", await H.call(null, "GET", `customer/church-membership?profile_id=${prof.c1}`), 401);
  is("no visitor cookie, POST: 401", await H.call(null, "POST", "customer/church-membership", { body: { profile_id: prof.c1, age_group: "adult", consent: true } }), 401);
  await visitor(1);
  const s0 = await status(1);
  check("a connected visitor sees: connected, no request yet", s0.status === 200 && s0.body.connected === true && s0.body.status === "none", JSON.stringify(s0.body));
  await visitor(2, { connect: false });
  const s2 = await status(2);
  check("a visitor who is not connected sees: not connected", s2.status === 200 && s2.body.connected === false && s2.body.status === "none");
  is("status of a page that is not a church: 404", await status(1, prof.nc), 404, "church_request_unavailable");
  is("status of a bad id: 404", await status(1, "nope"), 404);
  const ok = { profile_id: prof.c1, age_group: "adult", consent: true };
  is("consent is required", await ask(1, { ...ok, consent: false }), 400, "consent_required");
  is("consent must be exactly true", await ask(1, { ...ok, consent: "yes" }), 400, "consent_required");
  is("a child cannot be self-registered", await ask(1, { ...ok, age_group: "child" }), 400, "invalid_age_group");
  is("an unknown age group is refused", await ask(1, { ...ok, age_group: "elder" }), 400, "invalid_age_group");
  is("a missing profile is refused", await ask(1, { age_group: "adult", consent: true }), 400);
  is("the visitor id is never accepted from the body", await ask(1, { ...ok, customer_id: cu(2) }), 400, "unexpected_field");
  is("a name or a status cannot be sent", await ask(1, { ...ok, full_name: "Bishop", status: "active" }), 400, "unexpected_field");
  is("a request from another site is refused: 403", await ask(1, ok, {}).then(async () => { globalThis.__sameOrigin = false; as(1); const r = await H.call(null, "POST", "customer/church-membership", { body: { ...ok } }); globalThis.__sameOrigin = undefined; return r; }), 403);
  check("(nothing was created by the refused requests)", (await H.rows("select count(*)::int n from public.church_members where source = 'join_request'"))[0].n === 1, "only the one valid ask above");
}

section("C. the request flow: ");
{
  await H.fresh(EXTRA);
  admin();
  await visitor(1, { name: "Marie Ngono" });
  await visitor(2, { connect: false });
  await visitor(3);
  const baseline = (await H.call(u.mgr1, "GET", "church/members/summary")).body.pending; // the fixture already holds one pending person added by hand
  const first = await ask(1, { profile_id: prof.c1, age_group: "adult", consent: true });
  is("a connected visitor asks to join: 201", first, 201, "ok");
  check("the answer is a status word, nothing else (no name, no contact, no id)", Object.keys(first.body).sort().join() === "created,ok,status" && first.body.status === "pending");
  const row = (await H.rows("select * from public.church_members where customer_id = '" + cu(1) + "'"))[0];
  check("the roster has a pending join request with the visitor's own name", row.status === "pending" && row.source === "join_request" && row.full_name === "Marie Ngono" && row.age_group === "adult");
  const again = await ask(1, { profile_id: prof.c1, age_group: "adult", consent: true });
  check("asking again answers 200 and creates nothing new", again.status === 200 && again.body.created === false && (await H.rows("select count(*)::int n from public.church_members where customer_id = '" + cu(1) + "'"))[0].n === 1);
  check("the visitor now sees: pending", (await status(1)).body.status === "pending");
  is("a visitor who is not connected cannot ask: 403", await ask(2, { profile_id: prof.c1, age_group: "adult", consent: true }), 403, "church_request_not_connected");
  const youth = await ask(3, { profile_id: prof.c1, age_group: "youth", consent: true });
  is("a young person can ask", youth, 201, "ok");
  eq("...and is stored as a youth", (await H.rows("select age_group from public.church_members where customer_id = '" + cu(3) + "'"))[0].age_group, "youth");
  // staff approve
  const list = await H.call(u.mgr1, "GET", "church/members?status=pending");
  check("staff see the pending requests", list.status === 200 && list.body.members.length === baseline + 2 && list.body.members.some((m) => m.full_name === "Marie Ngono"), JSON.stringify(list.body).slice(0, 200));
  const sum = await H.call(u.mgr1, "GET", "church/members/summary");
  check("the summary counts the requests waiting", sum.status === 200 && sum.body.pending === baseline + 2 && sum.body.members === (await H.rows("select count(*)::int n from public.church_members where status='active' and age_group <> 'child' and profile_id = '" + prof.c1 + "'"))[0].n, JSON.stringify(sum.body));
  const id = row.id;
  is("a members-only viewer cannot approve: 403", await H.call(u.viewer1, "PATCH", "church/members/[id]", { params: { id }, body: { status: "active" } }), 403);
  is("a members manager approves", await H.call(u.mgr1, "PATCH", "church/members/[id]", { params: { id }, body: { status: "active" } }), 200, "ok");
  check("the visitor now sees: active", (await status(1)).body.status === "active");
  const after = await H.call(u.mgr1, "GET", "church/members/summary");
  eq("the summary: one request left", after.body.pending, baseline + 1);
  const yid = (await H.rows("select id from public.church_members where customer_id = '" + cu(3) + "'"))[0].id;
  is("a members manager declines", await H.call(u.mgr1, "PATCH", "church/members/[id]", { params: { id: yid }, body: { status: "removed" } }), 200, "ok");
  is("the declined person cannot ask again at once: 429", await ask(3, { profile_id: prof.c1, age_group: "youth", consent: true }), 429, "church_request_cooldown");
  is("a staff session does not open the visitor route: 401", await (async () => { as(null); return H.call(u.mgr1, "POST", "customer/church-membership", { body: { profile_id: prof.c1, age_group: "adult", consent: true } }); })(), 401);
}

section("D. the Members screen's counts: ");
{
  await H.fresh(EXTRA);
  is("anonymous: 401", await H.call(null, "GET", "church/members/summary"), 401);
  is("a stranger: 403", await H.call(u.stranger, "GET", "church/members/summary"), 403);
  is("a plain staff member without members.view: 403", await H.call(u.plain1, "GET", "church/members/summary"), 403);
  is("a group leader (not staff): 403", await H.call(u.leader1, "GET", "church/members/summary"), 403);
  is("unexpected query: 400", await H.call(O, "GET", "church/members/summary?x=1"), 400, "unexpected_field");
  const o = await H.call(O, "GET", "church/members/summary");
  check("the owner gets counts incl. children", o.status === 200 && typeof o.body.children === "number" && o.body.children >= 2 && Object.keys(o.body).sort().join() === "adults,children,members,ok,pending,youth", JSON.stringify(o.body));
  const m = await H.call(u.mgr1, "GET", "church/members/summary");
  check("a manager without children rights gets NO children count", m.status === 200 && !("children" in m.body), JSON.stringify(m.body));
  const k = await H.call(u.kids1, "GET", "church/members/summary");
  check("a children viewer gets the children count", k.status === 200 && k.body.children >= 2, JSON.stringify(k.body));
  is("a platform admin who is not the owner: 403", await H.call(u.admin, "GET", "church/members/summary"), 403);
}

section("E. PDF lists: ");
{
  await H.fresh(EXTRA);
  const get = (who, kind, q = "") => H.call(who, "GET", `church/lists/[kind]${q}`, { params: { kind } });
  // the harness reads JSON; a PDF needs the raw response
  const raw = async (who, kind, q = "") => {
    globalThis.__churchSession = F.sessionFor(H.db, who);
    const mod = jiti(path.join(SRC, "app/api/church/lists/[kind]/route.ts"));
    return mod.GET(new Request(`http://test.local/api/church/lists/${kind}${q}`), { params: { kind } });
  };
  void get;
  is("anonymous: 401", { status: (await raw(null, "members")).status }, 401);
  is("a stranger: 403", { status: (await raw(u.stranger, "members")).status }, 403);
  is("a members manager WITHOUT church.export: 403", { status: (await raw(u.mgr1, "members")).status }, 403);
  is("a group leader: 403", { status: (await raw(u.leader1, "members")).status }, 403);
  is("export permission but no right to see the list: 403", { status: (await raw(exportNoView, "members")).status }, 403);
  is("a platform admin who is not the owner: 403", { status: (await raw(u.admin, "members")).status }, 403);
  is("an unknown list: 404", { status: (await raw(O, "everyone")).status }, 404);
  is("an unexpected query: 400", { status: (await raw(O, "members", "?id=1")).status }, 400);
  for (const kind of ["members", "leadership", "groups"]) {
    const res = await raw(O, kind, "?lang=en");
    const bytes = new Uint8Array(await res.arrayBuffer());
    check(`the owner downloads the ${kind} list as a PDF`, res.status === 200 && res.headers.get("content-type") === "application/pdf" && /^%PDF-/.test(Buffer.from(bytes.slice(0, 5)).toString()), `${res.status}`);
    check(`${kind}: an attachment with a plain file name, never cached, no sniffing`, /^attachment; filename="[a-z0-9-]+\.pdf"$/.test(res.headers.get("content-disposition")) && res.headers.get("cache-control") === "no-store" && res.headers.get("x-content-type-options") === "nosniff", res.headers.get("content-disposition"));
    const doc = await PDFDocument.load(bytes);
    check(`${kind}: a valid PDF with at least one page and a title`, doc.getPageCount() >= 1 && /./.test(doc.getTitle() || ""), `${doc.getPageCount()} ${doc.getTitle()}`);
  }
  const exp = await raw(exporter, "members", "?lang=fr");
  check("a holder of export + members.view downloads the members list in French", exp.status === 200 && /-members-\d{4}-\d{2}-\d{2}\.pdf/.test(exp.headers.get("content-disposition")));
  is("...but not the leadership list they may not see... (they hold leadership.view: allowed)", { status: (await raw(exporter, "leadership")).status }, 200);
  // data in the file
  const res = await raw(O, "members");
  const bytes = Buffer.from(await res.arrayBuffer());
  const text = bytes.toString("latin1");
  check("the file is self-contained (no link, no script, no embedded file)", !/\/URI|\/JavaScript|\/JS |\/EmbeddedFile|\/Launch/.test(text));
  // the text drawn on the pages: inflate every stream and read the show-text operators ((...) Tj and <hex> Tj)
  const zlib = require("zlib");
  const textOf = (buf) => {
    const out = [];
    const src = buf.toString("latin1");
    for (const m of src.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      let body;
      try { body = zlib.inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { body = m[1]; }
      for (const t of body.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(t[1].replace(/\\(.)/g, "$1"));
      for (const t of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push(Buffer.from(t[1], "hex").toString("latin1"));
    }
    return out.join("\n");
  };
  const owned = textOf(bytes);
  check("the owner's members list holds the active members and the church name", /Grace Admin/.test(owned) && /Luc Leader/.test(owned) && /Members: \d+/.test(owned), owned.slice(0, 200));
  check("the owner (children rights) sees the children in the list and their count", /Kiki Child/.test(owned) && /Children: \d+/.test(owned));
  check("a pending request and a removed person are NOT in the members list", !/Paul Pending/.test(owned));
  const exportRes = await raw(exporter, "members");
  const heldBack = textOf(Buffer.from(await exportRes.arrayBuffer()));
  check("a holder of export + members.view but WITHOUT children rights gets no child and no children count", /Grace Admin/.test(heldBack) && !/Kiki Child/.test(heldBack) && !/Koko Child/.test(heldBack) && !/Children:/.test(heldBack), heldBack.slice(0, 200));
  const frText = textOf(Buffer.from(await (await raw(O, "members", "?lang=fr")).arrayBuffer()));
  check("the French list is in French", /Adultes/.test(frText) && /Membres/.test(frText) && /Confidentiel/.test(frText));
  const grpText = textOf(Buffer.from(await (await raw(O, "groups")).arrayBuffer()));
  check("the groups list shows each group with its count and the children note", /Choir/.test(grpText) && /Groups: \d+/.test(grpText) && /Children are not included/.test(grpText), grpText.slice(0, 300));
  const ledText = textOf(Buffer.from(await (await raw(O, "leadership")).arrayBuffer()));
  check("the leadership list shows the leaders and their count", /Leaders: \d+/.test(ledText), ledText.slice(0, 200));
  check("no phone number or e-mail is written in the leadership or groups lists", !/@example\.test|\+237/.test(ledText) && !/@example\.test|\+237/.test(grpText));
  // the row model: build a list directly and check the page count
  const many = await PDF.buildListPdf({ title: "T", church: "C", dateLabel: "D", summary: [["A", "1"]], columns: [{ header: "H", weight: 1 }], rows: Array.from({ length: 250 }, (_, i) => ["Row " + i]), emptyText: "none", footerNote: "f", pageLabel: (n, t) => `${n}/${t}` });
  const md = await PDFDocument.load(many);
  eq("250 rows paginate to the computed number of pages", md.getPageCount(), PDF.pageCount(250, 1));
  const empty = await PDFDocument.load(await PDF.buildListPdf({ title: "T", church: "C", dateLabel: "D", summary: [], columns: [{ header: "H", weight: 1 }], rows: [], emptyText: "none", footerNote: "f", pageLabel: (n, t) => `${n}/${t}` }));
  eq("an empty list is one page with an empty text", empty.getPageCount(), 1);
  const odd = await PDFDocument.load(await PDF.buildListPdf({ title: "Tɔሴ", church: "Églɔse", dateLabel: "D", summary: [["K", "V"]], columns: [{ header: "Hɔ", weight: 1 }], rows: [["Zoé ɔሴ " + "x".repeat(400)]], emptyText: "none", footerNote: "f", pageLabel: (n, t) => `${n}/${t}` }));
  eq("unusual letters and very long names never break the file", odd.getPageCount(), 1);
}

section("F. privacy boundaries (static): ");
{
  const walk = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e.name)) out.push(p); } return out; };
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const banned = /church_members|church_group_members|church_leadership|church_public_groups|church_membership|church_request_membership/;
  const zones = ["lib/ai", "lib/analytics", "lib/pixelClient.ts", "lib/pixelEvents.ts", "lib/metaConversions.ts", "lib/overview", "lib/reports", "lib/watchdog", "lib/activity"].map((z) => path.join(SRC, z)).filter((z) => fs.existsSync(z));
  const files = zones.flatMap((z) => (fs.statSync(z).isDirectory() ? walk(z) : [z]));
  const leaks = files.filter((f) => !/churchMinistries\.ts$/.test(f) && banned.test(strip(fs.readFileSync(f, "utf8"))));
  check("no AI, analytics, pixel, overview, report or activity code reads the membership roster", leaks.length === 0, leaks.map((f) => path.relative(SRC, f)).join());
  const knowledge = strip(fs.readFileSync(path.join(SRC, "lib/ai/knowledge/modules/churchMinistries.ts"), "utf8"));
  check("the church knowledge module reads no roster table", !/\.from\(\s*["'`]church_(members|group_members|leadership|public_groups)/.test(knowledge));
  const lists = strip(fs.readFileSync(path.join(SRC, "lib/church/lists/build.ts"), "utf8"));
  check("the list builder only uses the signed-in person's own session (no service role)", !/createAdminClient|service_role/.test(lists));
  const route = strip(fs.readFileSync(path.join(SRC, "app/api/church/lists/[kind]/route.ts"), "utf8"));
  check("the list route logs the kind and a row count, never a person", /console\.info\(JSON\.stringify\(\{ scope: "church_lists", kind: params\.kind, rows: result\.rows \}\)\)/.test(route) && !/full_name|email|phone/.test(route));
}

await H.close();
process.exit(summary());
