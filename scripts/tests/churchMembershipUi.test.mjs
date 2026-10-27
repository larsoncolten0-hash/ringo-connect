// Churches & Ministries expansion, Phase 4: the screens of church membership, checked OFFLINE (static render, no browser, no network).
//   * English and French have the same keys for the membership block, every sentence is filled in, and every error code the visitor can meet has a sentence;
//   * the new screens have no hard-coded text, no direct database client, no storage or markup injection, no untyped button, no unnamed field;
//   * the Members screen reaches the server only through /api/church/**; the visitor card only through /api/customer/church-membership;
//   * the visitor card: a form with a real radio group and an explicit consent box, a child is never offered, the preview is inert;
//   * the Members screen renders its loading state and its heading in both languages, and the export buttons only exist for a person with the export permission.
//   Run:  node scripts/tests/churchMembershipUi.test.mjs
import path from "path";
import { SRC, read, noComments, translations, walkDictionary, sampleArgs, sourceProblems, component, html } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

// ---------------------------------------------------------------- 1. dictionary
{
  const en = translations.en.churchExpansion.members, fr = translations.fr.churchExpansion.members;
  const w = walkDictionary(en, fr, "members");
  check("EN and FR have the same keys and types", w.shape.length === 0, w.shape.join(" ; "));
  check("no sentence is empty", w.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  check("functions give text in both languages", w.fns.every(([k, a, b]) => { const args = sampleArgs(k, a); const x = a(...args), y = b(...args); return typeof x === "string" && typeof y === "string" && x !== "" && y !== ""; }));
  check("French is French (a few labels differ from English)", fr.title !== en.title && fr.requests.approve !== en.requests.approve && fr.join.send !== en.join.send && fr.pdf.members.name !== en.pdf.members.name);
  const codes = ["not_signed_in", "church_request_not_connected", "church_request_cooldown", "church_request_limit", "church_request_unavailable", "consent_required", "invalid_age_group", "generic"];
  check("every error code a visitor can meet has a sentence in both languages", codes.every((c) => en.join.errors[c] && fr.join.errors[c]));
  check("the consent sentence names what is kept (name and contact details)", /name/i.test(en.join.consent) && /nom/i.test(fr.join.consent));
  check("the visitor is never offered a child registration", !/child/i.test(en.join.adult + en.join.youth) && !/enfant/i.test(fr.join.adult + fr.join.youth));
  check("the PDF text is plain (no markup) in both languages", w.strings.filter(([k]) => k.includes(".pdf.")).every(([, a, b]) => !/[<>]/.test(a + b)));
}

// ---------------------------------------------------------------- 2. source rules
{
  for (const f of ["components/church/members/MembersView.tsx", "components/church/site/ChurchMembershipJoin.tsx"]) {
    const p = sourceProblems(path.join(SRC, f));
    check(`${path.basename(f)}: no hard-coded text, storage, markup injection, untyped button or unnamed field`, p.length === 0, p.join(" | "));
  }
  const members = noComments(read("src/components/church/members/MembersView.tsx"));
  const urls = [...members.matchAll(/["'`](\/api\/[^"'`$?]*)/g)].map((m) => m[1]);
  check("the Members screen only calls /api/church/**", urls.length > 0 && urls.every((u) => u.startsWith("/api/church/")), urls.join());
  const join = noComments(read("src/components/church/site/ChurchMembershipJoin.tsx"));
  const jurls = [...join.matchAll(/["'`](\/api\/[^"'`$?]*)/g)].map((m) => m[1]);
  check("the visitor card only calls /api/customer/church-membership", jurls.length > 0 && jurls.every((u) => u === "/api/customer/church-membership"), jurls.join());
  check("the visitor card sends only the profile, the age group and the consent", /JSON\.stringify\(\{ profile_id: profile\.id, age_group: age, consent: agree \}\)/.test(join));
  check("the visitor card offers adult and youth only", /\(\["adult", "youth"\] as const\)/.test(join) && !/"child"/.test(join));
  check("the visitor card cannot be submitted without the agreement", /disabled=\{busy \|\| !agree\}/.test(join));
  check("the Members screen does not keep a list in the browser (no local or session storage)", !/localStorage|sessionStorage/.test(members));
}

// ---------------------------------------------------------------- 3. render
{
  const Members = component("components/church/members/MembersView.tsx");
  const Join = component("components/church/site/ChurchMembershipJoin.tsx");
  const accent = { accent: "#4F46E5", accentText: "#4338CA", textColor: "#14110A", borderTint: "rgba(20,17,10,0.12)", radiusClass: "rounded-[22px]" };
  for (const lang of ["en", "fr"]) {
    const c = translations[lang].churchExpansion.members;
    const page = html(Members, { canManage: true, canExport: true, canExportLeadership: true, canExportGroups: true }, lang);
    check(`members screen (${lang}): heading, requests and members sections, search field with a name`, page.includes(c.title) && page.includes(c.requests.title) && page.includes(c.list.title) && page.includes(`aria-label="${c.list.searchLabel}"`));
    check(`members screen (${lang}): the three downloads for a holder of the export permission`, page.includes(c.lists.title) && [c.lists.members, c.lists.leadership, c.lists.groups].every((l) => page.includes(l)));
    const noExport = html(Members, { canManage: true, canExport: false, canExportLeadership: false, canExportGroups: false }, lang);
    check(`members screen (${lang}): NO download without the export permission`, !noExport.includes(c.lists.title) && !noExport.includes(c.lists.help));
    const some = html(Members, { canManage: false, canExport: true, canExportLeadership: false, canExportGroups: false }, lang);
    check(`members screen (${lang}): only the lists the person may see are offered`, some.includes(`${c.lists.download}: ${c.lists.members}`) && !some.includes(`${c.lists.download}: ${c.lists.leadership}`) && !some.includes(`${c.lists.download}: ${c.lists.groups}`));
    check(`members screen (${lang}): one h1`, (page.match(/<h1\b/g) || []).length === 1);

    const preview = html(Join, { profile: { id: "p", name: "Grace" }, ...accent, preview: true }, lang);
    check(`membership card (${lang}) preview: inert, explains itself, no form`, preview.includes(c.join.title) && preview.includes(c.join.preview) && !preview.includes("<form") && !preview.includes("<input"));
    check(`membership card (${lang}): while loading nothing is drawn (no flash of a form)`, html(Join, { profile: { id: "p", name: "Grace" }, ...accent }, lang) === "");
  }
}

console.log(`${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
