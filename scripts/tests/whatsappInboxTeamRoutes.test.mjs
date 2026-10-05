// Team API routes: the OWNER-ONLY rule for `inbox.*` permissions, repeated in the API as defense in depth (the database triggers are the real boundary and are
// tested in whatsappInboxTeamGuard.test.mjs). The REAL route handlers run against an in-memory fake of the request-scoped client; the Team access guard is a
// stand-in that returns whatever identity the test sets. Also: the permission catalog (exactly seven Inbox permissions, dependency rules, no delete) and the owner
// role editor (EN + FR): editable for the owner, locked read-only for a manager. No network, no database, no credentials.
//   Run:  node scripts/tests/whatsappInboxTeamRoutes.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const nodeRequire = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const ts = nodeRequire("typescript");
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 500)); };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");

// ---- in-memory fake of the request-scoped client (just the calls the Team routes make) ---------------------------------------------------------
const db = { organization_roles: [], organization_members: [], organization_invitations: [], profiles: [] };
const log = { updates: [], inserts: [] };
function from(table) {
  const st = { filters: [], mode: "select", payload: null };
  const rows = () => (db[table] || []).filter((r) => st.filters.every(([c, op, v]) => (op === "eq" ? r[c] === v : r[c] !== v)));
  const chain = {
    select() { return chain; },
    eq(c, v) { st.filters.push([c, "eq", v]); return chain; },
    neq(c, v) { st.filters.push([c, "neq", v]); return chain; },
    order() { return chain; },
    insert(p) { st.mode = "insert"; st.payload = p; return chain; },
    update(p) { st.mode = "update"; st.payload = p; return chain; },
    delete() { st.mode = "delete"; return chain; },
    async maybeSingle() { const r = rows(); return { data: r[0] ?? null, error: null }; },
    async single() {
      if (st.mode === "insert") { const row = { id: `new-${db[table].length + 1}`, ...st.payload }; db[table].push(row); log.inserts.push({ table, row }); return { data: row, error: null }; }
      const r = rows(); return { data: r[0] ?? null, error: r[0] ? null : { message: "none" } };
    },
    then(resolve) {
      if (st.mode === "update") { for (const r of rows()) Object.assign(r, st.payload); log.updates.push({ table, payload: st.payload }); return resolve({ data: null, error: null }); }
      if (st.mode === "insert") { const row = { id: `new-${db[table].length + 1}`, ...st.payload }; db[table].push(row); log.inserts.push({ table, row }); return resolve({ data: row, error: null }); }
      const r = rows(); return resolve({ data: r, error: null, count: r.length });
    },
  };
  return chain;
}
const supabase = { from };

// ---- identity under test: owner / manager (staff.manage) ---------------------------------------------------------------------------------------
const PROFILE = "p-org";
let identity = null;
const mkAccess = (kind, perms = []) => {
  const set = new Set(perms);
  return { isOwner: kind === "owner", isAdmin: kind === "admin", roleId: "r-mgr", roleName: kind, permissions: set, hasPermission: (p) => kind !== "manager" || set.has(p) || kind === "owner", teamEnabled: true };
};
const NextResponse = nodeRequire("next/server").NextResponse;
const activity = [];
const STUBS = {
  "@/lib/team/access": {
    requireOrgAccessJson: async (profileId, permission) => {
      if (!identity) return { ok: false, response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
      const a = identity.access;
      if (permission && !a.isOwner && !a.isAdmin && !a.hasPermission(permission)) return { ok: false, response: NextResponse.json({ error: "Not authorized." }, { status: 403 }) };
      return { ok: true, supabase, user: { id: identity.userId }, access: a };
    },
    ensureDefaultRoles: async () => {},
    getOrgMaxSeats: async () => null,
    countActiveOrgMembers: async () => 0,
  },
  "@/lib/team/activity": { logOrgActivity: async (e) => { activity.push(e); } },
  "@/lib/email/sendTeamInvitationEmail": { sendTeamInvitationEmail: async () => ({ ok: true }) },
  "@/lib/email/provider": { isEmailProviderConfigured: () => false },
  "react": { ...React, cache: (fn) => fn },
  "next/navigation": { redirect() {}, notFound() {}, useRouter: () => ({ refresh() {} }) },
};
const cache = new Map();
function resolveLocal(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(fromDir, spec) : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) { const f = base + ext; if (fs.existsSync(f) && fs.statSync(f).isFile()) return f; }
  return null;
}
function loadTs(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const req = (spec) => { if (STUBS[spec]) return STUBS[spec]; const local = resolveLocal(spec, path.dirname(file)); return local ? loadTs(local) : nodeRequire(spec); };
  new Function("exports", "require", "module", "__filename", out)(mod.exports, req, mod, file);
  return mod.exports;
}
const src = (p) => loadTs(path.join(SRC, p));
const P = src("lib/team/permissions.ts");
const rolesRoute = src("app/api/team/roles/route.ts");
const roleRoute = src("app/api/team/roles/[id]/route.ts");
const memberRoute = src("app/api/team/members/[id]/route.ts");
const inviteRoute = src("app/api/team/invitations/route.ts");
const inviteItem = src("app/api/team/invitations/[id]/route.ts");
const { LanguageProvider } = src("components/LanguageProvider.tsx");
const RolesPanel = src("components/team/RolesPanel.tsx").default;
const render = (locale, el) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale: locale }, el));

const owner = () => { identity = { userId: "owner-u", access: mkAccess("owner") }; };
const manager = (perms = ["staff.view", "staff.manage", "staff.invite", "orders.view", "orders.update"]) => { identity = { userId: "mgr-u", access: mkAccess("manager", perms) }; };
const reset = () => {
  db.organization_roles = [
    { id: "r-plain", profile_id: PROFILE, name: "Plain", permissions: ["orders.view"] },
    { id: "r-inbox", profile_id: PROFILE, name: "Agent", permissions: ["inbox.view", "inbox.reply"] },
    { id: "r-mgr", profile_id: PROFILE, name: "Manager", permissions: ["staff.view", "staff.manage", "staff.invite"] },
  ];
  db.organization_members = [
    { id: "m-self", profile_id: PROFILE, user_id: "mgr-u", role_id: "r-mgr", status: "active" },
    { id: "m-plain", profile_id: PROFILE, user_id: "u-plain", role_id: "r-plain", status: "active" },
    { id: "m-agent", profile_id: PROFILE, user_id: "u-agent", role_id: "r-inbox", status: "active" },
    { id: "m-gone", profile_id: PROFILE, user_id: "u-gone", role_id: "r-inbox", status: "inactive" },
  ];
  db.organization_invitations = [{ id: "i-inbox", profile_id: PROFILE, status: "pending", expires_at: "2999-01-01", role_id: "r-inbox", organization_roles: { name: "Agent", permissions: ["inbox.view", "inbox.reply"] } }, { id: "i-plain", profile_id: PROFILE, status: "pending", expires_at: "2999-01-01", role_id: "r-plain", organization_roles: { name: "Plain", permissions: ["orders.view"] } }];
  db.profiles = [{ id: PROFILE, is_demo: false, name: "Biz", username: "biz" }];
  log.updates.length = 0; log.inserts.length = 0; activity.length = 0;
};
const req = (url, method, body) => new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const j = async (res) => ({ status: res.status, body: await res.json() });
const createRole = (name, permissions) => rolesRoute.POST(req("/api/team/roles", "POST", { profileId: PROFILE, name, permissions })).then(j);
const patchRole = (id, body) => roleRoute.PATCH(req(`/api/team/roles/${id}`, "PATCH", { profileId: PROFILE, ...body }), { params: { id } }).then(j);
const patchMember = (id, body) => memberRoute.PATCH(req(`/api/team/members/${id}`, "PATCH", { profileId: PROFILE, ...body }), { params: { id } }).then(j);
const invite = (roleId) => inviteRoute.POST(req("/api/team/invitations", "POST", { profileId: PROFILE, roleId, method: "link" })).then(j);
const inviteAct = (id, action) => inviteItem.POST(req(`/api/team/invitations/${id}`, "POST", { profileId: PROFILE, action }), { params: { id } }).then(j);
const ownerOnly = (r) => r.status === 403 && r.body.code === "inbox_owner_only";
const perms = (id) => db.organization_roles.find((r) => r.id === id).permissions.join();
const roleOf = (id) => db.organization_members.find((m) => m.id === id).role_id;

// ============================================================ the permission catalog
const inboxPerms = ["inbox.view", "inbox.reply", "inbox.media", "inbox.saved_replies", "inbox.ai", "inbox.mark_read", "inbox.close"];
check("catalog: the seven Inbox permissions exist in PERMISSIONS and in one 'Inbox' group", inboxPerms.every((p) => P.PERMISSIONS.includes(p)) && P.INBOX_PERMISSIONS.join() === inboxPerms.join() && P.PERMISSION_GROUPS.some((g) => g.labelKey === "inbox" && g.permissions.join() === inboxPerms.join()));
check("catalog: no delete / remove / settings / automation Inbox permission exists, and none is accepted by sanitizePermissions", !P.PERMISSIONS.some((p) => /^inbox\.(delete|remove|settings|automation|admin|purge|export)/.test(p)) && P.sanitizePermissions(["inbox.delete", "inbox.delete_messages", "inbox.settings", "inbox.view", "orders.view"]).join() === "inbox.view,orders.view");
check("catalog: existing roles / templates are NOT given any Inbox permission automatically", !P.GENERIC_ROLE_TEMPLATE.concat(...Object.values(P.CATEGORY_ROLE_TEMPLATES)).some((t) => t.permissions.some((p) => /^inbox\./.test(p))));
check("catalog: name matching is case/spacing tolerant (the database guard treats ' Inbox.View ' as inbox too)", P.isInboxPermissionName(" Inbox.View ") && P.isInboxPermissionName("inbox.x") && !P.isInboxPermissionName("orders.view") && P.inboxPermissionsOf(["orders.view", "INBOX.AI", "inbox.view"]).length === 2);
check("dependencies: reply needs view; media needs view + reply; saved_replies / ai / mark_read / close need view", P.INBOX_DEPENDENCIES["inbox.reply"].join() === "inbox.view" && P.INBOX_DEPENDENCIES["inbox.media"].join() === "inbox.view,inbox.reply" && ["inbox.saved_replies", "inbox.ai", "inbox.mark_read", "inbox.close"].every((p) => P.INBOX_DEPENDENCIES[p].join() === "inbox.view") && P.INBOX_DEPENDENCIES["inbox.view"].length === 0);
check("dependencies: problems are reported, nothing is granted silently", P.inboxDependencyProblems(["inbox.reply"]).join() === "inbox.reply" && P.inboxDependencyProblems(["inbox.view", "inbox.media"]).join() === "inbox.media" && P.inboxDependencyProblems(["inbox.view", "inbox.reply", "inbox.media"]).length === 0 && P.inboxDependencyProblems(["inbox.close"]).join() === "inbox.close");

// ============================================================ roles: a manager can never touch Inbox permissions
reset(); manager();
let r = await createRole("Sneaky", ["inbox.view"]);
check("manager: cannot create a role with inbox.* (403 inbox_owner_only), nothing created", ownerOnly(r) && log.inserts.length === 0, JSON.stringify(r));
r = await createRole("Plain two", ["orders.view"]);
check("manager: CAN still create an ordinary role without Inbox permissions (existing behaviour)", r.status === 200 && log.inserts.length === 1);
reset(); manager();
r = await patchRole("r-mgr", { permissions: ["staff.view", "staff.manage", "staff.invite", "inbox.view"] });
check("manager: cannot add inbox.view to their own role", ownerOnly(r) && perms("r-mgr") === "staff.view,staff.manage,staff.invite");
r = await patchRole("r-inbox", { permissions: ["inbox.view"] });
check("manager: cannot REMOVE inbox.reply from another role", ownerOnly(r) && perms("r-inbox") === "inbox.view,inbox.reply");
r = await patchRole("r-inbox", { permissions: ["orders.view"] });
check("manager: cannot strip every Inbox permission / replace the set", ownerOnly(r) && perms("r-inbox") === "inbox.view,inbox.reply");
r = await patchRole("r-inbox", { name: "Renamed agent", permissions: ["inbox.view", "inbox.reply"] });
check("manager: CAN rename a role that holds Inbox permissions as long as its Inbox set is untouched", r.status === 200 && db.organization_roles.find((x) => x.id === "r-inbox").name === "Renamed agent" && perms("r-inbox") === "inbox.view,inbox.reply");
r = await patchRole("r-plain", { permissions: ["orders.view", "orders.update"] });
check("manager: CAN still edit an ordinary role (existing behaviour)", r.status === 200 && perms("r-plain") === "orders.view,orders.update");

// ============================================================ members and invitations
reset(); manager();
r = await patchMember("m-self", { roleId: "r-inbox" });
check("manager: cannot move THEMSELVES onto an Inbox role (the existing self-edit rule, then the Inbox rule)", r.status === 403 && roleOf("m-self") === "r-mgr");
r = await patchMember("m-plain", { roleId: "r-inbox" });
check("manager: cannot move ANOTHER member onto an Inbox role (403 inbox_owner_only)", ownerOnly(r) && roleOf("m-plain") === "r-plain");
r = await patchMember("m-agent", { roleId: "r-plain" });
check("manager: cannot move a member AWAY from an Inbox role", ownerOnly(r) && roleOf("m-agent") === "r-inbox");
r = await patchMember("m-gone", { status: "active" });
check("manager: cannot REACTIVATE a member whose role holds Inbox permissions", ownerOnly(r) && db.organization_members.find((m) => m.id === "m-gone").status === "inactive");
r = await patchMember("m-agent", { status: "inactive" });
check("manager: CAN still deactivate an Inbox member (that only takes access away)", r.status === 200 && db.organization_members.find((m) => m.id === "m-agent").status === "inactive");
reset(); manager();
r = await patchMember("m-plain", { status: "inactive" });
const r2 = await patchMember("m-plain", { status: "active" });
check("manager: ordinary member management is unchanged (deactivate / reactivate an ordinary member)", r.status === 200 && r2.status === 200);
reset(); manager();
r = await invite("r-inbox");
check("manager: cannot invite someone into an Inbox role (403 inbox_owner_only), no invitation created", ownerOnly(r) && log.inserts.filter((i) => i.table === "organization_invitations").length === 0, JSON.stringify(r));
r = await inviteAct("i-inbox", "resend");
check("manager: cannot re-issue (modify) an Inbox invitation", ownerOnly(r));
r = await inviteAct("i-inbox", "revoke");
check("manager: CAN revoke an Inbox invitation (taking access away)", r.status === 200 && db.organization_invitations.find((i) => i.id === "i-inbox").status === "revoked");
r = await inviteAct("i-plain", "resend");
check("manager: resending an ordinary invitation is unchanged", r.status === 200);

// ============================================================ owner: full control
reset(); owner();
r = await createRole("Inbox agent", ["inbox.view", "inbox.reply", "inbox.media"]);
check("owner: can create an Inbox role with a coherent set", r.status === 200 && log.inserts.length === 1);
r = await createRole("Broken", ["inbox.reply"]);
check("owner: a role breaking the dependency rules is refused (400), nothing is granted silently", r.status === 400 && r.body.code === "inbox_dependencies" && log.inserts.length === 1);
r = await createRole("Media only", ["inbox.view", "inbox.media"]);
check("owner: media without reply is refused (400)", r.status === 400 && r.body.code === "inbox_dependencies");
r = await patchRole("r-plain", { permissions: ["orders.view", "inbox.view", "inbox.ai"] });
check("owner: can add Inbox permissions to a role", r.status === 200 && perms("r-plain") === "orders.view,inbox.view,inbox.ai");
r = await patchRole("r-plain", { permissions: ["orders.view", "inbox.close"] });
check("owner: an edit that leaves close without view is refused (400); the role is unchanged", r.status === 400 && perms("r-plain") === "orders.view,inbox.view,inbox.ai");
r = await patchRole("r-inbox", { permissions: ["inbox.view"] });
check("owner: can remove Inbox permissions", r.status === 200 && perms("r-inbox") === "inbox.view");
r = await patchMember("m-plain", { roleId: "r-inbox" });
check("owner: can assign an Inbox role to a member", r.status === 200 && roleOf("m-plain") === "r-inbox");
r = await patchMember("m-gone", { status: "active" });
check("owner: can reactivate an Inbox member", r.status === 200);
r = await inviteAct("i-inbox", "resend");
check("owner: can re-issue an Inbox invitation", r.status === 200 && r.body.ok === true);
// a platform admin who is NOT the organization's owner is treated exactly like a manager for Inbox permissions
reset(); identity = { userId: "admin-u", access: mkAccess("admin") };
r = await createRole("Admin made", ["inbox.view"]);
check("platform admin (not the owner): cannot create an Inbox role (403 inbox_owner_only)", ownerOnly(r) && log.inserts.length === 0, JSON.stringify(r));
r = await patchRole("r-plain", { permissions: ["orders.view", "inbox.view"] });
check("platform admin (not the owner): cannot grant or revoke Inbox permissions on a role", ownerOnly(r) && perms("r-plain") === "orders.view" && ownerOnly(await patchRole("r-inbox", { permissions: ["inbox.view"] })) && perms("r-inbox") === "inbox.view,inbox.reply");
r = await patchMember("m-plain", { roleId: "r-inbox" });
check("platform admin (not the owner): cannot move a member onto an Inbox role, nor reactivate an Inbox member", ownerOnly(r) && roleOf("m-plain") === "r-plain" && ownerOnly(await patchMember("m-gone", { status: "active" })));
check("platform admin (not the owner): cannot invite into an Inbox role nor re-issue an Inbox invitation", ownerOnly(await invite("r-inbox")) && ownerOnly(await inviteAct("i-inbox", "resend")));
r = await patchRole("r-plain", { permissions: ["orders.view", "orders.update"] });
check("platform admin: ordinary (non-Inbox) role edits are unchanged", r.status === 200);

// ============================================================ the role editor UI
const roles = [{ id: "r-inbox", name: "Agent", permissions: ["inbox.view", "inbox.reply"], is_system: false }];
const panel = (locale, isOwner, extra = {}) => render(locale, React.createElement(RolesPanel, { profileId: PROFILE, roles, myPermissions: isOwner ? [] : ["staff.manage", "inbox.view"], isOwner, onChanged() {}, ...extra }));
{
  const form = (isOwner) => {
    // open the editor for the first role by rendering RoleForm through the panel's own "editing" state is interactive; render the form directly instead
    const mod = cache.get(path.join(SRC, "components/team/RolesPanel.tsx")).exports;
    return mod;
  };
  const src2 = read("src/components/team/RolesPanel.tsx");
  check("UI source: the Inbox group is rendered by a dedicated component, locked unless the viewer is the owner, and a non-owner can never toggle an inbox permission", /InboxPermissionGroup selected=\{selected\} locked=\{!isOwner\}/.test(src2) && /if \(isInboxPermission\(p\) && !isOwner\) return;/.test(src2) && /disabled=\{locked\}/.test(src2));
  check("UI source: the owner is warned about dependencies (save is blocked until the set is coherent) and the generic permission loop skips the Inbox group", /inboxDependencyProblems\(Array\.from\(selected\)\)/.test(src2) && /group\.labelKey !== "inbox"/.test(src2));
  const tr = nodeRequire("typescript") && src("lib/i18n/translations.ts").translations;
  const en = tr.en.inbox.team, fr = tr.fr.inbox.team;
  const shape = (o) => Object.keys(o).sort().join() + "|" + Object.values(o).map((v) => (Array.isArray(v) ? `a${v.length}` : typeof v)).join();
  check("i18n: the Inbox team strings exist in EN and FR with identical shape; no empty string", shape(en) === shape(fr) && en.notes.length === 5 && fr.notes.length === 5 && !JSON.stringify([en, fr]).includes('""'));
  check("i18n: the explanatory notes say what the owner must know (EN)", /phone numbers/.test(en.notes[0]) && /business WhatsApp number/.test(en.notes[1]) && /AI/.test(en.notes[2]) && /Only the owner can delete saved replies/.test(en.notes[3]) && /never delete customer messages/.test(en.notes[3]) && /owner-only/.test(en.notes[4]));
  check("i18n: …and the same in French", /numéros de téléphone/.test(fr.notes[0]) && /numéro WhatsApp de l'entreprise/.test(fr.notes[1]) && /IA/.test(fr.notes[2]) && /Seul le propriétaire/.test(fr.notes[3]) && /jamais supprimer/.test(fr.notes[3]) && /réservés au propriétaire/.test(fr.notes[4]));
  check("i18n: the seven permission labels are translated (EN + FR)", ["view", "reply", "media", "savedReplies", "ai", "markRead", "close"].every((k) => typeof en[k] === "string" && typeof fr[k] === "string" && en[k] !== fr[k]));
}

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
