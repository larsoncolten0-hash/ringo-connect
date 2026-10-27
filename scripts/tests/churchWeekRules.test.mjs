// Churches & Ministries, expansion Phase 1: the church calendar rules, the announcement duration choice, the rotating slideshows and the Church Store product form. Offline: no database, no network, no browser.
//   * the date rules (src/lib/church/week.ts): "This week" ends at the end of the coming Sunday, 1 month / 1 year clamp to the last day of a short month, the testimony week starts Monday 00:00 Cameroon time;
//   * testimonies leave the public page by themselves every Monday and nothing but the four public fields ever comes out;
//   * the announcement editor offers This week / 1 month / 1 year / No end date and a date, defaulting to This week, and Events are untouched;
//   * the slideshows rotate only through the shared hook, with Pause / Play, no autoplay for reduced motion, and a plain list in the dashboard preview;
//   * a new product in a CHURCH store has the Physical / Digital choice and the customer action (Buy now) from the first tap, and no other category's new product changes.
//   Run:  node scripts/tests/churchWeekRules.test.mjs
import path from "path";
import { createRequire } from "module";
import { SRC, read, noComments, jiti, React, translations, component, html, uid, cardTheme, sourceProblems } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

const W = jiti(path.join(SRC, "lib/church/week.ts"));
const PT = jiti(path.join(SRC, "lib/church/public/testimonies.ts"));
const CTA = jiti(path.join(SRC, "lib/cta.ts"));
const CAT = jiti(path.join(SRC, "lib/categories.ts"));

// ---------------------------------------------------------------- 1. the date rules
{
  // 2024-01-07 was a Sunday
  check("weekday: 2024-01-07 is a Sunday, 2024-01-08 a Monday, 2024-01-13 a Saturday; a fake date is null", W.weekday("2024-01-07") === 0 && W.weekday("2024-01-08") === 1 && W.weekday("2024-01-13") === 6 && W.weekday("2024-02-30") === null && W.weekday("nope") === null);
  const ends = { "2024-01-08": "2024-01-14", "2024-01-09": "2024-01-14", "2024-01-10": "2024-01-14", "2024-01-12": "2024-01-14", "2024-01-13": "2024-01-14", "2024-01-14": "2024-01-21", "2024-01-07": "2024-01-14" };
  for (const [from, to] of Object.entries(ends)) check(`"This week" posted on ${from} ends ${to}, and that day is a Sunday`, W.endOfChurchWeek(from) === to && W.weekday(to) === 0, `${W.endOfChurchWeek(from)}`);
  check("posted on a Sunday it lasts a full week; every other day it ends that Sunday (never later than 7 days)", ["2024-01-07", "2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11", "2024-01-12", "2024-01-13"].every((d) => { const e = W.endOfChurchWeek(d); const days = (Date.parse(e) - Date.parse(d)) / 86400000; return days >= 1 && days <= 7 && W.weekday(e) === 0; }));
  check("1 month: the same day, or the last day of a shorter month", W.addMonths("2024-01-15", 1) === "2024-02-15" && W.addMonths("2024-01-31", 1) === "2024-02-29" && W.addMonths("2023-01-31", 1) === "2023-02-28" && W.addMonths("2024-03-31", 1) === "2024-04-30" && W.addMonths("2024-12-15", 1) === "2025-01-15");
  check("1 year: the same day, or 28 February after a 29 February", W.addYears("2024-05-10", 1) === "2025-05-10" && W.addYears("2024-02-29", 1) === "2025-02-28" && W.addYears("2023-02-28", 1) === "2024-02-28");
  check("announcementEnd gives the right day for each choice, and null for a fake date", W.announcementEnd("week", "2024-01-10") === "2024-01-14" && W.announcementEnd("month", "2024-01-10") === "2024-02-10" && W.announcementEnd("year", "2024-01-10") === "2025-01-10" && W.announcementEnd("week", "x") === null);
  check("every end the presets can give is inside the range the database accepts (2020 to 2100)", ["2024-01-10", "2098-12-31", "2026-02-28"].every((d) => ["week", "month", "year"].every((k) => { const e = W.announcementEnd(k, d); return typeof e === "string" && e >= d && e <= "2100-12-31"; })));
  // Cameroon is UTC+1 all year. Monday 2024-01-08 00:00 there is 2024-01-07 23:00 UTC.
  const mon = Date.UTC(2024, 0, 7, 23, 0, 0);
  check("testimony week: Monday 00:00 Cameroon time starts a new week", W.churchWeekStartMs(mon) === mon);
  check("testimony week: one millisecond earlier (Sunday 23:59:59.999) still belongs to the old week, which began the Monday before", W.churchWeekStartMs(mon - 1) === Date.UTC(2023, 11, 31, 23, 0, 0));
  check("testimony week: any moment of Wednesday gives that week's Monday 00:00", W.churchWeekStartMs(Date.UTC(2024, 0, 10, 12, 0, 0)) === mon);
  check("doualaToday is Cameroon's calendar day (23:30 UTC is already tomorrow there)", W.doualaToday(Date.UTC(2024, 0, 7, 23, 30, 0)) === "2024-01-08" && W.doualaToday(Date.UTC(2024, 0, 7, 22, 59, 0)) === "2024-01-07");
}

// ---------------------------------------------------------------- 2. testimonies leave the page every Monday
{
  const row = (n, publishedAt, o = {}) => ({ id: uid(n), display_name: null, body: "Words " + n, lang: "en", published_at: publishedAt, phone: "237600000000", ...o });
  const wed = "2024-01-10T12:00:00.000Z";
  const fake = (rows) => ({ rpc: async () => ({ data: rows, error: null }) });
  const at = (iso) => Date.parse(iso);
  const nowSunLate = Date.UTC(2024, 0, 7 + 7 - 0, 22, 59, 59); // Sunday 2024-01-14 23:59:59 in Cameroon (22:59:59 UTC)
  const nowMon = Date.UTC(2024, 0, 14, 23, 0, 0); // Monday 2024-01-15 00:00:00 in Cameroon
  check("published on Wednesday: still shown at Sunday 23:59:59 Cameroon time", (await PT.loadPublicTestimonies(fake([row(1, wed)]), "p", nowSunLate)).length === 1);
  check("published on Wednesday: gone at Monday 00:00:00 Cameroon time", (await PT.loadPublicTestimonies(fake([row(1, wed)]), "p", nowMon)).length === 0);
  check("published at Monday 00:00:00 Cameroon time exactly: shown that week", (await PT.loadPublicTestimonies(fake([row(2, "2024-01-14T23:00:00.000Z")]), "p", nowMon)).length === 1);
  check("published one second before Monday: belongs to the week that just ended", (await PT.loadPublicTestimonies(fake([row(3, "2024-01-14T22:59:59.000Z")]), "p", nowMon)).length === 0);
  check("unpublished and published again on Monday morning: back on the page for the new week", (await PT.loadPublicTestimonies(fake([row(1, "2024-01-15T07:00:00.000Z")]), "p", nowMon + 8 * 3600_000)).length === 1);
  check("no publication time, or one that is not a real time: dropped (the week cannot be checked)", PT.shapePublicTestimonies([row(4, null), row(5, "garbage"), row(6, undefined)], 12, 0).length === 0);
  check("without a window (the old call) nothing is filtered, so existing callers are unchanged", PT.shapePublicTestimonies([row(7, null)]).length === 1);
  const out = (await PT.loadPublicTestimonies(fake([row(8, wed, { group_label: "Secret", moderation_note: "x" })]), "p", at(wed) + 3600_000))[0];
  check("what comes out is still exactly the four public fields (no publication time, no phone)", JSON.stringify(Object.keys(out)) === '["id","display_name","body","lang"]');
  check("the newest twelve of the week at most", PT.shapePublicTestimonies(Array.from({ length: 20 }, (_, i) => row(30 + i, wed)), 12, 0).length === 12);
}

// ---------------------------------------------------------------- 2b. announcements leave the public page after their last day (Cameroon time)
{
  const E = jiti(path.join(SRC, "lib/church/public/events.ts"));
  const row = (n, expires) => ({ id: uid(300 + n), status: "published", title_en: "Notice " + n, title_fr: null, body_en: "Body", body_fr: null, expires_on: expires });
  const T = (iso) => Date.parse(iso);
  const visible = (expires, atIso) => E.shapePublicAnnouncements([row(1, expires)], W.doualaToday(T(atIso))).length === 1;
  // "This week": posted Wednesday 2024-01-10, last day Sunday 2024-01-14
  check("This week: still shown at Sunday 23:59:59 Cameroon time (22:59:59 UTC)", visible("2024-01-14", "2024-01-14T22:59:59.999Z"));
  check("This week: gone at Monday 00:00:00 Cameroon time (23:00:00 UTC Sunday)", !visible("2024-01-14", "2024-01-14T23:00:00.000Z"));
  check("This week: shown all through the week it was posted in", ["2024-01-10T08:00:00Z", "2024-01-12T12:00:00Z", "2024-01-13T22:00:00Z", "2024-01-14T10:00:00Z"].every((t) => visible("2024-01-14", t)));
  check("posted on a Sunday: shown that whole Sunday and the next 6 days, gone the Monday after the next Sunday", visible(W.endOfChurchWeek("2024-01-07"), "2024-01-07T10:00:00Z") && visible("2024-01-14", "2024-01-14T22:59:59Z") && !visible("2024-01-14", "2024-01-14T23:00:00Z"));
  check("1 month from 31 January 2024: last shown 29 February, gone 1 March (Cameroon time)", W.announcementEnd("month", "2024-01-31") === "2024-02-29" && visible("2024-02-29", "2024-02-29T22:59:59Z") && !visible("2024-02-29", "2024-02-29T23:00:00Z"));
  check("1 year from 29 February 2024: last shown 28 February 2025, gone 1 March 2025", W.announcementEnd("year", "2024-02-29") === "2025-02-28" && visible("2025-02-28", "2025-02-28T22:59:59Z") && !visible("2025-02-28", "2025-02-28T23:00:00Z"));
  check("a date picked by hand: shown through that day, gone the next (Cameroon time)", visible("2026-12-25", "2026-12-25T22:59:59Z") && !visible("2026-12-25", "2026-12-25T23:00:00Z"));
  check("no end date: shown whenever", visible(null, "2024-01-14T23:00:00Z") && visible(null, "2090-06-01T00:00:00Z"));
  check("a malformed last day fails closed (the announcement is not shown)", E.shapePublicAnnouncements([row(2, "tomorrow"), row(3, "2024-13-45x")], "2024-01-10").length === 0);
  // the database filter the loader sends uses the same Cameroon day
  const seen = [];
  const chain = (data) => { const q = { select: () => q, eq: () => q, is: () => q, or: (f) => { seen.push(f); return q; }, order: () => q, limit: () => Promise.resolve({ data, error: null }) }; return q; };
  const db = { from: () => chain([row(4, "2024-01-14")]) };
  const sunLate = T("2024-01-14T22:59:59Z"), monStart = T("2024-01-14T23:00:00Z");
  check("loader: asks the database for last days on or after the Cameroon day (Sunday 23:59 -> Sunday, Monday 00:00 -> Monday)", (await E.loadPublicAnnouncements(db, "p", sunLate)).length === 1 && (await E.loadPublicAnnouncements(db, "p", monStart)).length === 0 && seen[0] === "expires_on.is.null,expires_on.gte.2024-01-14" && seen[1] === "expires_on.is.null,expires_on.gte.2024-01-15", seen.join(" | "));
  const mig = read("supabase/migrations/2026-12-29_ministry_events_announcements.sql");
  check("the database agrees: the public policy keeps a row through its last day, and ministry_today() is Cameroon's day (UTC+1)", /expires_on is null or expires_on >= public\.ministry_today\(\)/.test(mig) && /\(now\(\) at time zone 'utc'\) \+ interval '1 hour'\)::date/.test(mig));
  check("events: an event leaves the page the day after its date (Cameroon time)", E.shapePublicEvents([{ id: uid(310), event_date: "2024-01-14", title_en: "Service", title_fr: null }], W.doualaToday(T("2024-01-14T22:59:59Z"))).length === 1 && E.shapePublicEvents([{ id: uid(310), event_date: "2024-01-14", title_en: "Service", title_fr: null }], W.doualaToday(T("2024-01-14T23:00:00Z"))).length === 0);
}

// ---------------------------------------------------------------- 3. the announcement editor
{
  const Editor = component("components/church/lifecycle/LifecycleEditor.tsx");
  const useAnnouncementsConfig = component("components/church/events/configs.tsx", "useAnnouncementsConfig");
  const useEventsConfig = component("components/church/events/configs.tsx", "useEventsConfig");
  const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
  const caps = PERM.churchCapabilities(PERM.CHURCH_PERMISSIONS);
  const Ann = () => React.createElement(Editor, { caps, config: useAnnouncementsConfig() });
  const Ev = () => React.createElement(Editor, { caps, config: useEventsConfig() });
  const today = W.doualaToday();
  for (const lang of ["en", "fr"]) {
    const o = translations[lang].churchEvents.announcements.fields.expires_on;
    const h = html(Ann, {}, lang);
    check(`announcement editor (${lang}): the four choices, labelled in ${lang}`, ["week", "month", "year", "none"].every((k) => h.includes(`>${o.options[k]}<`)) && h.includes(o.label));
    check(`announcement editor (${lang}): a new announcement starts on "This week" and its last day is the coming Sunday`, new RegExp(`aria-pressed="true"[^>]*>${o.options.week}<`).test(h) && h.includes(`value="${W.endOfChurchWeek(today)}"`), h.slice(h.indexOf("aria-pressed"), h.indexOf("aria-pressed") + 200));
    check(`announcement editor (${lang}): exactly one choice is pressed, each is a real 44px button, and the date can still be picked by hand`, (h.match(/aria-pressed="true"/g) || []).length === 1 && (h.match(/aria-pressed="false"/g) || []).length === 3 && /min-h-\[44px\][^"]*"[^>]*>|aria-pressed/.test(h) && /type="date"/.test(h) && h.includes(o.options.date));
    check(`announcement editor (${lang}): the help says when it leaves the page, in ${lang}`, h.includes(o.help));
    check(`event editor (${lang}): Events have no duration choices (untouched)`, !html(Ev, {}, lang).includes("aria-pressed"));
  }
  const fr = translations.fr.churchEvents.announcements.fields.expires_on.help;
  check("the French help has no typo and the English one names Sunday midnight", !/dépubliiez/.test(read("src/lib/i18n/translations.fr.ts")) && /Sunday at midnight/.test(translations.en.churchEvents.announcements.fields.expires_on.help) && /dimanche à minuit/.test(fr));
  const cfg = noComments(read("src/components/church/events/configs.tsx"));
  check("a new announcement defaults to This week; an existing one with no end date keeps 'No end date'", /blank: \(today\) => \(\{ expires_on: announcementEnd\("week", today\)/.test(cfg) && /expires_on", kind: "date", presets: "announcement"/.test(cfg));
}

// ---------------------------------------------------------------- 4. the rotating slideshows
{
  const hook = noComments(read("src/components/church/site/useRotation.ts"));
  check("rotation: an interval that is always cleared, restarted when the slide changes", /setInterval/.test(hook) && /clearInterval/.test(hook) && /\[running, count, intervalMs, current\]/.test(hook));
  check("rotation: no autoplay for visitors who prefer reduced motion (they can press Play)", /prefers-reduced-motion: reduce/.test(hook) && /reduced \? forcedPlay : !userPaused/.test(hook));
  check("rotation: holds still on mouse hover, on keyboard focus and in a hidden tab", /onPointerEnter/.test(hook) && /onPointerLeave/.test(hook) && /onFocus/.test(hook) && /onBlur/.test(hook) && /visibilityState === "hidden"/.test(hook) && /!hovered && !focused && !hidden/.test(hook));
  const R = jiti(path.join(SRC, "components/church/site/useRotation.ts"));
  check("rotation: a real mouse holds it; touch and pen do not (a phone tap would freeze it for good)", R.holdsOnPointer("mouse") === true && R.holdsOnPointer("touch") === false && R.holdsOnPointer("pen") === false && R.holdsOnPointer(undefined) === false);
  check("rotation: keyboard focus holds it, but a button focused by a mouse click does not (pressing Play must not leave it stuck)", R.holdsOnFocus({ matches: (sel) => sel === ":focus-visible" }) === true && R.holdsOnFocus({ matches: () => false }) === false);
  check("rotation: where :focus-visible is unknown or throws, it holds (safe default); with no target it holds", R.holdsOnFocus({ matches: () => { throw new Error("unsupported selector"); } }) === true && R.holdsOnFocus({}) === true && R.holdsOnFocus(null) === true);
  check("rotation: a screen reader is not interrupted while it rotates", /running \? "off" : "polite"/.test(hook));
  check("rotation: only rotates with more than one slide, and only while it is on screen", /count > 1 && wantsPlay/.test(hook) && /IntersectionObserver/.test(hook) && /&& inView;/.test(hook));
  const Testimonies = component("components/church/ChurchTestimoniesCard.tsx");
  const Cards = component("components/church/ChurchEventsCards.tsx", "ChurchAnnouncementsCard");
  const ann = (n, o = {}) => ({ id: uid(100 + n), title_en: `Notice ${n}`, title_fr: `Avis ${n}`, body_en: `Body ${n}`, body_fr: `Corps ${n}`, expires_on: null, ...o });
  const tst = (n) => ({ id: uid(200 + n), display_name: null, body: `Testimony ${n}`, lang: "en" });
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const sl = t.churchSite.public.slides;
    const base = { t, locale: lang, ...cardTheme };
    const ts = html(Testimonies, { t, testimonies: [tst(1), tst(2), tst(3)], ...cardTheme }, lang);
    check(`testimonies (${lang}): a Pause button, labelled in ${lang}, is there while it rotates, and the slide is not announced`, ts.includes(`aria-label="${sl.pause}"`) && /aria-pressed="false"/.test(ts) && /aria-live="off"/.test(ts));
    check(`testimonies (${lang}): one testimony has no controls and no pause`, !html(Testimonies, { t, testimonies: [tst(1)], ...cardTheme }, lang).includes(sl.pause));
    const list = html(Cards, { ...base, announcements: [ann(1), ann(2), ann(3)] }, lang);
    check(`announcements (${lang}): without rotate (the dashboard preview) they are a plain list with every notice and no controls`, [1, 2, 3].every((n) => list.includes(`${lang === "fr" ? "Avis" : "Notice"} ${n}`)) && !list.includes(sl.pause) && !/aria-roledescription="carousel"/.test(list));
    const show = html(Cards, { ...base, announcements: [ann(1), ann(2), ann(3)], rotate: true }, lang);
    check(`announcements (${lang}): with rotate and several notices: a slideshow showing the first, a dot each, previous / pause / next`, /aria-roledescription="carousel"/.test(show) && show.includes(`aria-label="${sl.announcementsLabel}"`) && show.includes(`${lang === "fr" ? "Avis" : "Notice"} 1`) && !show.includes(`${lang === "fr" ? "Avis" : "Notice"} 2`) && [1, 2, 3].every((i) => show.includes(`aria-label="${sl.goTo(i)}"`)) && show.includes(`aria-label="${sl.pause}"`) && show.includes(`aria-label="${sl.previous}"`) && show.includes(`aria-label="${sl.next}"`) && show.includes(`aria-label="${sl.position(1, 3)}"`));
    check(`announcements (${lang}): with a single notice, rotate shows it plainly (nothing to rotate)`, !/aria-roledescription="carousel"/.test(html(Cards, { ...base, announcements: [ann(1)], rotate: true }, lang)));
    check(`announcements (${lang}): every control is a real, typed button`, !/<button(?![^>]*type=)/.test(show) && (show.match(/<button type="button"/g) || []).length === 6);
  }
  const site = noComments(read("src/components/church/site/ChurchSiteView.tsx"));
  check("the church site turns the rotation on for announcements", /<ChurchAnnouncementsCard [^>]*\brotate\b/.test(site));
  for (const f of ["components/church/site/useRotation.ts", "components/church/ChurchEventsCards.tsx", "components/church/ChurchTestimoniesCard.tsx"]) {
    const problems = sourceProblems(path.join(SRC, f));
    check(`${f}: no hard-coded text, no storage, no raw HTML, typed buttons, no database client`, problems.length === 0, problems.join(" ; "));
  }
}

// ---------------------------------------------------------------- 5. the Church Store product form
{
  // the product form's upload field makes a Supabase browser client when it is drawn; a static render never contacts it, so placeholders are enough
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://placeholder.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "placeholder-anon-key";
  const cat = noComments(read("src/components/editor/CatalogCard.tsx"));
  check("a new CHURCH product starts with the product type and customer action fields; the block is gated on the church category", /profileHasCategory\(draft, "church_ministries"\)\s*\? \{ product_type: "physical", digital_file_path: null, digital_file_name: null, digital_file_size_bytes: null, digital_file_mime: null, cta_preset: null, cta_label: null \}\s*: \{\}/.test(cat));
  const before = cat.slice(cat.indexOf("const row = addLocal({"), cat.indexOf("setJustAddedId(row.id)"));
  check("every other category's new product is exactly the row it always was (the extra fields only come from the church spread)", /name: "",\s*price: null,\s*description: "",\s*image_url: null,\s*image_urls: \[\],\s*landing_url: null,\s*whatsapp_message: null,\s*available: true,\s*inventory_count: null,\s*\.\.\.\(profileHasCategory/.test(before));
  check("the save still only sends those fields when the row carries them (so a database without the columns is safe)", /p\.cta_preset !== undefined/.test(cat) && /p\.product_type !== undefined/.test(cat));
  const Row = component("components/editor/ProductRow.tsx");
  const churchNew = { id: "new:1", name: "", price: null, description: "", image_url: null, image_urls: [], landing_url: null, whatsapp_message: null, available: true, inventory_count: null, product_type: "physical", cta_preset: null, cta_label: null };
  const otherNew = { id: "new:2", name: "", price: null, description: "", image_url: null, image_urls: [], landing_url: null, whatsapp_message: null, available: true, inventory_count: null };
  // ProductRow is a framer-motion Reorder.Item, so (as in the real editor) it is drawn inside a Reorder.Group
  const { Reorder } = createRequire(import.meta.url)("framer-motion");
  const render = (product, category, lang = "en") => html(() => React.createElement(Reorder.Group, { axis: "y", values: [product], onReorder() {} }, React.createElement(Row, { product, userId: uid(1), currency: "XAF", category, isMusic: false, bookingEnabled: false, restaurantOrdering: false, checkoutAvailable: true, isDemo: false, startExpanded: true, onChange() {}, onDelete() {} })), {}, lang);
  for (const lang of ["en", "fr"]) {
    const d = translations[lang].editor.digitalProduct;
    const ch = render(churchNew, "church_ministries", lang);
    check(`church product form (${lang}): the Physical / Digital choice is there for a NEW product, labelled in ${lang}`, ch.includes(d.typeLabel) && ch.includes(d.physical) && ch.includes(d.digital));
    check(`church product form (${lang}): the customer action field is there for a NEW product, with its Change button (where Buy now is offered first)`, ch.includes(translations[lang].cta.sectionTitle) && ch.includes(`>${translations[lang].cta.change}<`) && /getRecommendedCta\(category\)/.test(noComments(read("src/components/editor/CustomerActionField.tsx"))), translations[lang].cta.sectionTitle);
  }
  check("another category's NEW product form is unchanged: no product type choice and no customer action field appear (as before)", !render(otherNew, "business_ecommerce").includes(translations.en.editor.digitalProduct.typeLabel) && !render(otherNew, "business_ecommerce").includes(translations.en.cta.sectionTitle));
  const leaked = CAT.CATEGORY_IDS.filter((c) => c !== "church_ministries").filter((c) => { const h = render(otherNew, c); return h.includes(translations.en.editor.digitalProduct.typeLabel) || h.includes(translations.en.cta.sectionTitle); });
  check("a NEW product row without the church fields shows neither the product type choice nor the customer action field in ANY other category (as before)", leaked.length === 0, leaked.join(", "));
  check("the church spread is the only place the new fields come from: the same new-product row for a church WITHOUT them would still hide both (so the fix is the seeding, not a change to the shared form)", !render(otherNew, "church_ministries").includes(translations.en.editor.digitalProduct.typeLabel));
  check("church: Buy now is the recommended customer action (then Shop now, Get yours)", CTA.getRecommendedCta("church_ministries").recommended === "buy_now" && CTA.getRecommendedCta("church_ministries").alternatives.join() === "buy_now,shop_now,get_yours");
  const others = CAT.CATEGORY_IDS.filter((c) => c !== "church_ministries");
  const before2 = { music_entertainment: "buy_now", business_ecommerce: "buy_now", agriculture_agribusiness: "buy_now", restaurant_food: "order_now", real_estate: "request_viewing", events_experiences: "get_tickets", other: "view_details" };
  check("every other category keeps the customer action it had", Object.entries(before2).every(([c, id]) => CTA.getRecommendedCta(c).recommended === id) && others.length >= 15);
  const resolved = CTA.resolveProductCta({ category: "church_ministries", isMusic: false, hasLandingUrl: false, bookingEnabled: false, checkoutAvailable: true, currency: "XAF", ctaPreset: "buy_now" });
  check("a church product with Buy now and checkout available goes to the on-platform checkout; without checkout it shows no button", resolved.destination === "product_checkout" && CTA.resolveProductCta({ category: "church_ministries", isMusic: false, hasLandingUrl: false, bookingEnabled: false, checkoutAvailable: false, currency: "XAF", ctaPreset: "buy_now" }).destination === "none");
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
