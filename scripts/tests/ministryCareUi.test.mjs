// Churches & Ministries Phase 9: the Care & Support screens and the public care card, checked OFFLINE (no database, no network, no dev server). NO MONEY anywhere.
//   * dictionary parity (EN/FR) and a sentence for every code;
//   * the real public card, in both languages: only readable cases, fallback note, markup escaped, no link, no button, no name, no amount;
//   * the real ProfileView: the card appears on a church page that has published cases, and nowhere else;
//   * the real editor/list screens in both languages (category select, no money field), and the source rules of every new screen;
//   * the public data rules (what is selected, what is dropped) and the real workspace shell.
//   Run:  node scripts/tests/ministryCareUi.test.mjs
import path from "path";
import { SRC, read, noComments, jiti, translations, walkDictionary, sampleArgs, sourceProblems, component, html, uid, cardTheme } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const PC = jiti(path.join(SRC, "lib/church/public/care.ts"));
const IDX = jiti(path.join(SRC, "lib/church/public/index.ts"));
const CAT = jiti(path.join(SRC, "lib/categories.ts"));
const { buildPreviewProfile } = jiti(path.join(SRC, "app/dev-preview-profile/fixtures.ts"));
const caseRow = (n, o = {}) => ({ id: uid(n), category: "medical", title_en: "Help after a fire", title_fr: "Aide après un incendie", summary_en: "A family of our church lost their home.", summary_fr: "Une famille de notre église a perdu sa maison.", ...o });

// ---------------------------------------------------------------- 1. dictionary
{
  const out = walkDictionary(translations.en.churchCare, translations.fr.churchCare, "churchCare");
  check("EN and FR have exactly the same keys, types and function arity", out.shape.length === 0, out.shape.join("; "));
  check("no empty text in either language", out.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  const same = out.strings.filter(([, a, b]) => a === b && a.length > 8 && a.includes(" ")).map(([k]) => k);
  check("French is a translation, not a copy", same.length === 0, same.join(", "));
  for (const [key, a, b] of out.fns) {
    const args = a.length === 4 ? ["Consent given", "The person themselves", "In writing", "5 Jan 2026"] : a.length === 2 ? [3, 10] : sampleArgs(key, a);
    check(`${key}() returns text in both languages`, typeof a(...args) === "string" && typeof b(...args) === "string" && a(...args).length > 0 && b(...args).length > 0);
  }
  const e = translations.en.churchCare, f = translations.fr.churchCare;
  check("plurals", e.cases.list.count(1) === "1 case" && e.cases.list.count(2) === "2 cases" && f.cases.list.count(1) === "1 dossier" && f.cases.list.count(2) === "2 dossiers");
  check("the tab and the no-access sentence exist in both languages", translations.en.churchWorkspace.tabs.care === "Care" && translations.fr.churchWorkspace.tabs.care === "Aide" && translations.en.churchWorkspace.restricted.care.length > 10 && translations.fr.churchWorkspace.restricted.care.length > 10);
  const money = /(donatw*|donate|give|giving|pay|payment|money|amount|fundw*|raise|dons?|payer|paiement|argent|montant|cotisw*)/i;
  const moneyText = out.strings.map(([k, a, b]) => [k, a, b]).filter(([k, a, b]) => k !== "churchCare.cases.subtitle" && (money.test(a) || money.test(b))).map(([k]) => k);
  check("no screen text invites anyone to give or pay", moneyText.length === 0, moneyText.join(", "));
  check("the only mention of money says nothing here collects it", /Nothing here collects money/.test(e.cases.subtitle) && /Rien ici ne collecte d'argent/.test(f.cases.subtitle));
}

// ---------------------------------------------------------------- 2. the public card
{
  const Card = component("components/church/ChurchCareCard.tsx");
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const c = t.churchCare;
    const h = html(Card, { t, locale: lang, cases: [caseRow(1), caseRow(2, { category: "education", title_en: "School fees", title_fr: "Frais de scolarité" })], ...cardTheme }, lang);
    check(`card (${lang}): heading, intro, category and text, in ${lang}`, h.includes(c.public.heading) && h.includes(c.public.intro) && h.includes(c.categories.medical) && h.includes(c.categories.education) && h.includes(lang === "en" ? "Help after a fire" : "Aide après un incendie"), h.slice(0, 300));
    check(`card (${lang}): a labelled section with a real h2 and h3`, /<section aria-labelledby="church-care-heading"/.test(h) && /<h2 id="church-care-heading"/.test(h) && /<h3 /.test(h));
    check(`card (${lang}): no text of the other language, no fallback note`, !h.includes(lang === "en" ? "Aide après" : "Help after") && !h.includes(c.public.shownIn(t.churchEvents.public.languageName.en)) && !h.includes(c.public.shownIn(t.churchEvents.public.languageName.fr)));
    check(`card (${lang}): NO link, NO button, NO form, NO amount: nothing can be given or paid here`, !/<a |<button|<form|<input|href=|XAF|FCFA|\d\s?%/i.test(h));
    const evil = html(Card, { t, locale: lang, cases: [caseRow(3, { [`title_${lang}`]: "<img src=x onerror=alert(1)>", [`summary_${lang}`]: "<script>alert(1)</script>" })], ...cardTheme }, lang);
    check(`card (${lang}): markup typed into a field is escaped`, !/<img src=x|<script>alert/.test(evil) && evil.includes("&lt;"));
  }
  const fr = html(Card, { t: translations.fr, locale: "fr", cases: [caseRow(4, { title_fr: null, summary_fr: null })], ...cardTheme }, "fr");
  check("fallback (fr visitor, English-only case): the English text with a note in French", fr.includes("Help after a fire") && fr.includes(translations.fr.churchCare.public.shownIn("anglais")));
  check("nothing readable renders nothing at all", html(Card, { t: translations.en, locale: "en", cases: [], ...cardTheme }, "en") === "" && html(Card, { t: translations.en, locale: "en", cases: [caseRow(5, { title_en: null, title_fr: null })], ...cardTheme }, "en") === "");

  let PV = null, loadErr = "";
  try { PV = component("components/ProfileView.tsx"); } catch (e) { loadErr = String(e.stack || e); }
  check("ProfileView loads in the offline renderer", !!PV, loadErr.slice(0, 500));
  if (PV) {
    const opts = (category, lang) => ({ category, lang, accent: "#818CF8", bg: "#14112B", text: "#FAFAF8", bgStyle: "solid", button: "fill", radius: "rounded", long: false, minimal: false });
    const extras = { events: [], announcements: [], programs: [], music: [], care: [caseRow(30)] };
    const page = (category, lang, churchPublic) => html(PV, { profile: buildPreviewProfile(opts(category, lang)), pageViewEventId: "preview", preview: false, churchPublic }, lang);
    const ch = page("church_ministries", "en", extras);
    check("church page with a published case: the card appears, after 'Visit us'", ch.includes("church-care-heading") && ch.indexOf("church-visit-heading") > -1 && ch.indexOf("church-visit-heading") < ch.indexOf("church-care-heading"));
    check("church page (fr): the French card", page("church_ministries", "fr", extras).includes("Aide et soutien") && page("church_ministries", "fr", extras).includes("Aide après un incendie"));
    check("a church page without cases (default prop, empty list, or a bundle from before Phase 9): no card, no empty heading", !page("church_ministries", "en", undefined).includes("church-care-heading") && !page("church_ministries", "en", { ...extras, care: [] }).includes("church-care-heading") && !page("church_ministries", "en", { events: [], announcements: [], programs: [], music: [] }).includes("church-care-heading"));
    const leaks = [];
    for (const c of CAT.CATEGORY_IDS.filter((x) => x !== "church_ministries")) for (const lang of ["en", "fr"]) if (/church-care-heading/.test(page(c, lang, extras))) leaks.push(`${c}/${lang}`);
    check("no other category's page shows the card even if rows were passed (16 categories x 2 languages)", leaks.length === 0, leaks.join(", "));
    check("the editor's live preview (nothing passed) shows no card", !html(PV, { profile: buildPreviewProfile(opts("church_ministries", "en")), pageViewEventId: "preview", preview: true }, "en").includes("church-care-heading"));
  }
  const view = read("src/components/ProfileView.tsx");
  const site = read("src/components/church/site/ChurchSiteView.tsx");
  check("ProfileView: the card is gated on the church flag (the church template) and on having cases, and sits after the Music card", /isChurch \? \(\s*<ChurchSiteView/.test(view) && /const care = churchPublic\.care \?\? \[\]/.test(site) && /\{care\.length > 0 && \(/.test(site) && site.indexOf("<ChurchCareCard") > site.indexOf("<ChurchMusicCard"));
}

// ---------------------------------------------------------------- 3. the public data rules
{
  const S = PC.shapePublicCare;
  const good = (n, o = {}) => ({ ...caseRow(n), status: "published", ...o });
  check("shape: a published case is kept with exactly the public fields", JSON.stringify(Object.keys(S([good(1)])[0])) === '["id","category","title_en","title_fr","summary_en","summary_fr"]');
  check("shape: a draft, a row with no status, an unknown category, an unreadable case, a bad id and junk are dropped", S([good(1, { status: "draft" }), (() => { const r = good(2); delete r.status; return r; })(), good(3, { category: "lottery" }), good(4, { title_en: null, title_fr: null }), good(5, { id: "x" }), null, 7, "x"]).length === 0);
  check("shape: a case readable in one language only is kept", S([good(6, { title_fr: null, summary_fr: null })]).length === 1);
  check("shape: at most 6, in the order received; not an array gives []", S(Array.from({ length: 10 }, (_, i) => good(i + 1))).length === 6 && S(Array.from({ length: 10 }, (_, i) => good(i + 1)))[0].id === uid(1) && S(null).length === 0 && S({}).length === 0);
  const reader = (res, seen = {}) => ({ from: (tbl) => { seen.table = tbl; const q = { select: (c) => { seen.cols = c; return q; }, eq: (k, v) => { (seen.eq = seen.eq || []).push([k, v]); return q; }, order: () => q, limit: async () => res }; return q; } });
  const seen = {};
  check("loader: rows are shaped", (await PC.loadPublicCare(reader({ data: [good(1)], error: null }, seen), uid(9))).length === 1);
  check("loader: it selects only public content columns from the cases table, only published rows of this church", seen.table === "ministry_care_cases" && seen.cols === "id, status, category, title_en, title_fr, summary_en, summary_fr, published_at" && JSON.stringify(seen.eq) === JSON.stringify([["profile_id", uid(9)], ["status", "published"]]));
  check("loader: it never selects the consent state, a beneficiary, an audit column or anything financial", !/consent|beneficiar|created_by|updated_by|published_by|recorded|amount|target|currency/.test(seen.cols));
  check("loader: an error, a throw or a missing table give []", (await PC.loadPublicCare(reader({ data: null, error: { code: "42P01" } }), uid(9))).length === 0 && (await PC.loadPublicCare({ from() { throw new Error("x"); } }, uid(9))).length === 0);
  check("the church public bundle carries care and is empty by default", Array.isArray(IDX.EMPTY_CHURCH_PUBLIC.care) && IDX.EMPTY_CHURCH_PUBLIC.care.length === 0);
  const src = noComments(read("src/lib/church/public/care.ts"));
  check("the loader file touches no money, consent, beneficiary or admin-client code", !/fapshi|stripe|payment|contribution|ledger|createAdminClient|ministry_care_(consents|beneficiaries)/i.test(src));
}

// ---------------------------------------------------------------- 4. the real screens
{
  const S = (name) => component("components/church/care/CareScreens.tsx", name);
  const caps = (...p) => PERM.churchCapabilities(p);
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const c = t.churchCare.cases;
    const form = html(S("CareEditor"), { caps: caps("church.care.manage") }, lang);
    check(`editor (${lang}): the new-case form with its labels, the category select with every option, the tabs and the save button`, form.includes(c.editor.newTitle) && form.includes(c.fields.category.label) && Object.values(c.fields.category.options).every((o) => form.includes(`>${o}<`)) && form.includes(c.fields.title.label) && form.includes(c.fields.summary.label) && form.includes(c.editor.saveDraft), form.slice(0, 300));
    check(`editor (${lang}): a real <select> for the category, labelled`, /<select id="cc-category"/.test(form) && /<label[^>]*for="cc-category"/.test(form));
    check(`editor (${lang}): no publish, delete, consent or beneficiary control before anything is saved`, !form.includes(`>${c.editor.delete}<`) && !form.includes(`>${c.editor.publish}<`) && !form.includes(t.churchCare.panel.consent.heading) && !form.includes(t.churchCare.panel.beneficiary.heading));
    check(`editor (${lang}): no money field of any kind`, !/amount|target|currency|price|montant|objectif|XAF|FCFA/i.test(form));
    const list = html(S("CareList"), { caps: caps("church.care.manage") }, lang);
    check(`list (${lang}): the intro, the view filter and the add button`, list.includes(c.subtitle) && list.includes(c.list.views.drafts) && list.includes(c.list.add));
    check(`list (${lang}): a view-only person gets no add button`, !html(S("CareList"), { caps: caps("church.care.view") }, lang).includes(c.list.add));
  }
}

// ---------------------------------------------------------------- 5. source rules of every new screen, and the pages
{
  for (const f of ["components/church/care/CarePanel.tsx", "components/church/care/configs.tsx", "components/church/care/CareScreens.tsx", "components/church/ChurchCareCard.tsx"]) {
    const problems = sourceProblems(path.join(SRC, f));
    check(`${f}: no hard-coded text, no storage, no raw HTML, typed buttons, labelled fields, no database client`, problems.length === 0, problems.join(" ; "));
  }
  const panel = noComments(read("src/components/church/care/CarePanel.tsx"));
  check("the panel only calls /api/church/care/** and nothing about money", /\/api\/church\/care\/\$\{caseId\}\/consent/.test(panel) && /\/api\/church\/care\/\$\{caseId\}\/beneficiary/.test(panel) && !/fapshi|stripe|payment|contribution|\/api\/(?!church\/care)/i.test(panel));
  check("the consent controls are disabled while the editor has unsaved changes, and a withdrawal asks for confirmation", /disabled=\{busy \|\| dirty\}/.test(panel) && /ConfirmDialog/.test(panel) && /danger/.test(panel));
  check("the beneficiary picker offers adults only (a child is never linked)", /ageGroup="adult"/.test(panel));
  for (const [page, cap, sec] of [["care/page.tsx", "viewCare", "care"], ["care/new/page.tsx", "manageCare", "care"], ["care/[id]/page.tsx", "viewCare", "care"]]) {
    const p = noComments(read(`src/app/dashboard/church/${page}`));
    check(`${page}: resolves the actor on the server, refuses a group leader, shows NoAccess without ${cap}`, /resolveChurchActor/.test(p) && new RegExp(`caps\\.${cap}`).test(p) && /kind === "leader"/.test(p) && new RegExp(`NoAccess section="${sec}"`).test(p));
  }
  const idx = noComments(read("src/app/dashboard/church/page.tsx"));
  check("the church index opens Care for a person whose only section is Care", /caps\.viewCare\) redirect\("\/dashboard\/church\/care"\)/.test(idx));
  const ed = noComments(read("src/components/church/lifecycle/LifecycleEditor.tsx"));
  check("the shared editor's new 'select' kind is closed over a fixed list of choices", /def\.kind === "select"/.test(ed) && /def\.choices/.test(ed));
}

// ---------------------------------------------------------------- 6. the workspace shell
{
  const Shell = component("components/church/people/ChurchShell.tsx");
  const caps = (...p) => PERM.churchCapabilities(p);
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const withCare = html(Shell, { caps: caps("church.care.view"), isOwner: false, children: null }, lang);
    check(`shell (${lang}): a person with church.care.view sees the Care tab labelled in ${lang}, and no other tab`, withCare.includes('href="/dashboard/church/care"') && withCare.includes(t.churchWorkspace.tabs.care) && (withCare.match(/<a /g) || []).length === 1);
    const without = html(Shell, { caps: caps("church.events.publish", "church.reports.view", "church.members.view"), isOwner: false, children: null }, lang);
    check(`shell (${lang}): without a care permission there is no Care tab`, !without.includes('href="/dashboard/church/care"'));
    const owner = html(Shell, { caps: caps(...PERM.CHURCH_PERMISSIONS), isOwner: true, children: null }, lang);
    check(`shell (${lang}): the owner sees Reports, then Care, then Store`, owner.indexOf("/dashboard/church/care") > owner.indexOf("/dashboard/church/reports") && owner.indexOf("/dashboard/church/store") > owner.indexOf("/dashboard/church/care"));
  }
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
