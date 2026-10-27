// Shared harness for the Churches & Ministries Phase 4-8 UI / dictionary tests. NOT a test file.
// Loads the REAL components (sucrase + a tiny CommonJS loader, as in churchContentUi.test.mjs) and renders them to static markup in either language with the real dictionaries, so the real cards and
// the real ProfileView are exercised without a browser, a database or a dev server. Client effects do not run in a static render: screens show their first state (form, or loading skeleton).
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
export const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const SRC = path.join(REPO, "src");
export const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
// line comments FIRST: a comment such as "/api/church/**" must not be mistaken for the start of a block comment
export const noComments = (t) => t.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

export const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const { transform } = require("sucrase");
export const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
export const ts = require("typescript");
export const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));

let LOCALE = "en";
const cache = new Map();
const resolveSrc = (id) => {
  const base = path.join(SRC, id.slice(2));
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error("cannot resolve " + id);
};
const Null = () => null;
export const routerCalls = [];
const stubs = {
  "@/components/LanguageProvider": { useLanguage: () => ({ locale: LOCALE, t: translations[LOCALE], setLocale() {} }), LanguageProvider: ({ children }) => children },
  "next/navigation": { usePathname: () => "/dashboard/church/events", useRouter: () => ({ refresh() {}, push: (p) => routerCalls.push(["push", p]), replace: (p) => routerCalls.push(["replace", p]) }), useSearchParams: () => new URLSearchParams() },
  // The picture field of the editors builds a browser client while rendering; a static render has no project URL or key, so it gets an inert one.
  "@/lib/supabase/client": { createClient: () => ({ auth: { getUser: () => Promise.resolve({ data: { user: null } }) }, storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) } }) },
  "next/script": { __esModule: true, default: Null },
  "next/dynamic": { __esModule: true, default: () => Null },
  "next/image": { __esModule: true, default: (p) => React.createElement("img", { src: p.src, alt: p.alt || "" }) },
  "next/link": { __esModule: true, default: (p) => React.createElement("a", { href: p.href, className: p.className, "aria-label": p["aria-label"], "aria-current": p["aria-current"] }, p.children) },
};
const overrides = new Map();
/** Replaces ONE export of a component module (for example the portal-based ConfirmDialog, which draws nothing in a static render) with a probe. Call before the screens that import it are loaded. */
export function overrideExport(rel, name, impl) {
  const file = path.join(SRC, rel);
  const real = load(file);
  overrides.set(file, { ...real, __esModule: true, [name]: impl });
}
export function load(file) {
  if (overrides.has(file)) return overrides.get(file);
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
export const component = (rel, name = "default") => load(path.join(SRC, rel))[name];
export const html = (Comp, props, lang) => {
  LOCALE = lang;
  return renderToStaticMarkup(React.createElement(Comp, props)).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
};
export const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const cardTheme = { accent: "#818CF8", accentText: "#3730A3", textColor: "#14110A", borderTint: "rgba(20,17,10,0.12)", radiusClass: "rounded-ringo-lg" };

/** The dictionary walk used by every parity check: same keys, same types, same function arity; collects strings and functions. */
export function walkDictionary(a, b, p, out = { shape: [], strings: [], fns: [] }) {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (JSON.stringify(ka) !== JSON.stringify(kb)) out.shape.push(`${p}: ${ka.filter((k) => !kb.includes(k)).join("|")} vs ${kb.filter((k) => !ka.includes(k)).join("|")}`);
  for (const k of ka) {
    if (!(k in b)) continue;
    const va = a[k], vb = b[k], here = `${p}.${k}`;
    if (typeof va !== typeof vb) { out.shape.push(`${here}: type`); continue; }
    if (typeof va === "function") { if (va.length !== vb.length) out.shape.push(`${here}: arity`); out.fns.push([here, va, vb]); }
    else if (typeof va === "string") out.strings.push([here, va, vb]);
    else if (va && typeof va === "object") walkDictionary(va, vb, here, out);
  }
  return out;
}

/** Sample arguments for a dictionary function, by arity and name. */
export function sampleArgs(key, fn) {
  if (fn.length === 2) return [3, 10];
  if (fn.length === 1) return [/count|earlier|enrolled|sessions|days/i.test(key) ? 3 : /languageReady|languageMissing|shownIn/i.test(key) ? "EN" : /open/i.test(key) ? "Sunday service" : "5 Jan 2026"];
  return [];
}

/** Hard-coded text rules for a screen's source (JSX text, accessible names, storage, markup injection, button types, field ids). Returns a list of problems. */
export function sourceProblems(file) {
  const raw = fs.readFileSync(file, "utf8");
  const src = noComments(raw.replace(/\r\n/g, "\n"));
  const problems = [];
  const sf = ts.createSourceFile(file, raw, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const texts = [], attrs = [];
  const visit = (n) => {
    if (n.kind === ts.SyntaxKind.JsxText) { const t = n.getText().trim(); if (/[A-Za-zÀ-ÿ]{2,}/.test(t)) texts.push(t); }
    if (n.kind === ts.SyntaxKind.JsxAttribute && ["aria-label", "placeholder", "title", "alt", "aria-description"].includes(n.name.getText()) && n.initializer && n.initializer.kind === ts.SyntaxKind.StringLiteral && /[A-Za-zÀ-ÿ]{2,}/.test(n.initializer.text)) attrs.push(`${n.name.getText()}="${n.initializer.text}"`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (texts.length) problems.push("hard-coded JSX text: " + texts.slice(0, 4).join(" | "));
  if (attrs.length) problems.push("hard-coded accessible text: " + attrs.join(" | "));
  if (/localStorage|sessionStorage|document\.cookie|console\.(log|info|debug)|dangerouslySetInnerHTML|innerHTML/.test(src)) problems.push("browser storage / console / raw HTML");
  if (/@\/lib\/supabase|createClient|createAdminClient|\bsupabase\b/.test(src)) problems.push("direct database or service client");
  if (![...src.matchAll(/<button\b([^>]*)>/g)].every((m) => /\btype=/.test(m[1]))) problems.push("a <button> without type");
  const fields = [...src.matchAll(/<(input|select|textarea)\b([^>]*)>/g)];
  if (!fields.every((m) => /\bid=|aria-label=|\{\.\.\.common\}/.test(m[2]))) problems.push("a field without id or accessible name: " + fields.filter((m) => !/\bid=|aria-label=|\{\.\.\.common\}/.test(m[2])).map((m) => m[0].slice(0, 60)).join(" | "));
  return problems;
}
