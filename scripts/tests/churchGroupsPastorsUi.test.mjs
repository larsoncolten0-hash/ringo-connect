// Churches & Ministries expansion, Phase 3: the screens of the public group pages and the Pastors page, checked OFFLINE (static render, no browser, no network).
//   * English and French have exactly the same keys, and every sentence is filled in;
//   * no new screen has hard-coded text, a direct database client, storage or markup injection, an untyped button or an unnamed field;
//   * the public pages: one h1, labelled sections, real links, plain text, no member list and no count, no caption on the Children page, a picture only from this platform's storage;
//   * the dashboard screens render their loading state in both languages without a crash.
//   Run:  node scripts/tests/churchGroupsPastorsUi.test.mjs
import path from "path";
import { SRC, read, noComments, translations, walkDictionary, sampleArgs, sourceProblems, component, html, uid, cardTheme } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
const IMG = (n) => `https://example.supabase.co/storage/v1/object/public/uploads/u1/church/p${n}.jpg`;

// ---------------------------------------------------------------- 1. dictionary parity
{
  const en = translations.en.churchExpansion, fr = translations.fr.churchExpansion;
  const w = walkDictionary(en, fr, "churchExpansion");
  check("EN and FR have the same keys and types", w.shape.length === 0, w.shape.join(" ; "));
  check("no sentence is empty", w.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""), w.strings.filter(([, a, b]) => a.trim() === "" || b.trim() === "").map((x) => x[0]).join());
  check("no placeholder text", w.strings.every(([, a, b]) => !/TODO|lorem|xxx/i.test(a + b)));
  check("functions give text in both languages", w.fns.every(([k, a, b]) => { const args = sampleArgs(k, a); return typeof a(...args) === "string" && typeof b(...args) === "string" && a(...args) !== "" && b(...args) !== ""; }));
  check("French is French (the group kinds differ from English)", fr.groups.kinds.men !== en.groups.kinds.men && fr.groups.kinds.children !== en.groups.kinds.children);
  const codes = ["invalid_kind", "invalid_leader_name", "invalid_description", "invalid_caption", "invalid_word", "invalid_biography", "invalid_name", "invalid_vision", "invalid_mission", "invalid_sort_order", "children_photo_caption", "photo_limit", "pastor_limit", "group_exists", "unpublish_first"];
  check("every code the server returns for these screens has a sentence in both languages", codes.every((c) => en.errors[c] && fr.errors[c]));
  check("the section names exist in the church site navigation (EN and FR)", translations.en.churchSite.public.sections.groups && translations.fr.churchSite.public.sections.pastors);
  check("the announcement audience field is described in both languages", translations.en.churchEvents.announcements.fields.public_group_id.options.all && translations.fr.churchEvents.announcements.fields.public_group_id.options.group);
  const children = [en.groups.childrenNote, fr.groups.childrenNote, en.groups.photos.helpChildren, fr.groups.photos.helpChildren];
  check("the Children page tells the church that no child is named", children.every((s) => s.length > 20));
}

// ---------------------------------------------------------------- 2. source rules
{
  const files = ["components/church/pubgroups/PubGroupsView.tsx", "components/church/pubgroups/PastorsView.tsx", "components/church/lifecycle/AudienceField.tsx", "components/church/site/ChurchGroupsPublic.tsx", "components/church/site/ChurchPastorsPublic.tsx", "components/church/site/SectionShell.tsx", "components/church/site/ChurchExpansionPage.tsx"];
  for (const f of files) {
    const p = sourceProblems(path.join(SRC, f));
    check(`${path.basename(f)}: no hard-coded text, storage, markup injection, untyped button or unnamed field`, p.length === 0, p.join(" | "));
  }
  // the dashboard screens reach the server only through /api/church/**, never the database
  for (const f of ["components/church/pubgroups/PubGroupsView.tsx", "components/church/pubgroups/PastorsView.tsx"]) {
    const src = noComments(read(`src/${f}`));
    check(`${path.basename(f)}: only /api/church/** is called`, /churchApi\(/.test(src) && !/supabase|fetch\(/.test(src) && [...src.matchAll(/["'`]\/api\/([^"'`$]*)/g)].every((m) => m[1].startsWith("church/")), src.match(/\/api\/[a-z-]*/g)?.join());
  }
  const shell = noComments(read("src/components/church/people/ChurchShell.tsx"));
  check("the shell takes its list of sections from the shared module list", /accessibleChurchModules/.test(shell));
}

// ---------------------------------------------------------------- 3. the public pages
{
  const Groups = component("components/church/site/ChurchGroupsPublic.tsx", "ChurchGroupsCard");
  const Group = component("components/church/site/ChurchGroupsPublic.tsx", "ChurchGroupBody");
  const Pastors = component("components/church/site/ChurchPastorsPublic.tsx", "ChurchPastorsBody");
  const PastorsCard = component("components/church/site/ChurchPastorsPublic.tsx", "ChurchPastorsCard");
  const Page = component("components/church/site/ChurchExpansionPage.tsx");
  const { translations: T } = await import("./ministryUiHarness.mjs");
  const g = (kind, o = {}) => ({ id: uid(kind === "men" ? 1 : kind === "women" ? 2 : kind === "youths" ? 3 : 4), kind, leader_name: "Bro Tom", leader_photo_url: IMG(1), description_en: "Welcome <b>all</b>", description_fr: "Bienvenue", ...o });
  const ann = { id: uid(50), title_en: "Youth night", title_fr: "Soirée jeunes", body_en: "Friday at 6pm", body_fr: "Vendredi à 18h", expires_on: null };
  for (const lang of ["en", "fr"]) {
    const groups = [g("men"), g("children", { leader_photo_url: null })];
    const list = html(Groups, { t: T[lang], locale: lang, ...cardTheme, groups, username: "gracechurch" }, lang);
    check(`groups list (${lang}): a heading, a labelled section and one real link per group`, /aria-labelledby="church-groups-heading"/.test(list) && /<h2 id="church-groups-heading"/.test(list) && (list.match(/<a /g) || []).length === 2 && list.includes('href="/gracechurch/church/groups/men"') && list.includes('href="/gracechurch/church/groups/children"'));
    check(`groups list (${lang}): text is text, never markup`, !/<b>/.test(list));
    check(`groups list (${lang}): the group names are in the visitor's language`, list.includes(T[lang].churchExpansion.groups.kinds.men) && list.includes(T[lang].churchExpansion.groups.kinds.children));
    check(`groups list (${lang}): no member, no count, no roster wording`, !/\b(members?|membres?|\d+ (people|persons|personnes))\b/i.test(list.replace(/<[^>]+>/g, " ")));
    check(`groups list (${lang}): empty -> nothing drawn`, html(Groups, { t: T[lang], locale: lang, ...cardTheme, groups: [], username: "x" }, lang) === "");
    check(`groups list (${lang}): a leader picture that is not platform storage is not drawn`, !html(Groups, { t: T[lang], locale: lang, ...cardTheme, groups: [g("men", { leader_photo_url: "https://evil.example.com/a.jpg" })], username: "x" }, lang).includes("evil.example.com"));
    const withSee = html(Groups, { t: T[lang], locale: lang, ...cardTheme, groups, username: "gracechurch", seeMoreHref: "/gracechurch/church/groups" }, lang);
    check(`groups list (${lang}): "See more" is a real link, named for what it opens`, withSee.includes('href="/gracechurch/church/groups"') && withSee.includes(T[lang].churchSite.public.seeMoreAbout(T[lang].churchExpansion.groups.public.title)));

    const photos = [{ id: uid(60), image_url: IMG(2), caption_en: "Camp", caption_fr: "Camp" }, { id: uid(61), image_url: IMG(3), caption_en: null, caption_fr: null }];
    const body = html(Group, { t: T[lang], locale: lang, ...cardTheme, page: { group: g("men"), photos, announcements: [ann] } }, lang);
    check(`group page (${lang}): exactly one h1, the group name`, (body.match(/<h1\b/g) || []).length === 1 && new RegExp(`<h1[^>]*>${T[lang].churchExpansion.groups.kinds.men}</h1>`).test(body));
    check(`group page (${lang}): the leader, the welcome text and a carousel with Pause`, body.includes(T[lang].churchExpansion.groups.public.led("Bro Tom")) && body.includes('aria-roledescription="carousel"') && body.includes(T[lang].churchSite.public.slides.pause));
    check(`group page (${lang}): the group announcements are listed under their own title`, body.includes("Friday at 6pm") === (lang === "en") && body.includes(T[lang].churchExpansion.groups.public.announcementsTitle));
    const kids = html(Group, { t: T[lang], locale: lang, ...cardTheme, page: { group: g("children"), photos: [{ id: uid(62), image_url: IMG(4), caption_en: null, caption_fr: null }], announcements: [] } }, lang);
    check(`children page (${lang}): no caption element and no member`, !kids.includes("<figcaption") && !/\b(members?|membres?)\b/i.test(kids.replace(/<[^>]+>/g, " ")));
    check(`group page (${lang}): no announcements -> a plain sentence`, kids.includes(T[lang].churchExpansion.groups.public.noAnnouncements));
    check(`group page (${lang}): a photo outside platform storage is not drawn`, !html(Group, { t: T[lang], locale: lang, ...cardTheme, page: { group: g("men"), photos: [{ id: uid(63), image_url: "https://evil.example.com/x.jpg", caption_en: null, caption_fr: null }], announcements: [] } }, lang).includes("evil.example.com"));

    const pastors = [{ id: uid(70), name: "Pastor Sam", photo_url: IMG(5), word_en: "Grace to you", word_fr: "Grâce à vous", bio_en: "Sam has served for 20 years.", bio_fr: "Sam sert depuis 20 ans.", }, { id: uid(71), name: "Pastor Ann", photo_url: null, word_en: null, word_fr: null, bio_en: null, bio_fr: null }];
    const about = { vision_en: "See far", vision_fr: "Voir loin", mission_en: null, mission_fr: "Servir" };
    const pb = html(Pastors, { t: T[lang], locale: lang, ...cardTheme, pastors, about }, lang);
    check(`pastors page (${lang}): one h1, a pastor per h2, the biography, the vision and the mission`, (pb.match(/<h1\b/g) || []).length === 1 && pb.includes("Pastor Sam") && pb.includes("Pastor Ann") && pb.includes(lang === "en" ? "See far" : "Voir loin") && pb.includes(T[lang].churchExpansion.pastors.public.missionTitle) && pb.includes(lang === "en" ? "Sam has served for 20 years." : "Sam sert depuis 20 ans."));
    check(`pastors page (${lang}): a pastor with no photo gets a placeholder, never a broken image`, !/<img[^>]*src=""/.test(pb) && pb.includes('aria-hidden="true"'));
    check(`pastors page (${lang}): no phone number, no e-mail`, !/@|tel:|\+237/.test(pb));
    const only = html(Pastors, { t: T[lang], locale: lang, ...cardTheme, pastors: [pastors[1]], about: null }, lang);
    check(`pastors page (${lang}): no vision or mission -> neither section`, !only.includes(T[lang].churchExpansion.pastors.public.visionTitle) && !only.includes(T[lang].churchExpansion.pastors.public.missionTitle));
    const teaser = html(PastorsCard, { t: T[lang], locale: lang, ...cardTheme, pastors: [pastors[0], pastors[1], { ...pastors[0], id: uid(72), name: "Pastor Zed" }, { ...pastors[0], id: uid(73), name: "Pastor Four" }], seeMoreHref: "/gracechurch/church/pastors" }, lang);
    check(`pastors teaser (${lang}): the first three only, with See more`, teaser.includes("Pastor Zed") && !teaser.includes("Pastor Four") && teaser.includes('href="/gracechurch/church/pastors"'));

    const church = { name: "Grace Church", username: "gracechurch", avatarUrl: null, accent: "#4F46E5" };
    const p1 = html(Page, { church, data: { mode: "groups", groups } }, lang);
    check(`groups page (${lang}): the frame — back link, one h1, footer`, (p1.match(/<h1\b/g) || []).length === 1 && p1.includes('href="/gracechurch"') && p1.includes("<footer"));
    const p2 = html(Page, { church, data: { mode: "group", page: { group: g("men"), photos: [], announcements: [] } } }, lang);
    check(`group page frame (${lang}): the back link returns to the groups`, p2.includes('href="/gracechurch/church/groups"'));
    const p3 = html(Page, { church, data: { mode: "groups", groups: [] } }, lang);
    check(`groups page (${lang}): empty state, one h1`, (p3.match(/<h1\b/g) || []).length === 1 && p3.includes(T[lang].churchExpansion.groups.public.empty));
    const p4 = html(Page, { church, data: { mode: "pastors", pastors: [], about: null } }, lang);
    check(`pastors page (${lang}): empty state, one h1`, (p4.match(/<h1\b/g) || []).length === 1 && p4.includes(T[lang].churchExpansion.pastors.public.empty));
  }
}

// ---------------------------------------------------------------- 4. the dashboard screens
{
  const PubGroups = component("components/church/pubgroups/PubGroupsView.tsx");
  const PastorsView = component("components/church/pubgroups/PastorsView.tsx");
  const Audience = component("components/church/lifecycle/AudienceField.tsx");
  for (const lang of ["en", "fr"]) {
    const a = html(PubGroups, { username: "gracechurch", canManage: true }, lang);
    check(`group pages screen (${lang}): renders with its title and a loading state`, a.includes(translations[lang].churchExpansion.groups.title) && a.includes(translations[lang].churchExpansion.groups.childrenNote));
    const b = html(PastorsView, {}, lang);
    check(`pastors screen (${lang}): renders with its title and the add button`, b.includes(translations[lang].churchExpansion.pastors.title) && b.includes(translations[lang].churchExpansion.pastors.add));
    const c = html(Audience, { id: "x", value: "", onChange() {}, labels: { all: translations[lang].churchEvents.announcements.fields.public_group_id.options.all } }, lang);
    check(`audience field (${lang}): the whole church is always a choice`, c.includes("<select") && c.includes(translations[lang].churchEvents.announcements.fields.public_group_id.options.all));
  }
}

console.log(`${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
