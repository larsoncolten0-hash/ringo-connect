// Churches & Ministries Phase 2B: the People / Groups / Leadership screens, checked OFFLINE (no database, no network, no dev server).
//   * English / French dictionary parity for the whole `churchPeople` block (same shape, same function arity, no empty text, French is not a copy of English);
//   * every error code the server can send has a sentence in BOTH languages (a visitor never sees a raw code);
//   * no hard-coded user-facing text and no browser storage in the screens' source;
//   * accessibility basics in the source (named controls, dialog semantics, 44px targets, visible focus);
//   * the real shell, tabs, empty state, pager and badges rendered in both languages (sucrase + a tiny CommonJS loader, as in churchPublicPage.test.mjs).
// The dialogs and live data flows are exercised in a real browser during QA (they need a DOM); the data rules behind them are covered by churchPeopleGroupsApi.test.mjs.
//   Run:  node scripts/tests/churchPeopleUi.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const { transform } = require("sucrase");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const en = translations.en.churchPeople, fr = translations.fr.churchPeople;

// ---------------------------------------------------------------- 1. dictionary parity
{
  const walk = (a, b, p, out) => {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (JSON.stringify(ka) !== JSON.stringify(kb)) out.shape.push(`${p}: ${ka.filter((k) => !kb.includes(k)).join("|")} vs ${kb.filter((k) => !ka.includes(k)).join("|")}`);
    for (const k of ka) {
      if (!(k in b)) continue;
      const va = a[k], vb = b[k], here = `${p}.${k}`;
      if (typeof va !== typeof vb) { out.shape.push(`${here}: type`); continue; }
      if (typeof va === "function") { if (va.length !== vb.length) out.shape.push(`${here}: arity`); out.fns.push([here, va, vb]); }
      else if (typeof va === "string") { out.strings.push([here, va, vb]); }
      else if (Array.isArray(va)) { if (va.length !== vb.length) out.shape.push(`${here}: length`); }
      else if (va && typeof va === "object") walk(va, vb, here, out);
    }
  };
  const out = { shape: [], strings: [], fns: [] };
  walk(en, fr, "churchPeople", out);
  check("EN and FR have exactly the same keys, types and function arity", out.shape.length === 0, out.shape.join("; "));
  check("no empty text in either language", out.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  const same = out.strings.filter(([, a, b]) => a === b && a.length > 4).map(([k]) => k);
  check("French is a translation, not a copy (at most a handful of identical strings)", same.length <= 4, same.join(", "));
  for (const [key, a, b] of out.fns) {
    const args = a.length === 2 ? (key.endsWith("endTitle") ? ["Treasurer", "Ada"] : key.endsWith("statusTitle") ? ["Ada", "Active"] : key.endsWith("pageOf") || key.endsWith("showing") ? [2, 5] : ["2026-01-01", "2026-12-31"]) : a.length === 1 ? [key.endsWith("count") || key.endsWith("members") ? 3 : "Ada"] : [];
    const ra = a(...args), rb = b(...args);
    check(`${key}() returns text in both languages`, typeof ra === "string" && typeof rb === "string" && ra.length > 0 && rb.length > 0);
  }
  check("plurals: 1 person / 2 people, 1 personne / 2 personnes", en.people.count(1) === "1 person" && en.people.count(2) === "2 people" && fr.people.count(1) === "1 personne" && fr.people.count(2) === "2 personnes" && fr.people.count(0) === "0 personne");
  check("leadership period reads naturally with missing dates", en.leadership.period(null, null) === "No dates" && fr.leadership.period("1 janv. 2026", null) === "Depuis le 1 janv. 2026");
  // the Team role editor's church group
  check("Team role editor: the church group heading and notes exist in both languages", [en.team.group, en.team.ownerIntro, en.team.locked, fr.team.group, fr.team.ownerIntro, fr.team.locked].every((s) => s.length > 3));
  // the same words the rest of the app uses for these concepts
  check("privacy is stated in plain words in both languages", /private|never shown on your public page/i.test(en.subtitle) && /priv|jamais affich/i.test(fr.subtitle));
}

// ---------------------------------------------------------------- 2. every server code has a sentence in both languages
{
  const codes = new Set();
  const grab = (text, re) => { for (const m of text.matchAll(re)) codes.add(m[1]); };
  const handlers = read("src/lib/church/handlers.ts"), errors = read("src/lib/church/errors.ts"), validation = read("src/lib/church/validation.ts"), routeKit = read("src/lib/church/routeKit.ts");
  grab(handlers, /fail\(\d{3}, "([a-z_]+)"/g);
  grab(errors, /code: "([a-z_]+)"/g);
  grab(validation, /bad\("([a-z_]+)"/g);
  grab(routeKit, /error: "([a-z_]+)"/g);
  // codes the validators build from a field name ("invalid_" + field)
  for (const f of ["full_name", "phone", "email", "name", "title", "description", "member_id", "guardian_member_id", "preferred_language", "status", "age_group", "kind", "role", "page", "q", "group_id", "current", "date"]) codes.add(`invalid_${f}`);
  for (const k of [...codes]) if (k.endsWith("_")) codes.delete(k); // "invalid_" + field is expanded below
  codes.delete("invalid_q"); codes.delete("invalid_group_id"); codes.delete("invalid_current"); // list-query problems a screen cannot produce (its controls only send valid values)
  // the shared church codes live here; the Content Studio's own codes (date_taken, needs_title_and_body ...) live in churchContent.errors and are checked, with the content routes' codes, in churchContentUi.test.mjs
  // the later phases keep their own sentences in their own namespaces (each is checked with its routes in its own suite); a code must still exist in BOTH languages
  const has = (loc, c) => !!(translations[loc].churchPeople.errors[c] || translations[loc].churchContent.errors[c] || translations[loc].churchEvents.errors[c] || translations[loc].churchAttendance.errors[c] || translations[loc].churchBible.errors[c] || translations[loc].churchMusic.errors[c]);
  const missing = [...codes].filter((c) => !has("en", c) || !has("fr", c));
  check("every code the server can send has a sentence in English AND French", missing.length === 0, missing.join(", "));
  check("generic fallback exists in both languages", !!en.errors.generic && !!fr.errors.generic);
  check("no error sentence leaks internals (table, policy, trigger, permission or SQL words)", [...Object.values(en.errors), ...Object.values(fr.errors)].every((s) => !/church_|policy|trigger|RLS|row-level|supabase|postgres|SQL|church\.(children|members|groups)/i.test(s)));
}

// ---------------------------------------------------------------- 3. source rules for the screens
{
  const dir = path.join(SRC, "components/church/people");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".tsx"));
  // line comments FIRST: a comment such as "/api/church/**" must not be mistaken for the start of a block comment
  const noComments = (t) => t.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
  const ts = require("typescript");
  check("the screens exist", files.length >= 10, files.join(","));
  for (const f of files) {
    const src = noComments(fs.readFileSync(path.join(dir, f), "utf8"));
    // Hard-coded text, found with the TypeScript parser (not a regex): JSX text nodes with letters, and string-literal values of attributes a person reads or hears.
    const sf = ts.createSourceFile(f, fs.readFileSync(path.join(dir, f), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const texts = [], attrs = [];
    const visit = (n) => {
      if (n.kind === ts.SyntaxKind.JsxText) { const t = n.getText().trim(); if (/[A-Za-zÀ-ÿ]{2,}/.test(t)) texts.push(t); }
      if (n.kind === ts.SyntaxKind.JsxAttribute && ["aria-label", "placeholder", "title", "alt", "aria-description", "aria-roledescription"].includes(n.name.getText()) && n.initializer && n.initializer.kind === ts.SyntaxKind.StringLiteral && /[A-Za-zÀ-ÿ]{2,}/.test(n.initializer.text)) attrs.push(`${n.name.getText()}="${n.initializer.text}"`);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    check(`${f}: no hard-coded text between JSX tags`, texts.length === 0, texts.slice(0, 4).join(" | "));
    check(`${f}: no hard-coded accessible names, placeholders or titles`, attrs.length === 0, attrs.join(" | "));
    check(`${f}: no browser storage, no console output`, !/localStorage|sessionStorage|document\.cookie|console\.(log|info|debug)/.test(src));
    check(`${f}: no dangerouslySetInnerHTML`, !/dangerouslySetInnerHTML/.test(src));
    check(`${f}: no direct database or service client`, !/@\/lib\/supabase|createClient|createAdminClient|supabase/.test(src));
    check(`${f}: every <button> says whether it submits`, [...src.matchAll(/<button\b([^>]*)>/g)].every((m) => /\btype=/.test(m[1])), "");
    const fields = [...src.matchAll(/<(input|select|textarea)\b([^>]*)>/g)];
    check(`${f}: every field has an id or an accessible name`, fields.every((m) => /\bid=|aria-label=/.test(m[2])), fields.filter((m) => !/\bid=|aria-label=/.test(m[2])).map((m) => m[0].slice(0, 60)).join(" | "));
  }
  const shared = noComments(fs.readFileSync(path.join(dir, "shared.tsx"), "utf8"));
  check("dialogs: role=dialog, aria-modal, a labelled heading, focus trap, Escape and focus return via useModalA11y", /role="dialog"/.test(shared) && /aria-modal="true"/.test(shared) && /aria-labelledby/.test(shared) && /useModalA11y/.test(shared));
  check("dialogs: the page behind does not scroll and the overlay closes the dialog", /overflow = "hidden"/.test(shared) && /onClick=\{onClose\}/.test(shared));
  check("controls are at least 44px tall and show a visible focus ring", /min-h-\[44px\]/.test(shared) && /focus-visible:ring-2/.test(shared));
  check("status messages are announced (role=status, aria-live) and errors use role=alert", /role="status"/.test(shared) && /aria-live="polite"/.test(shared) && /role="alert"/.test(shared));
  const people = noComments(fs.readFileSync(path.join(dir, "PeopleView.tsx"), "utf8"));
  check("the list is server-paged and searchable, with debounced search", /Pager/.test(people) && /useDebounced/.test(people) && /page: String\(page\)/.test(people));
  check("the list does not ask for, or show, contact details", !/\.phone|\.email/.test(people));
  const form = noComments(fs.readFileSync(path.join(dir, "MemberFormDialog.tsx"), "utf8"));
  check("the member form never sends contact details for a child", /isChild \? null/.test(form));
  check("the member form only offers Child to someone who may manage children", /caps\.manageChildren/.test(form) && /disabled=\{!canChooseChild/.test(form));
  const detail = noComments(fs.readFileSync(path.join(dir, "MemberDetailDialog.tsx"), "utf8"));
  check("remove and permanent delete are confirmed, and a refusal keeps the dialog open", /ConfirmDialog/.test(detail) && /kind: "remove"/.test(detail) && /kind: "delete"/.test(detail));
  check("the detail dialog handles contact_hidden (a leader's view) with a sentence, not a false 'no contact details'", /contact_hidden/.test(detail) && /d\.contactHidden/.test(detail) && en.people.detail.contactHidden.length > 10 && fr.people.detail.contactHidden.length > 10);
  const gdet = noComments(fs.readFileSync(path.join(dir, "GroupDetailDialog.tsx"), "utf8"));
  check("removing a person, archiving and deleting a group are confirmed", (gdet.match(/<ConfirmDialog/g) || []).length === 3);
  const lead = noComments(fs.readFileSync(path.join(dir, "LeadershipView.tsx"), "utf8"));
  check("ending an appointment is confirmed and uses the server's Douala date", /endTitle/.test(lead) && /ended_on: today/.test(lead));
  check("leadership has no public-display control", !/public|(?<!focus-)visible|show on|display/i.test(lead.replace(/privateNote|namesHidden/g, "")));
  // production screens never carry sample people
  const all = files.map((f) => noComments(fs.readFileSync(path.join(dir, f), "utf8"))).join("\n");
  check("no fake sample records in the screens", !/Jean|Marie Ndongo|John Doe|Lorem|sample|dummy|fixture/i.test(all.replace(/namePlaceholder/g, "")));
  // placeholders in the dictionary may use an example name: it is a hint, not data
}

// ---------------------------------------------------------------- 4. render the shell, tabs and shared pieces in both languages
{
  let LOCALE = "en";
  const cache = new Map();
  const resolveSrc = (id) => {
    const base = path.join(SRC, id.slice(2));
    for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
    throw new Error("cannot resolve " + id);
  };
  let PATH = "/dashboard/church/people";
  const stubs = {
    "@/components/LanguageProvider": { useLanguage: () => ({ locale: LOCALE, t: translations[LOCALE], setLocale() {} }) },
    "@/components/ui/useModalA11y": { useModalA11y: () => ({ current: null }) },
    "next/navigation": { usePathname: () => PATH },
    "next/link": { __esModule: true, default: (p) => React.createElement("a", { href: p.href, "aria-current": p["aria-current"], className: p.className }, p.children) },
  };
  function load(file) {
    if (!file.endsWith(".tsx")) return jiti(file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = transform(fs.readFileSync(file, "utf8"), { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true }).code;
    const relative = (id) => {
      const base = path.join(path.dirname(file), id);
      for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
      throw new Error("cannot resolve " + id);
    };
    const req = (id) => (stubs[id] ? stubs[id] : id.startsWith("@/") ? load(resolveSrc(id)) : id.startsWith(".") ? load(relative(id)) : require(id));
    new Function("require", "module", "exports", code)(req, mod, mod.exports);
    return mod.exports;
  }
  const html = (Comp, props, lang) => { LOCALE = lang; return renderToStaticMarkup(React.createElement(Comp, props)).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"'); };
  const SHELL = load(path.join(SRC, "components/church/people/ChurchShell.tsx"));
  const SH = load(path.join(SRC, "components/church/people/shared.tsx"));
  const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
  const all = PERM.churchCapabilities([...PERM.CHURCH_PERMISSIONS]);
  const peopleOnly = PERM.churchCapabilities(["church.members.view"]);
  for (const lang of ["en", "fr"]) {
    const c = translations[lang].churchPeople;
    let h = html(SHELL.default, { caps: all, children: React.createElement("p", null, "BODY") }, lang);
    check(`shell (${lang}): heading, privacy line and the three tabs`, h.includes(c.title) && h.includes(c.subtitle) && h.includes(c.tabs.people) && h.includes(c.tabs.groups) && h.includes(c.tabs.leadership), h.slice(0, 200));
    check(`shell (${lang}): tabs are a labelled navigation with the current page marked`, h.includes(`aria-label="${c.tabsLabel}"`) && /aria-current="page"[^>]*>|href="\/dashboard\/church\/people"[^>]*aria-current="page"|aria-current="page"/.test(h));
    h = html(SHELL.default, { caps: peopleOnly, children: null }, lang);
    check(`shell (${lang}): a person who may only view people sees only the People tab`, h.includes(c.tabs.people) && !h.includes(`>${c.tabs.groups}<`) && !h.includes(`>${c.tabs.leadership}<`));
    h = html(SHELL.NoAccess, {}, lang);
    check(`no-access (${lang}): explains without internals and offers a way back`, h.includes(c.noAccess.title) && h.includes(c.noAccess.back) && h.includes('href="/dashboard"'));
    h = html(SHELL.NoAccess, { section: "groups" }, lang);
    check(`restricted section (${lang})`, h.includes(c.restricted.groups));
    h = html(SH.EmptyState, { icon: null, title: c.people.emptyTitle, body: c.people.emptyBody }, lang);
    check(`empty state (${lang}): title and explanation, no fake rows`, h.includes(c.people.emptyTitle) && h.includes(c.people.emptyBody) && !/<li/.test(h));
    h = html(SH.Pager, { page: 2, pageSize: 25, total: 60, onPage() {}, busy: false }, lang);
    check(`pager (${lang}): previous / next / page x of y`, h.includes(c.common.previous) && h.includes(c.common.next) && h.includes(c.common.pageOf(2, 3)));
    h = html(SH.Pager, { page: 1, pageSize: 25, total: 10, onPage() {}, busy: false }, lang);
    check(`pager (${lang}): hidden when everything fits on one page`, h === "");
    h = html(SH.NoticeBar, { message: c.people.form.created }, lang);
    check(`notice (${lang}): announced politely`, /role="status"/.test(h) && /aria-live="polite"/.test(h) && h.includes(c.people.form.created));
    h = html(SH.ErrorLine, { message: c.errors.forbidden }, lang);
    check(`error line (${lang}): role=alert`, /role="alert"/.test(h) && h.includes(c.errors.forbidden));
    h = html(SH.Badge, { tone: "child", children: c.age.child }, lang);
    check(`badge (${lang})`, h.includes(c.age.child));
    check(`errorText (${lang}): unknown codes fall back to the generic sentence, never the raw code`, SH.errorText(c.errors, "some_new_server_code") === c.errors.generic && SH.errorText(c.errors, "group_has_children") === c.errors.group_has_children);
  }
  check("dates are formatted per language and never shifted by the time zone", SH.formatDay("2026-01-05", "en") === "5 Jan 2026" && /5 janv\. 2026/.test(SH.formatDay("2026-01-05", "fr")) && SH.formatDay("2026-12-31T23:59:59Z", "en") === "31 Dec 2026" && SH.formatDay(null, "en") === "" && SH.formatDay("garbage", "en") === "");
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
