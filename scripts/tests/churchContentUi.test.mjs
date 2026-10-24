// Churches & Ministries Phase 3: the Content Studio screens and the PUBLIC Daily Word card, checked OFFLINE (no database, no network, no dev server).
//   * English / French dictionary parity for the whole `churchContent` block, and a sentence in BOTH languages for every server code the content routes can send;
//   * no hard-coded user-facing text, no browser storage, no markup injection, accessibility basics, the confirmation and one-save-button rules, in the screens' source;
//   * the public helpers (language fallback, cleaning, the fail-safe loader) and the real card rendered in both languages;
//   * the real ProfileView: the card appears only on a church page with a published word, after "Visit us", and nowhere else (sucrase + a tiny CommonJS loader, as in churchPublicPage.test.mjs).
// The dialogs and live data flows are exercised in a real browser during QA (they need a DOM); the data rules behind them are covered by churchDailyWords*.test.mjs.
//   Run:  node scripts/tests/churchContentUi.test.mjs
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
const ts = require("typescript");
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const PW = jiti(path.join(SRC, "lib/church/content/publicWord.ts"));
const CAT = jiti(path.join(SRC, "lib/categories.ts"));
const { buildPreviewProfile } = jiti(path.join(SRC, "app/dev-preview-profile/fixtures.ts"));
const en = translations.en.churchContent, fr = translations.fr.churchContent;
// line comments FIRST: a comment such as "/api/church/**" must not be mistaken for the start of a block comment
const noComments = (t) => t.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

// ---------------------------------------------------------------- 1. dictionary parity and error coverage
{
  const walk = (a, b, p, out) => {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (JSON.stringify(ka) !== JSON.stringify(kb)) out.shape.push(`${p}: ${ka.filter((k) => !kb.includes(k)).join("|")} vs ${kb.filter((k) => !ka.includes(k)).join("|")}`);
    for (const k of ka) {
      if (!(k in b)) continue;
      const va = a[k], vb = b[k], here = `${p}.${k}`;
      if (typeof va !== typeof vb) { out.shape.push(`${here}: type`); continue; }
      if (typeof va === "function") { if (va.length !== vb.length) out.shape.push(`${here}: arity`); out.fns.push([here, va, vb]); }
      else if (typeof va === "string") out.strings.push([here, va, vb]);
      else if (va && typeof va === "object") walk(va, vb, here, out);
    }
  };
  const out = { shape: [], strings: [], fns: [] };
  walk(en, fr, "churchContent", out);
  check("EN and FR have exactly the same keys, types and function arity", out.shape.length === 0, out.shape.join("; "));
  check("no empty text in either language", out.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  const same = out.strings.filter(([, a, b]) => a === b && a.length > 4).map(([k]) => k);
  check("French is a translation, not a copy", same.length <= 3, same.join(", "));
  for (const [key, a, b] of out.fns) {
    const args = a.length === 2 ? [3, 10] : a.length === 1 ? [key.endsWith("count") || key.endsWith("earlier") ? 3 : key.endsWith("languageReady") || key.endsWith("languageMissing") || key.endsWith("shownIn") ? "EN" : "5 Jan 2026"] : [];
    check(`${key}() returns text in both languages`, typeof a(...args) === "string" && typeof b(...args) === "string" && a(...args).length > 0 && b(...args).length > 0);
  }
  check("plurals", en.list.count(1) === "1 Daily Word" && en.list.count(2) === "2 Daily Words" && fr.list.count(1) === "1 Parole du jour" && fr.list.count(2) === "2 Paroles du jour" && en.public.earlier(1) === "Earlier word" && fr.public.earlier(1) === "Parole précédente");
  check("restricted-section sentence exists for content in both languages", translations.en.churchPeople.restricted.content.length > 10 && translations.fr.churchPeople.restricted.content.length > 10);
  // every code the content routes can send has a sentence in BOTH languages (own dictionary, else the shared church one)
  const codes = new Set();
  const grab = (text, re) => { for (const m of text.matchAll(re)) codes.add(m[1]); };
  const handlers = read("src/lib/church/content/handlers.ts"), validation = read("src/lib/church/content/validation.ts"), errors = read("src/lib/church/errors.ts"), routeKit = read("src/lib/church/routeKit.ts");
  grab(handlers, /fail\(\d{3}, "([a-z_]+)"/g);
  grab(validation, /(?:code: |bad\()"([a-z_]+)"/g);
  grab(errors, /code: "([a-z_]+)"/g);
  grab(routeKit, /error: "([a-z_]+)"/g);
  for (const c of ["invalid_date", "invalid_page", "invalid_view", "invalid_body", "unexpected_field", "empty_update"]) codes.add(c);
  // the later phases keep their own sentences in their own namespaces (each is checked with its routes in its own suite); a code must still exist in BOTH languages
  const has = (loc, c) => !!(translations[loc].churchContent.errors[c] || translations[loc].churchPeople.errors[c] || translations[loc].churchEvents.errors[c] || translations[loc].churchAttendance.errors[c] || translations[loc].churchBible.errors[c] || translations[loc].churchMusic.errors[c] || translations[loc].churchCare.errors[c] || translations[loc].churchTestimonies.errors[c]);
  const missing = [...codes].filter((c) => !has("en", c) || !has("fr", c));
  check("every code the content routes can send has a sentence in English AND French", missing.length === 0, missing.join(", "));
  check("no content error sentence leaks internals", [...Object.values(en.errors), ...Object.values(fr.errors)].every((s) => !/daily_words|policy|trigger|RLS|row-level|supabase|postgres|SQL|church\.content|42501/i.test(s)));
  const sh = jiti(path.join(SRC, "components/church/content/shared.ts"));
  check("contentErrorText: own code, then shared code, then generic; never a raw code", sh.contentErrorText(translations.fr, "date_taken") === fr.errors.date_taken && sh.contentErrorText(translations.en, "forbidden") === translations.en.churchPeople.errors.forbidden && sh.contentErrorText(translations.en, "some_new_code") === translations.en.churchPeople.errors.generic);
}

// ---------------------------------------------------------------- 2. source rules for the screens and the card
{
  const dir = path.join(SRC, "components/church/content");
  const files = [...fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(dir, f)), path.join(SRC, "components/church/DailyWordCard.tsx")];
  check("the screens exist", files.length >= 5, files.map((f) => path.basename(f)).join(","));
  for (const f of files) {
    const name = path.basename(f);
    const raw = fs.readFileSync(f, "utf8");
    const src = noComments(raw.replace(/\r\n/g, "\n"));
    const sf = ts.createSourceFile(f, raw, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const texts = [], attrs = [];
    const visit = (n) => {
      if (n.kind === ts.SyntaxKind.JsxText) { const t = n.getText().trim(); if (/[A-Za-zÀ-ÿ]{2,}/.test(t)) texts.push(t); }
      if (n.kind === ts.SyntaxKind.JsxAttribute && ["aria-label", "placeholder", "title", "alt", "aria-description"].includes(n.name.getText()) && n.initializer && n.initializer.kind === ts.SyntaxKind.StringLiteral && /[A-Za-zÀ-ÿ]{2,}/.test(n.initializer.text)) attrs.push(`${n.name.getText()}="${n.initializer.text}"`);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    check(`${name}: no hard-coded text between JSX tags`, texts.length === 0, texts.slice(0, 4).join(" | "));
    check(`${name}: no hard-coded accessible names, placeholders or titles`, attrs.length === 0, attrs.join(" | "));
    check(`${name}: no browser storage, no console output, no raw HTML injection`, !/localStorage|sessionStorage|document\.cookie|console\.(log|info|debug)|dangerouslySetInnerHTML|innerHTML/.test(src));
    check(`${name}: no direct database or service client`, !/@\/lib\/supabase|createClient|createAdminClient|\bsupabase\b/.test(src));
    check(`${name}: no foundation (opt-in) design tokens on this existing screen family`, !/\bringo-(glass|gilt|lamp|press|rise|micro|ring-|live-dot|card-sweep|focus)\b|(?:bg|text|border|from|to|ring|shadow|rounded)-ringo-(ink|ink-2|paper|gold|gold-dark|gold-light|ember|ember-dark|signal|signal-dark|rose|rose-dark|stone|accent|on-accent|gold-text|ember-text|signal-text|rose-text|line-warm|line-gilt|sm|md|lg|xl|1|2|3|glow|signal)\b|duration-ringo|ease-ringo|font-micro/.test(src));
    check(`${name}: every <button> says whether it submits`, [...src.matchAll(/<button\b([^>]*)>/g)].every((m) => /\btype=/.test(m[1])));
    const fields = [...src.matchAll(/<(input|select|textarea)\b([^>]*)>/g)];
    check(`${name}: every field has an id or an accessible name`, fields.every((m) => /\bid=|aria-label=/.test(m[2])), fields.filter((m) => !/\bid=|aria-label=/.test(m[2])).map((m) => m[0].slice(0, 60)).join(" | "));
  }
  const editor = noComments(read("src/components/church/content/DailyWordEditor.tsx"));
  check("exactly ONE save button, bound to the single save() (no hidden autosave, no second Save)", (editor.match(/onClick=\{save\}/g) || []).length === 1 && !/setInterval|setTimeout\([^)]*save/.test(editor));
  check("publish / schedule, unpublish and delete are each confirmed, and nothing publishes without a ConfirmDialog", (editor.match(/<ConfirmDialog/g) || []).length === 3 && /act\("publish"\)/.test(editor) && /act\("unpublish"\)/.test(editor));
  check("publish and unpublish are disabled while there are unsaved changes (what was reviewed is what goes live)", /disabled=\{busy \|\| dirty \|\| !anyComplete\}/.test(editor) && /disabled=\{busy \|\| dirty\}/.test(editor));
  check("delete sends the loaded updated_at (the API refuses a delete without it) and reports a stale one", /method: "DELETE"/.test(editor) && /\?expected_updated_at=\$\{encodeURIComponent\(meta\.updated_at\)\}/.test(editor) && /remove = async[\s\S]*?code === "stale"/.test(editor));
  check("publish and unpublish send the explicit confirmation and the loaded updated_at", /confirm: true, expected_updated_at: meta\.updated_at/.test(editor));
  check("unsaved changes are protected (beforeunload and a leave prompt)", /beforeunload/.test(editor) && /window\.confirm\(c\.leaveWarning\)/.test(editor));
  check("a stale save is explained and offers a reload, not a silent overwrite", /setStale\(true\)/.test(editor) && /c\.reload/.test(editor));
  check("language tabs are a real tablist with selected state and panel", /role="tablist"/.test(editor) && /role="tab"/.test(editor) && /aria-selected/.test(editor) && /role="tabpanel"/.test(editor));
  check("the editor never sends the status or a church id", !/status:|profile_id|profileId/.test(editor.replace(/status: "draft" \| "published"/g, "").replace(/status: w\.status/g, "")));
  const view = noComments(read("src/components/church/content/ContentView.tsx"));
  check("the list is server-paged and filtered by state", /Pager/.test(view) && /view=\$\{view\}&page=\$\{page\}/.test(view));
  const card = noComments(read("src/components/church/DailyWordCard.tsx"));
  check("the public card renders text as text (whitespace-pre-line), never as markup", /whitespace-pre-line/.test(card) && !/dangerouslySetInnerHTML/.test(card));
  check("the public card has real headings, a labelled section, real <time> elements and native disclosure for earlier words", /aria-labelledby/.test(card) && /<time\b/.test(card) && /<details/.test(card) && /<summary/.test(card) && /min-h-\[44px\]/.test(card));
  check("the card shows nothing (null) when no word is readable", /if \(shown\.length === 0\) return null/.test(card));
}

// ---------------------------------------------------------------- 3. the public helpers
{
  const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const row = (n, on, o = {}) => ({ id: uid(n), publish_on: on, status: "published", title_en: `T${n}`, body_en: `B${n}`, ...o });
  check("doualaDate rolls over one hour before UTC midnight", PW.doualaDate(Date.parse("2026-10-22T23:30:00Z")) === "2026-10-23" && PW.doualaDate(Date.parse("2026-10-22T22:59:00Z")) === "2026-10-22");
  const r = (w, l) => PW.resolveWordLanguage(w, l);
  const enOnly = PW.shapePublicWords([row(1, "2026-10-01")], "2026-10-22")[0];
  check("language: the visitor's own when complete", r({ ...enOnly, title_fr: "F", body_fr: "C" }, "fr").lang === "fr" && r({ ...enOnly, title_fr: "F", body_fr: "C" }, "fr").fallback === false);
  check("language: the other one, flagged, when theirs is incomplete", r(enOnly, "fr").lang === "en" && r(enOnly, "fr").fallback === true);
  check("language: a title without a body is not readable", r({ ...enOnly, body_en: null }, "en") === null);
  const shaped = PW.shapePublicWords([
    row(1, "2026-10-20"), row(2, "2026-10-22"), row(3, "2026-10-23"), row(4, "2026-10-21", { status: "draft" }), row(5, "2026-10-19", { title_en: null }),
    row(6, "not-a-date"), { id: "x", publish_on: "2026-10-01", title_en: "T", body_en: "B" }, null, "junk", row(7, "2026-10-18", { title_en: "x".repeat(500) }),
    row(8, "2026-10-17", { title_en: "  ", body_en: "B", title_fr: "Titre", body_fr: "Corps" }),
  ], "2026-10-22");
  check("shaping: newest first, no future entry, no draft, no unreadable entry, no malformed row", shaped.map((w) => w.id).join() === [2, 1, 7, 8].map(uid).join(), shaped.map((w) => w.id.slice(-2)).join());
  check("shaping: text is capped", shaped.find((w) => w.id === uid(7)).title_en.length === 120);
  check("shaping: at most seven words", PW.shapePublicWords(Array.from({ length: 12 }, (_, i) => row(i + 1, `2026-10-${String(i + 1).padStart(2, "0")}`)), "2026-10-22").length === 7);
  check("shaping: nothing from a non-array", PW.shapePublicWords(null).length === 0 && PW.shapePublicWords({}).length === 0);
  check("shaping: no audit column can survive", !JSON.stringify(PW.shapePublicWords([{ ...row(1, "2026-10-01"), created_by: "u", updated_by: "u", published_by: "u", profile_id: "p" }], "2026-10-22")).match(/created_by|updated_by|published_by|profile_id/));
  const calls = [];
  const client = (result) => ({ from(t) { calls.push(["from", t]); const q = { select(c) { calls.push(["select", c]); return q; }, eq(c, v) { calls.push(["eq", c, v]); return q; }, lte(c, v) { calls.push(["lte", c, v]); return q; }, order(c, o) { calls.push(["order", c, o]); return q; }, limit(n) { calls.push(["limit", n]); return result(); } }; return q; } });
  const ok = await PW.loadPublicWords(client(() => Promise.resolve({ data: [row(1, "2026-10-01")], error: null })), uid(99), Date.parse("2026-10-22T10:00:00Z"));
  check("loader: returns the shaped words", ok.length === 1 && ok[0].title_en === "T1");
  check("loader: asks only for this church's published entries up to today, newest first, limited", calls.some((c) => c[0] === "eq" && c[1] === "profile_id" && c[2] === uid(99)) && calls.some((c) => c[0] === "eq" && c[1] === "status" && c[2] === "published") && calls.some((c) => c[0] === "lte" && c[1] === "publish_on" && c[2] === "2026-10-22") && calls.some((c) => c[0] === "limit" && c[1] === 7));
  check("loader: selects only the public columns", /^id, publish_on, title_en/.test(calls.find((c) => c[0] === "select")[1]) && !/created_by|updated_by|published_by|\*/.test(calls.find((c) => c[0] === "select")[1]));
  check("loader: FAIL-SAFE on a database error, on a missing table and on a thrown error", (await PW.loadPublicWords(client(() => Promise.resolve({ data: null, error: { code: "42P01", message: "relation does not exist" } })), uid(99))).length === 0 && (await PW.loadPublicWords(client(() => { throw new Error("boom"); }), uid(99))).length === 0 && (await PW.loadPublicWords({ from() { throw new Error("no client"); } }, uid(99))).length === 0);
}

// ---------------------------------------------------------------- 4. the real card and the real ProfileView
{
  let LOCALE = "en";
  const cache = new Map();
  const resolveSrc = (id) => {
    const base = path.join(SRC, id.slice(2));
    for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
    throw new Error("cannot resolve " + id);
  };
  const Null = () => null;
  const stubs = {
    "@/components/LanguageProvider": { useLanguage: () => ({ locale: LOCALE, t: translations[LOCALE], setLocale() {} }), LanguageProvider: ({ children }) => children },
    "next/navigation": { usePathname: () => "/x", useRouter: () => ({ refresh() {}, push() {} }), useSearchParams: () => new URLSearchParams() },
    "next/script": { __esModule: true, default: Null },
    "next/dynamic": { __esModule: true, default: () => Null },
    "next/image": { __esModule: true, default: (p) => React.createElement("img", { src: p.src, alt: p.alt || "" }) },
    "next/link": { __esModule: true, default: (p) => React.createElement("a", { href: p.href }, p.children) },
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
  const Card = load(path.join(SRC, "components/church/DailyWordCard.tsx")).default;
  const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const base = { accent: "#818CF8", accentText: "#3730A3", textColor: "#14110A", borderTint: "rgba(20,17,10,0.12)", radiusClass: "rounded-ringo-lg" };
  const word = (n, on, o = {}) => ({ id: uid(n), publish_on: on, title_en: null, title_fr: null, scripture_ref_en: null, scripture_ref_fr: null, scripture_text_en: null, scripture_text_fr: null, body_en: null, body_fr: null, prayer_en: null, prayer_fr: null, ...o });
  const both = word(1, "2026-10-22", { title_en: "Be still", body_en: "Rest in Him.\n\nSecond paragraph.", scripture_ref_en: "Psalm 46:10", scripture_text_en: "Be still, and know that I am God.", prayer_en: "Lord, quiet our hearts.", title_fr: "Restez tranquilles", body_fr: "Reposez-vous en lui.", scripture_ref_fr: "Psaume 46:11", scripture_text_fr: "Arrêtez, et sachez que je suis Dieu.", prayer_fr: "Seigneur, apaise nos cœurs." });
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const h = html(Card, { t, locale: lang, words: [both], ...base }, lang);
    const c = t.churchContent.public;
    check(`card (${lang}): heading, title, scripture, reference, reflection and prayer, all in ${lang}`, h.includes(c.heading) && h.includes(lang === "en" ? "Be still" : "Restez tranquilles") && h.includes(lang === "en" ? "Psalm 46:10" : "Psaume 46:11") && h.includes(lang === "en" ? "Rest in Him." : "Reposez-vous en lui.") && h.includes(c.prayer) && h.includes(lang === "en" ? "Lord, quiet our hearts." : "Seigneur, apaise nos cœurs."), h.slice(0, 300));
    check(`card (${lang}): no text of the other language, no fallback note`, !h.includes(lang === "en" ? "Restez tranquilles" : "Be still") && !h.includes(c.shownIn(c.languageName.en)) && !h.includes(c.shownIn(c.languageName.fr)));
    check(`card (${lang}): a labelled section, a real h2 and h3, a <time> with the date`, /<section aria-labelledby="church-daily-word-heading"/.test(h) && /<h2 id="church-daily-word-heading"/.test(h) && /<h3 /.test(h) && /<time dateTime="2026-10-22"|<time datetime="2026-10-22"/.test(h));
    check(`card (${lang}): the date is written in ${lang}`, lang === "en" ? /Thursday,? 22 October 2026/.test(h) : /jeudi 22 octobre 2026/.test(h), h.match(/<time[^>]*>[^<]*/)?.[0]);
    check(`card (${lang}): paragraphs are preserved as text`, h.includes("whitespace-pre-line") && h.includes("Second paragraph.") === (lang === "en"));
  }
  const fallbackFr = html(Card, { t: translations.fr, locale: "fr", words: [word(2, "2026-10-22", { title_en: "Only English", body_en: "English body" })], ...base }, "fr");
  check("fallback (fr visitor, English-only word): the English text is shown with a clear note in French", fallbackFr.includes("Only English") && fallbackFr.includes(translations.fr.churchContent.public.shownIn("anglais")), fallbackFr.slice(0, 300));
  const fallbackEn = html(Card, { t: translations.en, locale: "en", words: [word(3, "2026-10-22", { title_fr: "Seulement français", body_fr: "Corps" })], ...base }, "en");
  check("fallback (en visitor, French-only word): the French text with a note in English", fallbackEn.includes("Seulement français") && fallbackEn.includes(translations.en.churchContent.public.shownIn("French")));
  check("nothing readable (title without a body) renders nothing at all", html(Card, { t: translations.en, locale: "en", words: [word(4, "2026-10-22", { title_en: "Title only" })], ...base }, "en") === "" && html(Card, { t: translations.en, locale: "en", words: [], ...base }, "en") === "");
  const earlier = html(Card, { t: translations.en, locale: "en", words: [both, word(5, "2026-10-21", { title_en: "Yesterday", body_en: "Y body" }), word(6, "2026-10-20", { title_en: "Day before", body_en: "D body" })], ...base }, "en");
  check("earlier words sit in a native disclosure, collapsed by default, each with its own date", /<details[^>]*>\s*<summary[^>]*>Earlier words \(2\)/.test(earlier) && earlier.includes("Yesterday") && earlier.includes("Day before") && !/<details[^>]* open/.test(earlier) && (earlier.match(/<time/g) || []).length === 3);
  const evil = html(Card, { t: translations.en, locale: "en", words: [word(7, "2026-10-22", { title_en: "<img src=x onerror=alert(1)>", body_en: "<script>alert(1)</script>", scripture_text_en: "<b>bold</b>", prayer_en: "<a href='javascript:alert(1)'>x</a>" })], ...base }, "en");
  check("markup typed into any field is escaped, never injected", !/<img src=x|<script>alert|<b>bold|<a href=.javascript/.test(evil) && evil.includes("&lt;"));

  // the real ProfileView
  let PV = null, loadErr = "";
  try { PV = load(path.join(SRC, "components/ProfileView.tsx")).default; } catch (e) { loadErr = String(e.stack || e); }
  check("ProfileView loads in the offline renderer", !!PV, loadErr.slice(0, 500));
  if (PV) {
    const opts = (category, lang, extra = {}) => ({ category, lang, accent: "#818CF8", bg: "#14112B", text: "#FAFAF8", bgStyle: "solid", button: "fill", radius: "rounded", long: false, minimal: false, ...extra });
    const page = (category, lang, words) => html(PV, { profile: buildPreviewProfile(opts(category, lang)), pageViewEventId: "preview", preview: false, dailyWords: words }, lang);
    const ch = page("church_ministries", "en", [both]);
    check("church page with a published word: the card appears, AFTER 'Visit us'", ch.includes("church-daily-word-heading") && ch.indexOf("church-visit-heading") > -1 && ch.indexOf("church-visit-heading") < ch.indexOf("church-daily-word-heading"));
    const chFr = page("church_ministries", "fr", [both]);
    check("church page (fr): the French card", chFr.includes("Parole du jour") && chFr.includes("Restez tranquilles"));
    check("church page with no word (default prop): no card, no empty heading, as before", !page("church_ministries", "en", undefined).includes("church-daily-word-heading") && !page("church_ministries", "en", []).includes("church-daily-word-heading"));
    const leaks = [];
    for (const c of CAT.CATEGORY_IDS.filter((x) => x !== "church_ministries")) for (const lang of ["en", "fr"]) if (/church-daily-word-heading|Parole du jour|Daily Word/.test(page(c, lang, [both]))) leaks.push(`${c}/${lang}`);
    check("no other category's page shows the card even if words were passed (16 categories x 2 languages)", leaks.length === 0, leaks.join(", "));
    const preview = html(PV, { profile: buildPreviewProfile(opts("church_ministries", "en")), pageViewEventId: "preview", preview: true }, "en");
    check("the editor's live preview (no words passed) shows no card", !preview.includes("church-daily-word-heading"));
  }
  // wiring on the public route
  const pageSrc = read("src/app/[username]/page.tsx");
  check("the public route loads words only for a church profile, in the existing parallel stage, and fails safe", /profileHasCategory\(profile, "church_ministries"\) \? loadPublicWords\(supabase, profile\.id\) : Promise\.resolve\(\[\]\)/.test(pageSrc) && /dailyWords=\{dailyWords\}/.test(pageSrc));
  check("the existing profile query is unchanged (no daily_words embed)", /`\*, social_links\(\*\), links\(\*\), products\(\*\), profile_phone_numbers\(\*\), tracks\(\*\), events\(\*, event_ticket_types\(\*\)\), menu_items\(\*\), music_releases\(\*\), booking_services\(\*\)`/.test(pageSrc) && !/daily_words/.test(pageSrc));
  const view = read("src/components/ProfileView.tsx");
  check("ProfileView: the card is gated on the church flag (the church template) and on having words", /isChurch \? \(\s*<ChurchSiteView/.test(view) && /\{dailyWords\.length > 0 && \([\s\S]{0,120}<DailyWordCard/.test(read("src/components/church/site/ChurchSiteView.tsx")) && /dailyWords = \[\],/.test(view));
  check("the section order of every category is unchanged (the card is drawn beside 'Visit us', not as a section)", /church_ministries: \["events", "catalog", "links", "about"\],/.test(read("src/lib/sectionOrder.ts")));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
