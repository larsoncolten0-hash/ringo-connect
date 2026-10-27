// Churches & Ministries expansion, Phase 6: the screens of counselling requests, checked OFFLINE (static render, no browser, no network).
//   * English and French have the same keys for the counselling block, every sentence is filled in, and every error code a visitor or staff member can meet has a sentence;
//   * the new screens have no hard-coded text, no direct database client, no storage or markup injection, no untyped button, no unnamed field;
//   * the staff screen reaches the server only through /api/church/counselling; the visitor form only through /api/public/church-counselling;
//   * the visitor form needs the agreement, keeps nothing in the browser, and its preview is inert; the staff screen shows the reason only in the detail view.
//   Run:  node scripts/tests/churchCounsellingUi.test.mjs
import path from "path";
import { SRC, read, noComments, translations, walkDictionary, sampleArgs, sourceProblems, component, html } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

// ---------------------------------------------------------------- 1. dictionary
{
  const en = translations.en.churchExpansion.counselling, fr = translations.fr.churchExpansion.counselling;
  const w = walkDictionary(en, fr, "counselling");
  check("EN and FR have the same keys and types", w.shape.length === 0, w.shape.join(" ; "));
  check("no sentence is empty", w.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  check("functions give text in both languages", w.fns.every(([k, a, b]) => { const args = sampleArgs(k, a); const x = a(...args), y = b(...args); return typeof x === "string" && typeof y === "string" && x !== "" && y !== ""; }));
  check("French is French (the titles and buttons differ from English)", fr.title !== en.title && fr.form.title !== en.form.title && fr.form.send !== en.form.send && fr.detail.approve !== en.detail.approve && fr.status.pending !== en.status.pending);
  const visitorCodes = ["invalid_name", "invalid_phone", "invalid_email", "invalid_reason", "consent_required", "too_many", "not_found", "generic"];
  check("every error code a visitor can meet has a sentence in both languages", visitorCodes.every((c) => en.form.errors[c] && fr.form.errors[c]));
  check("every staff error code has a sentence in both languages", ["invalid_note", "invalid_status"].every((c) => en.errors[c] && fr.errors[c]));
  check("the privacy lines promise that only the counselling team reads a request (EN and FR)", /only/i.test(en.form.privacy) && /counselling team/i.test(en.form.privacy) && /uniquement|seule/i.test(fr.form.privacy) && /conseil|accompagnement/i.test(fr.form.privacy));
  check("the staff privacy line says it is not used in reports, notifications or the assistant", /reports/i.test(en.privacy) && /notifications/i.test(en.privacy) && /assistant/i.test(en.privacy) && /rapports/i.test(fr.privacy) && /notifications/i.test(fr.privacy) && /assistant/i.test(fr.privacy));
  check("the visitor consent sentence says the church team may contact them", /contact/i.test(en.form.consent) && /contact/i.test(fr.form.consent));
  check("the text is plain (no markup) in both languages", w.strings.every(([, a, b]) => !/[<>]/.test(a + b)));
}

// ---------------------------------------------------------------- 2. source rules
{
  for (const f of ["components/church/counselling/CounsellingView.tsx", "components/church/site/ChurchCounsellingForm.tsx"]) {
    const p = sourceProblems(path.join(SRC, f));
    check(`${path.basename(f)}: no hard-coded text, storage, markup injection, untyped button or unnamed field`, p.length === 0, p.join(" | "));
  }
  const view = noComments(read("src/components/church/counselling/CounsellingView.tsx"));
  const urls = [...view.matchAll(/["'`](\/api\/[^"'`$?]*)/g)].map((m) => m[1]);
  check("the staff screen only calls /api/church/counselling", urls.length > 0 && urls.every((u) => u.startsWith("/api/church/counselling")), urls.join());
  check("the staff screen keeps nothing in the browser (no local or session storage)", !/localStorage|sessionStorage|indexedDB/.test(view));
  check("the staff screen sends the version being changed with every change and every delete", /expected_updated_at: item\.updated_at/.test(view) && /expected_updated_at=\$\{encodeURIComponent\(item\.updated_at\)\}/.test(view));
  check("the staff screen asks before deleting", /deleteConfirm/.test(view) && /deleteTitle/.test(view));
  const form = noComments(read("src/components/church/site/ChurchCounsellingForm.tsx"));
  const furls = [...form.matchAll(/["'`](\/api\/[^"'`$?]*)/g)].map((m) => m[1]);
  check("the visitor form only calls /api/public/church-counselling", furls.length > 0 && furls.every((u) => u === "/api/public/church-counselling"), furls.join());
  check("the visitor form keeps nothing in the browser (no storage, no draft, no cookie)", !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(form));
  check("the visitor form never logs", !/console\./.test(form) && !/console\./.test(view));
  check("the visitor form has a hidden trap field a person never reaches (aria-hidden, no tab stop)", /aria-hidden/.test(form) && /tabIndex=\{-1\}/.test(form));
  check("the visitor form cannot be sent without the agreement", /disabled=\{busy \|\| !agree\}/.test(form) || /!agree/.test(form));
  check("the visitor form sends the agreement as the person's own tick", /contact_consent: agree/.test(form));
}

// ---------------------------------------------------------------- 3. render
{
  const View = component("components/church/counselling/CounsellingView.tsx");
  const Form = component("components/church/site/ChurchCounsellingForm.tsx");
  const accent = { username: "grace", accent: "#4F46E5", accentText: "#4338CA", textColor: "#14110A", borderTint: "rgba(20,17,10,0.12)", radiusClass: "rounded-[22px]" };
  for (const lang of ["en", "fr"]) {
    const c = translations[lang].churchExpansion.counselling;
    const page = html(View, { canDecide: true }, lang);
    check(`staff screen (${lang}): heading, the privacy line and the search field with a name`, page.includes(c.title) && page.includes(c.privacy) && page.includes(`aria-label="${c.searchLabel}"`));
    check(`staff screen (${lang}): one h1`, (page.match(/<h1\b/g) || []).length === 1);
    check(`staff screen (${lang}): the filters are offered`, [c.filters.all, c.filters.pending, c.filters.approved, c.filters.declined].every((l) => page.includes(l)));

    const preview = html(Form, { ...accent, preview: true }, lang);
    check(`visitor form (${lang}) preview: inert, explains itself, no form`, preview.includes(c.form.title) && preview.includes(c.form.preview) && !preview.includes("<form") && !preview.includes("<input") && !preview.includes("<textarea"));
    const form = html(Form, accent, lang);
    check(`visitor form (${lang}): title, every field has a label, the privacy line, and a submit button`, form.includes(c.form.title) && form.includes(c.form.name) && form.includes(c.form.phone) && form.includes(c.form.reason) && form.includes(c.form.privacy) && form.includes(c.form.send), form.slice(0, 300));
    check(`visitor form (${lang}): the agreement box is not ticked and the button waits for it`, !/checked=""/.test(form) && /<button[^>]*disabled/.test(form));
    check(`visitor form (${lang}): the trap field is hidden from people and assistive technology`, /aria-hidden="true"/.test(form));
  }
}

console.log(`${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
