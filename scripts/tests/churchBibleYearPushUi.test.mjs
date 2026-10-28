// Churches & Ministries expansion, Phase 5: the screens of "The Bible in one year", the church feature switches and the notification choices, checked OFFLINE (static render, no browser, no network).
//   * English and French have the same keys, every sentence is filled in, every error code a visitor or the owner can meet has a sentence;
//   * the new screens have no hard-coded text, no direct database client, no storage or markup injection, no untyped button, no unnamed field;
//   * the reader's page, the cards and the owner's switches render in both languages; the private choices are never drawn by the server;
//   * the church page shows the Bible-in-one-year section only when the owner switched it on.
//   Run:  node scripts/tests/churchBibleYearPushUi.test.mjs
import path from "path";
import { SRC, read, noComments, translations, walkDictionary, sampleArgs, sourceProblems, component, html } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };
const theme = { accent: "#4F46E5", accentText: "#4338CA", textColor: "#14110A", borderTint: "rgba(20,17,10,0.12)", radiusClass: "rounded-[22px]" };

// ---------------------------------------------------------------- 1. dictionary
for (const block of ["bibleYear", "features", "push"]) {
  const en = translations.en.churchExpansion[block], fr = translations.fr.churchExpansion[block];
  const w = walkDictionary(en, fr, block);
  check(`${block}: EN and FR have the same keys and types`, w.shape.length === 0, w.shape.join(" ; "));
  check(`${block}: no sentence is empty`, w.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  check(`${block}: functions give text in both languages`, w.fns.every(([k, a, b]) => { const args = sampleArgs(k, a); const x = a(...args), y = b(...args); return typeof x === "string" && typeof y === "string" && x !== "" && y !== ""; }));
}
{
  const en = translations.en.churchExpansion, fr = translations.fr.churchExpansion;
  check("French is French (the titles differ from English)", fr.bibleYear.title !== en.bibleYear.title && fr.features.title !== en.features.title && fr.push.card.title !== en.push.card.title);
  const codes = ["not_signed_in", "not_connected", "plan_unavailable", "not_following", "future_day", "plan_closed", "bible_year_limit", "invalid_day", "generic"];
  check("every reader error code has a sentence in both languages", codes.every((c) => en.bibleYear.errors[c] && fr.bibleYear.errors[c]));
  const pcodes = ["not_signed_in", "not_connected", "church_push_not_connected", "invalid_topics", "church_unavailable", "generic"];
  check("every notification error code has a sentence in both languages", pcodes.every((c) => en.push.card.errors[c] && fr.push.card.errors[c]));
  const topics = ["announcements", "events", "testimonies", "daily_word", "bible_day", "care", "store", "groups"];
  check("every topic has a label and a help line in both languages", topics.every((t) => en.push.card.topics[t].label && en.push.card.topics[t].help && fr.push.card.topics[t].label && fr.push.card.topics[t].help));
  const kinds = ["announcement", "group_announcement", "event", "testimony", "daily_word", "bible_day", "care", "product"];
  check("every notification kind has a sentence with and without a title, in both languages", kinds.every((k) => en.push.messages[k].plain && fr.push.messages[k].plain && en.push.messages[k].withTitle("X").includes("X") && fr.push.messages[k].withTitle("X").includes("X")));
  check("the giving feature says it is not available yet, in both languages", en.features.giving.unavailable.length > 20 && fr.features.giving.unavailable.length > 20 && en.features.errors.giving_unavailable && fr.features.errors.giving_unavailable);
  check("the privacy lines promise the church cannot see (EN and FR)", /cannot see/i.test(en.bibleYear.privacy) && /ne voit/i.test(fr.bibleYear.privacy) && /cannot see/i.test(en.push.card.privacy) && /ne voit/i.test(fr.push.card.privacy));
  check("the Bible reading screens talk about references to read in one's own Bible (no Bible text)", /own Bible/i.test(en.bibleYear.scriptureNote) && /propre Bible/i.test(fr.bibleYear.scriptureNote));
}

// ---------------------------------------------------------------- 2. source rules
{
  for (const f of ["components/church/site/ChurchBibleYearBody.tsx", "components/church/site/ChurchBibleYearCard.tsx", "components/church/site/ChurchNotificationsCard.tsx", "components/church/features/FeaturesView.tsx"]) {
    const p = sourceProblems(path.join(SRC, f));
    check(`${path.basename(f)}: no hard-coded text, storage, markup injection, untyped button or unnamed field`, p.length === 0, p.join(" | "));
  }
  const by = noComments(read("src/components/church/site/ChurchBibleYearBody.tsx"));
  check("the reader page only calls /api/customer/church-bible-year", [...by.matchAll(/["'`](\/api\/[^"'`$?]*)/g)].every((m) => m[1] === "/api/customer/church-bible-year") && /church-bible-year/.test(by));
  check("the reader page never sends a start date or a name", !/start_date|full_name|email/.test(by.replace(/state\.start_date/g, "")));
  const nc = noComments(read("src/components/church/site/ChurchNotificationsCard.tsx"));
  const nurls = [...nc.matchAll(/["'`](\/api\/[^"'`$?]*)/g)].map((m) => m[1]);
  check("the notification card only calls its own route and the existing device route", nurls.length > 0 && nurls.every((u) => u === "/api/customer/church-push" || u === "/api/customer/push/subscribe"), nurls.join());
  check("the notification card asks for the browser's permission only from a click (subscribe is inside a click handler)", /const enableDevice = async/.test(nc) && !/useEffect\([^)]*subscribeToPush/.test(nc) && (nc.match(/subscribeToPush\(/g) || []).length === 1);
  const fv = noComments(read("src/components/church/features/FeaturesView.tsx"));
  check("the owner's switches only call /api/church/features, and giving is no longer switched here: its row only links to the Giving menu (GivingSwitch there uses the same server flow)", /\/api\/church\/features/.test(fv) && !/givingAvailable/.test(fv) && !/body\.giving/.test(fv) && /\/dashboard\/church\/giving/.test(fv));
  const site = noComments(read("src/components/church/site/ChurchSiteView.tsx"));
  check("the church page shows the Bible-in-one-year section only when the owner switched it on", /bibleYear: churchPublic\.features\?\.bible_year === true/.test(site) && /\{present\.bibleYear && \(/.test(site));
}

// ---------------------------------------------------------------- 3. render
{
  const Body = component("components/church/site/ChurchBibleYearBody.tsx");
  const Card = component("components/church/site/ChurchBibleYearCard.tsx");
  const Notif = component("components/church/site/ChurchNotificationsCard.tsx");
  const Feat = component("components/church/features/FeaturesView.tsx");
  const Page = component("components/church/site/ChurchExpansionPage.tsx");
  for (const lang of ["en", "fr"]) {
    const c = translations[lang].churchExpansion;
    const body = html(Body, { profile: { id: "p", name: "Grace" }, username: "grace", theme }, lang);
    check(`bible-year page (${lang}): one h1, the intro, a labelled region`, (body.match(/<h1\b/g) || []).length === 1 && body.includes(c.bibleYear.title) && body.includes(c.bibleYear.intro) && /aria-labelledby="church-bible-year-heading"/.test(body));
    check(`bible-year page (${lang}): while loading nothing about a reader is drawn`, !body.includes(c.bibleYear.markDone) && !body.includes(c.bibleYear.start));
    const card = html(Card, { t: translations[lang], href: "/grace/church/bible-year", ...theme }, lang);
    check(`bible-year card (${lang}): the invitation and a real link`, card.includes(c.bibleYear.cardIntro) && card.includes('href="/grace/church/bible-year"') && card.includes(c.bibleYear.open));
    check(`bible-year card (${lang}): in the dashboard preview there is no link`, !html(Card, { t: translations[lang], ...theme }, lang).includes("<a "));
    const notifPrev = html(Notif, { profile: { id: "p", name: "Grace" }, ...theme, preview: true }, lang);
    check(`notification card (${lang}) preview: inert, explains itself, no checkbox`, notifPrev.includes(c.push.card.title) && notifPrev.includes(c.push.card.preview) && !notifPrev.includes("<input"));
    check(`notification card (${lang}): while loading nothing is drawn`, html(Notif, { profile: { id: "p", name: "Grace" }, ...theme }, lang) === "");
    const feat = html(Feat, {}, lang);
    check(`features screen (${lang}): the title and its intro`, feat.includes(c.features.title) && feat.includes(c.features.intro));
    const frame = html(Page, { church: { name: "Grace Church", username: "grace", avatarUrl: null, accent: "#4F46E5" }, data: { mode: "bibleYear", profile: { id: "p", name: "Grace Church" } } }, lang);
    check(`bible-year page frame (${lang}): back link to the church, one h1, footer`, frame.includes('href="/grace"') && (frame.match(/<h1\b/g) || []).length === 1 && frame.includes("<footer"));
  }
}

console.log(`${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
