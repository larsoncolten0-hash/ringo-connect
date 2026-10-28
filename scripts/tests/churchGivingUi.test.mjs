// Churches & Ministries expansion, Phase 7: the screen of giving and care funds, checked OFFLINE (static render, no browser, no network).
//   * English and French have the same keys for the giving block, every sentence is filled in, and every error code the screen can meet has a sentence;
//   * the screen has no hard-coded text, no direct database client, no storage or markup injection, no untyped button, no unnamed field;
//   * the screen reaches the server only through /api/church/giving-funds, never offers to open or collect, and says plainly that collecting money is not available yet.
//   Run:  node scripts/tests/churchGivingUi.test.mjs
import path from "path";
import { SRC, read, noComments, translations, walkDictionary, sampleArgs, sourceProblems, component, html } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

// ---------------------------------------------------------------- 1. dictionary
{
  const en = translations.en.churchExpansion.giving, fr = translations.fr.churchExpansion.giving;
  const w = walkDictionary(en, fr, "giving");
  check("EN and FR have the same keys and types", w.shape.length === 0, w.shape.join(" ; "));
  check("no sentence is empty", w.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  check("functions give text in both languages", w.fns.every(([k, a, b]) => { const args = sampleArgs(k, a); const x = a(...args), y = b(...args); return typeof x === "string" && typeof y === "string" && x !== "" && y !== ""; }));
  check("French is French (the titles and buttons differ from English)", fr.title !== en.title && fr.add !== en.add && fr.form.save !== en.form.save && fr.status.draft !== en.status.draft && fr.kind.giving !== en.kind.giving);
  const codes = ["invalid_kind", "invalid_title", "invalid_description", "invalid_goal", "invalid_status", "giving_unavailable"];
  check("every error code the screen can meet has a sentence in both languages", codes.every((c) => en.errors[c] && fr.errors[c]));
  check("the 'not available yet' notice says nobody can give yet and funds stay hidden (EN and FR)", /not available yet/i.test(en.notAvailable) && /hidden/i.test(en.notAvailable) && /pas encore disponible/i.test(fr.notAvailable) && /cachés/i.test(fr.notAvailable));
  check("the help text asks not to name a person (a fund is never tied to someone)", /not name a person/i.test(en.form.descriptionHelp) && /ne nommez personne/i.test(fr.form.descriptionHelp));
  check("the text is plain (no markup) in both languages", w.strings.every(([, a, b]) => !/[<>]/.test(a + b)));
}

// ---------------------------------------------------------------- 2. source rules
{
  const f = "components/church/giving/GivingView.tsx";
  const p = sourceProblems(path.join(SRC, f));
  check("GivingView.tsx: no hard-coded text, storage, markup injection, untyped button or unnamed field", p.length === 0, p.join(" | "));
  const view = noComments(read("src/" + f));
  const urls = [...view.matchAll(/["'`](\/api\/[^"'`$?]*)/g)].map((m) => m[1]);
  check("the screen only calls /api/church/giving-funds, plus /api/church/features to learn whether collection is available", urls.length > 0 && urls.every((u) => u.startsWith("/api/church/giving-funds") || u === "/api/church/features"), urls.join());
  check("the screen keeps nothing in the browser (no storage)", !/localStorage|sessionStorage|indexedDB/.test(view));
  check("the screen asks for an 'open' fund ONLY when the server says collection is available (the server and the database refuse it otherwise)", !/"open"/.test(view.replace(/status:\s*"draft"\s*\|\s*"open"\s*\|\s*"closed"/, "").replace(/form\.closed \? "closed" : form\.open && available \? "open" : "draft"/, "").replace(/[fr]\.status === "open"/g, "").replace(/set\("open"/, "")) && /form\.closed \? "closed" : form\.open && available \? "open" : "draft"/.test(view) && /giving_available === true/.test(view));
  check("the screen sends the version being changed with every edit and every delete", /expected_updated_at = current\.updated_at/.test(view) && /expected_updated_at=\$\{encodeURIComponent\(removing\.updated_at\)\}/.test(view));
  check("the screen asks before deleting", /ConfirmDialog/.test(view) && /removeConfirm/.test(view));
  check("the screen never mentions money received, donors, payments or a pay button", !/received|donor|payment|payout|checkout|pay\b/i.test(view));
  check("the kind cannot be changed when editing (the select is disabled)", /disabled=\{form\.id !== null\}/.test(view));
}

// ---------------------------------------------------------------- 3. render
{
  const View = component("components/church/giving/GivingView.tsx");
  for (const lang of ["en", "fr"]) {
    const c = translations[lang].churchExpansion.giving;
    const page = html(View, {}, lang);
    check(`giving screen (${lang}): heading, the 'not available yet' notice and the add button`, page.includes(c.title) && page.includes(c.notAvailable) && page.includes(c.add), page.slice(0, 200));
    check(`giving screen (${lang}): one h1`, (page.match(/<h1\b/g) || []).length === 1);
    check(`giving screen (${lang}): while loading nothing claims a fund exists`, !page.includes(c.emptyTitle));
  }
}

console.log(`${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
