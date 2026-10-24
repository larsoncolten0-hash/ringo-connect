// Churches & Ministries Testimonies: the public form, the public slideshow and the dashboard screens, checked OFFLINE (no database, no network, no dev server).
//   * dictionary parity (EN/FR);
//   * the real "Share your testimony" form in both languages: every field, privacy wording, consent boxes UNCHECKED by default, name consent only after publication consent, honeypot, mobile-friendly controls;
//   * the real slideshow: only text and an allowed name, accessible controls, no automatic rotation, nothing private;
//   * the real ProfileView: the form and the slideshow appear on church pages only; the slideshow only with public testimonies; the editor's live preview shows neither;
//   * the dashboard screens and the workspace shell; the source rules of every new screen.
//   Run:  node scripts/tests/churchTestimoniesUi.test.mjs
import path from "path";
import { SRC, read, noComments, jiti, translations, walkDictionary, sampleArgs, sourceProblems, component, html, uid, cardTheme } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const CAT = jiti(path.join(SRC, "lib/categories.ts"));
const { buildPreviewProfile } = jiti(path.join(SRC, "app/dev-preview-profile/fixtures.ts"));
const item = (n, o = {}) => ({ id: uid(n), display_name: "Marie Ngono", body: "God healed me and my whole family this year.", lang: "en", ...o });

// ---------------------------------------------------------------- 1. dictionary
{
  const out = walkDictionary(translations.en.churchTestimonies, translations.fr.churchTestimonies, "churchTestimonies");
  check("EN and FR have exactly the same keys, types and function arity", out.shape.length === 0, out.shape.join("; "));
  check("no empty text in either language", out.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  const same = out.strings.filter(([, a, b]) => a === b && a.length > 8 && a.includes(" ")).map(([k]) => k);
  check("French is a translation, not a copy", same.length === 0, same.join(", "));
  for (const [key, a, b] of out.fns) {
    const args = a.length === 2 ? (/position/.test(key) ? [2, 5] : /characters/.test(key) ? [10, 3000] : ["Marie", "5 Jan 2026"]) : sampleArgs(key, a);
    check(`${key}() returns text in both languages`, typeof a(...args) === "string" && typeof b(...args) === "string" && a(...args).length > 0 && b(...args).length > 0);
  }
  const e = translations.en.churchTestimonies, f = translations.fr.churchTestimonies;
  check("plurals", e.dashboard.list.count(1) === "1 testimony" && e.dashboard.list.count(2) === "2 testimonies" && f.dashboard.list.count(1) === "1 témoignage" && f.dashboard.list.count(2) === "2 témoignages");
  check("the tab and the no-access sentence exist in both languages", translations.en.churchWorkspace.tabs.testimonies === "Testimonies" && translations.fr.churchWorkspace.tabs.testimonies === "Témoignages" && translations.en.churchWorkspace.restricted.testimonies.length > 10 && translations.fr.churchWorkspace.restricted.testimonies.length > 10);
  const money = /\b(donat\w*|donate|giving|payment|money|amount|fund\w*|dons?(?!')|paiement|argent|montant|cotis\w*)\b/i;
  check("no text mentions money", out.strings.every(([, a, b]) => !money.test(a) && !money.test(b)));
  check("the form says the testimony is sent privately and is public only with the church's approval AND the visitor's permission", /privately/.test(e.public.form.privacy) && /approves/.test(e.public.form.privacy) && /allow/.test(e.public.form.privacy) && /en privé/.test(f.public.form.privacy) && /approuve/.test(f.public.form.privacy) && /autorisiez/.test(f.public.form.privacy));
}

// ---------------------------------------------------------------- 2. the public form
{
  const Share = component("components/church/ShareTestimony.tsx");
  const props = (t, o = {}) => ({ t, locale: t === translations.fr ? "fr" : "en", username: "graceassembly", ...cardTheme, ...o });
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const c = t.churchTestimonies.public;
    const closed = html(Share, props(t), lang);
    check(`closed (${lang}): a welcoming title, the introduction and ONE button; no field is shown`, closed.includes(c.shareTitle) && closed.includes(c.shareIntro) && closed.includes(c.shareButton) && !/<input|<textarea|<form/.test(closed));
    check(`closed (${lang}): the button controls the form and says it is collapsed`, /aria-expanded="false"/.test(closed) && /aria-controls="church-testimony-form"/.test(closed));
    const open = html(Share, props(t, { initiallyOpen: true }), lang);
    const f = c.form;
    check(`form (${lang}): every field has its label in ${lang}`, [f.fullName, f.phone, f.group, f.testimony, f.publishConsent].every((x) => open.includes(x)) && open.includes(f.groupOptional), open.slice(0, 200));
    check(`form (${lang}): required fields are marked and labelled (name, phone, testimony); the group is optional`, /<input id="ct-name"[^>]*required/.test(open) && /<textarea id="ct-body"[^>]*required/.test(open) && !/<input id="ct-group"[^>]*required/.test(open));
    check(`form (${lang}): the privacy wording is shown above the fields`, open.includes(f.privacy) && open.indexOf(f.privacy) < open.indexOf(f.fullName));
    check(`form (${lang}): the permission checkbox is UNCHECKED by default and separate from sending`, /<input id="ct-publish" type="checkbox"/.test(open) && !/<input id="ct-publish"[^>]*checked/.test(open) && open.includes(f.consentNote));
    check(`form (${lang}): the NAME permission is not even offered until publication is allowed`, !open.includes('id="ct-name-consent"') && !open.includes(f.nameConsent));
    check(`form (${lang}): a clear submit button with a real submit type`, new RegExp(`<button type="submit"[^>]*>(<svg[^>]*></svg>)?${f.submit}</button>`).test(open));
    check(`form (${lang}): the honeypot is hidden from people and assistive technology and not focusable`, /aria-hidden="true"[^>]*><input id="ct-website" tabindex="-1"/i.test(open) || /id="ct-website"[^>]*tabindex="-1"/i.test(open));
    check(`form (${lang}): a phone field with a country-code picker defaulting to Cameroon`, /<select[^>]*aria-label="Country code"/.test(open) && /value="237"/.test(open) && open.includes(f.phoneHint));
    check(`form (${lang}): controls are at least 44px tall (mobile)`, (open.match(/min-h-\[44px\]/g) || []).length >= 6);
    check(`form (${lang}): no browser storage, no account, no sign-in`, !/login|sign in|connexion|password|mot de passe/i.test(open));
    check(`form (${lang}): character counter`, open.includes(f.characters(0, 3000)));
  }
  const src = noComments(read("src/components/church/ShareTestimony.tsx"));
  check("the form posts to the public route only, with the username and a per-form key, never a church id", /\/api\/public\/church-testimony/.test(src) && /username/.test(src) && /submission_key: key\.current/.test(src) && !/profile_id|profileId/.test(src));
  check("the key is made once per form and the button is disabled while sending", /if \(!key\.current\) key\.current = globalThis\.crypto\.randomUUID\(\)/.test(src) && /disabled=\{status === "sending"\}/.test(src) && /if \(status === "sending"\) return/.test(src));
  check("name consent is sent only together with publication consent", /name_consent: publishConsent && nameConsent/.test(src));
  check("unticking publication also clears the name permission", /if \(!e\.target\.checked\) setNameConsent\(false\)/.test(src));
  const problems = sourceProblems(path.join(SRC, "components/church/ShareTestimony.tsx"));
  check("no hard-coded text, no storage, no raw HTML, typed buttons, labelled fields, no database client", problems.length === 0, problems.join(" ; "));
}

// ---------------------------------------------------------------- 3. the slideshow
{
  const Card = component("components/church/ChurchTestimoniesCard.tsx");
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const c = t.churchTestimonies.public;
    const one = html(Card, { t, testimonies: [item(1)], ...cardTheme }, lang);
    check(`slideshow (${lang}): a labelled carousel section with a real h2, the text, and the allowed name`, /<section aria-labelledby="church-testimonies-heading" aria-roledescription="carousel"/.test(one) && /<h2 id="church-testimonies-heading"/.test(one) && one.includes(c.heading) && one.includes("God healed me") && one.includes(c.by("Marie Ngono")));
    check(`slideshow (${lang}): the slide is a labelled group, announced politely`, one.includes(`aria-label="${c.position(1, 1)}"`) && /aria-live="polite"/.test(one) && /aria-roledescription="slide"/.test(one));
    check(`slideshow (${lang}): with ONE testimony there are no controls`, !one.includes(c.previous) && !one.includes(c.next));
    const three = html(Card, { t, testimonies: [item(1), item(2, { display_name: null, body: "Second testimony without any name." }), item(3, { body: "Third testimony text goes right here." })], ...cardTheme }, lang);
    check(`slideshow (${lang}): previous and next buttons, one dot per testimony, labelled in ${lang}`, three.includes(`aria-label="${c.previous}"`) && three.includes(`aria-label="${c.next}"`) && [1, 2, 3].every((i) => three.includes(`aria-label="${c.goTo(i)}"`)) && three.includes(`aria-label="${c.position(1, 3)}"`));
    check(`slideshow (${lang}): the current dot is marked and every control is a real button of at least 44px`, (three.match(/aria-current="true"/g) || []).length === 1 && (three.match(/<button type="button"/g) || []).length === 5 && !/<button(?![^>]*type=)/.test(three) && /h-11 w-11/.test(three));
    check(`slideshow (${lang}): only the FIRST slide's text is in the page (one at a time)`, three.includes("God healed me") && !three.includes("Second testimony") && !three.includes("Third testimony"));
    const anon = html(Card, { t, testimonies: [item(4, { display_name: null })], ...cardTheme }, lang);
    check(`slideshow (${lang}): no name when none was allowed`, !anon.includes("<footer") && !anon.includes("—"));
    const evil = html(Card, { t, testimonies: [item(5, { body: "<img src=x onerror=alert(1)>", display_name: "<script>alert(1)</script>" })], ...cardTheme }, lang);
    check(`slideshow (${lang}): markup in the text or the name is escaped`, !/<img src=x|<script>alert/.test(evil) && evil.includes("&lt;"));
    const leaky = html(Card, { t, testimonies: [{ ...item(6), phone: "237670999888", group_label: "Secret Group", moderation_note: "INTERNAL", review_status: "approved" }], ...cardTheme }, lang);
    check(`slideshow (${lang}): even if a row carried a phone, a group or a note, the card never prints them`, !/237670999888|Secret Group|INTERNAL|approved/.test(leaky));
    check(`slideshow (${lang}): nothing at all when there are no testimonies`, html(Card, { t, testimonies: [], ...cardTheme }, lang) === "");
  }
  const src = noComments(read("src/components/church/ChurchTestimoniesCard.tsx"));
  check("the slideshow has no timer, interval, animation loop or autoplay", !/setInterval|setTimeout|requestAnimationFrame|autoplay|autoPlay/i.test(src));
  check("the arrow keys move between testimonies and wrap around", /ArrowRight/.test(src) && /ArrowLeft/.test(src) && /\(\(to % n\) \+ n\) % n/.test(src));
  const problems = sourceProblems(path.join(SRC, "components/church/ChurchTestimoniesCard.tsx"));
  check("the card: no hard-coded text, no storage, no raw HTML, typed buttons", problems.length === 0, problems.join(" ; "));
}

// ---------------------------------------------------------------- 4. the real ProfileView
{
  let PV = null, loadErr = "";
  try { PV = component("components/ProfileView.tsx"); } catch (e) { loadErr = String(e.stack || e); }
  check("ProfileView loads in the offline renderer", !!PV, loadErr.slice(0, 500));
  if (PV) {
    const opts = (category, lang) => ({ category, lang, accent: "#818CF8", bg: "#14112B", text: "#FAFAF8", bgStyle: "solid", button: "fill", radius: "rounded", long: false, minimal: false });
    const page = (category, lang, churchPublic, preview = false) => html(PV, { profile: buildPreviewProfile(opts(category, lang)), pageViewEventId: "preview", preview, churchPublic }, lang);
    const none = { events: [], announcements: [], programs: [], music: [], care: [], testimonies: [] };
    const some = { ...none, testimonies: [item(30)] };
    const ch = page("church_ministries", "en", some);
    check("a church page with a public testimony: the slideshow AND the share section appear, after 'Visit us'", ch.includes("church-testimonies-heading") && ch.includes("church-testimony-share-heading") && ch.indexOf("church-visit-heading") < ch.indexOf("church-testimonies-heading") && ch.indexOf("church-testimonies-heading") < ch.indexOf("church-testimony-share-heading"));
    check("(fr): French headings and the French text", page("church_ministries", "fr", some).includes("Témoignages") && page("church_ministries", "fr", some).includes("Partagez votre témoignage"));
    const empty = page("church_ministries", "en", none);
    check("with NO public testimony there is no slideshow, no empty heading and no placeholder claim, but the share section is there", !empty.includes("church-testimonies-heading") && empty.includes("church-testimony-share-heading"));
    check("a bundle from before this feature (no testimonies key) does not break the page", !page("church_ministries", "en", { events: [], announcements: [], programs: [], music: [] }).includes("church-testimonies-heading") && page("church_ministries", "en", undefined).includes("church-testimony-share-heading"));
    const leaks = [];
    for (const c of CAT.CATEGORY_IDS.filter((x) => x !== "church_ministries")) for (const lang of ["en", "fr"]) if (/church-testimon/.test(page(c, lang, some))) leaks.push(`${c}/${lang}`);
    check("no other category's page shows either section (16 categories x 2 languages)", leaks.length === 0, leaks.join(", "));
    const prev = page("church_ministries", "en", some, true);
    check("the editor's live preview shows no share form (nothing can be sent from a preview)", !prev.includes("church-testimony-share-heading"));
    check("the page never prints a phone number or a private field even if the bundle carried them", !/237670999888|Secret Group/.test(page("church_ministries", "en", { ...none, testimonies: [{ ...item(31), phone: "237670999888", group_label: "Secret Group" }] })));
  }
  const view = read("src/components/ProfileView.tsx");
  check("ProfileView: both are gated on the church flag; the form also on not being a preview", (/isChurch && \(churchPublic\.testimonies \?\? \[\]\)\.length > 0/.test(view) && /isChurch && !preview && \(\s*<ShareTestimony/.test(view)));
  const pageSrc = read("src/app/[username]/page.tsx");
  check("the public route loads the bundle for churches only (unchanged), which now carries the testimonies", /profileHasCategory\(profile, "church_ministries"\) \? loadChurchPublic\(supabase, profile\.id\)/.test(pageSrc) && !/ministry_testimon/.test(pageSrc));
}

// ---------------------------------------------------------------- 5. the dashboard screens
{
  const List = component("components/church/testimonies/TestimoniesList.tsx");
  const Detail = component("components/church/testimonies/TestimonyDetail.tsx");
  const RO = component("components/church/testimonies/TestimonyDetail.tsx", "TestimonyReadOnly");
  const caps = (...p) => PERM.churchCapabilities(p);
  const base = { id: uid(1), full_name: "Marie Ngono", phone: "237670123456", group_label: "Choir", lang: "en", body: "God healed me and my whole family this year.", public_body: null, moderation_note: null, publish_consent: true, name_consent: true, consent_withdrawn_at: null, review_status: "approved", publication_status: "published", created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-21T10:00:00Z" };
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const d = t.churchTestimonies.dashboard;
    const list = html(List, {}, lang);
    check(`list (${lang}): the intro (private, approval + consent needed), the search, every filter and the date range`, list.includes(d.subtitle) && list.includes(d.list.searchLabel) && list.includes(d.list.statusLabel) && list.includes(d.list.publicationLabel) && list.includes(d.list.fromLabel) && list.includes(d.list.toLabel) && Object.values(d.list.statuses).every((x) => list.includes(`>${x}<`)));
    check(`list (${lang}): every filter control is labelled`, ["ctl-search", "ctl-status", "ctl-publication", "ctl-from", "ctl-to"].every((id) => new RegExp(`for="${id}"`).test(list) && new RegExp(`id="${id}"`).test(list)));
    const ro = html(RO, { item: base, history: [{ id: uid(9), action: "approved", created_at: "2026-10-21T10:00:00Z" }, { id: uid(10), action: "submitted", created_at: "2026-10-20T10:00:00Z" }] }, lang);
    check(`detail (${lang}): the full words, the phone, the group, the date, review and page state`, ro.includes("God healed me") && ro.includes("+237670123456") && ro.includes("Choir") && ro.includes(d.list.review.approved) && ro.includes(d.detail.onPage));
    check(`detail (${lang}): the person's permissions are stated (publication and name)`, ro.includes(d.detail.publishConsentYes) && ro.includes(d.detail.nameConsentYes));
    check(`detail (${lang}): the moderation history is listed with labels`, ro.includes(d.detail.actions.approved) && ro.includes(d.detail.actions.submitted) && ro.includes(d.detail.historyHeading));
    const refused = html(RO, { item: { ...base, publish_consent: false, name_consent: false, publication_status: "unpublished" }, history: [] }, lang);
    check(`detail (${lang}): a refusal is stated plainly`, refused.includes(d.detail.publishConsentNo) && !refused.includes(d.detail.nameConsentYes) && refused.includes(d.detail.historyEmpty) && refused.includes(d.detail.notOnPage));
    const edited = html(RO, { item: { ...base, public_body: "God healed me and my family." }, history: [] }, lang);
    check(`detail (${lang}): a corrected text shows BOTH the original words and the page text`, edited.includes(d.detail.original) && edited.includes(d.detail.publicText) && edited.includes("God healed me and my whole family") && edited.includes("God healed me and my family."));
    const withdrawn = html(RO, { item: { ...base, publish_consent: false, name_consent: false, consent_withdrawn_at: "2026-10-22T10:00:00Z", publication_status: "unpublished" }, history: [] }, lang);
    check(`detail (${lang}): a withdrawal is dated`, withdrawn.includes(d.detail.withdrawnOn("22 Oct 2026")) || /22/.test(withdrawn.match(/Permission withdrawn[^<]*|Autorisation retirée[^<]*/)?.[0] || ""));
    const evil = html(RO, { item: { ...base, full_name: "<img src=x onerror=alert(1)>", body: "<script>alert(1)</script>" }, history: [] }, lang);
    check(`detail (${lang}): markup in a name or a testimony is escaped`, !/<img src=x|<script>alert/.test(evil) && evil.includes("&lt;"));
    check(`detail container (${lang}): first render is the loading skeleton, nothing private`, !html(Detail, { id: uid(1), caps: caps("church.testimonies.view") }, lang).includes("237670"));
  }
  const det = noComments(read("src/components/church/testimonies/TestimonyDetail.tsx"));
  check("the detail screen only calls /api/church/testimonies/** with the reviewed version", /\/api\/church\/testimonies\/\$\{id\}/.test(det) && /expected_updated_at: data\.item\.updated_at/.test(det) && !/\/api\/(?!church\/testimonies)/.test(det.replace(/\/api\/church\/testimonies/g, "")));
  check("approve, reject, publish, unpublish and both withdrawals each ask for confirmation", ["approve", "reject", "publish", "unpublish", "withdraw_publication", "withdraw_name"].every((k) => new RegExp(`pending === "${k}" && <ConfirmDialog`).test(det)));
  check("publishing is offered only by the server's 'can' flag, and the screen never sends a consent value", /can.publish/.test(det) && !/publish_consent: (true|false)|name_consent: (true|false)/.test(det));
  check("the original words are never sent back: only public_body and the note are written", /public_body: text/.test(det) && !/\bbody: text\b/.test(det));
  for (const f of ["components/church/testimonies/TestimoniesList.tsx", "components/church/testimonies/TestimonyDetail.tsx"]) {
    const problems = sourceProblems(path.join(SRC, f));
    check(`${f}: no hard-coded text, no storage, no raw HTML, typed buttons, labelled fields, no database client`, problems.length === 0, problems.join(" ; "));
  }
  for (const [pg, cap] of [["testimonies/page.tsx", "viewTestimonies"], ["testimonies/[id]/page.tsx", "viewTestimonies"]]) {
    const p = noComments(read(`src/app/dashboard/church/${pg}`));
    check(`${pg}: resolves the actor on the server, refuses a group leader, shows NoAccess without ${cap}`, /resolveChurchActor/.test(p) && new RegExp(`caps\\.${cap}`).test(p) && /kind === "leader"/.test(p) && /NoAccess section="testimonies"/.test(p));
  }
  check("the church index opens Testimonies for a person whose only section is Testimonies", /caps\.viewTestimonies\) redirect\("\/dashboard\/church\/testimonies"\)/.test(noComments(read("src/app/dashboard/church/page.tsx"))));
}

// ---------------------------------------------------------------- 6. the workspace shell
{
  const Shell = component("components/church/people/ChurchShell.tsx");
  const caps = (...p) => PERM.churchCapabilities(p);
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const withT = html(Shell, { caps: caps("church.testimonies.view"), isOwner: false, children: null }, lang);
    check(`shell (${lang}): a person with church.testimonies.view sees the Testimonies tab labelled in ${lang}, and no other tab`, withT.includes('href="/dashboard/church/testimonies"') && withT.includes(t.churchWorkspace.tabs.testimonies) && (withT.match(/<a /g) || []).length === 1);
    const without = html(Shell, { caps: caps("church.care.publish", "church.reports.view", "church.members.view", "church.events.publish"), isOwner: false, children: null }, lang);
    check(`shell (${lang}): other church permissions do NOT show the Testimonies tab`, !without.includes('href="/dashboard/church/testimonies"'));
    const owner = html(Shell, { caps: caps(...PERM.CHURCH_PERMISSIONS), isOwner: true, children: null }, lang);
    check(`shell (${lang}): the owner sees Care, then Testimonies, then Store`, owner.indexOf("/dashboard/church/testimonies") > owner.indexOf("/dashboard/church/care") && owner.indexOf("/dashboard/church/store") > owner.indexOf("/dashboard/church/testimonies"));
  }
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
