// Phase 3B: the generic profile's single primary hero action (lib/heroAction.ts), its rendering, and the new
// Connect placement. The resolver is pure and tested directly; React wiring is checked on the source with
// comments stripped (there is no React renderer in this repo).
//   Run:  node scripts/tests/heroAction.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import crypto from "crypto";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${String(e.message).split("\n").join("\n    ")}`);
  }
}
const raw = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const src = (rel) => strip(raw(rel));
const count = (s, re) => (s.match(re) || []).length;
const sha = (rel) => crypto.createHash("sha256").update(raw(rel)).digest("hex");

const H = jiti(path.join(SRC, "lib/heroAction.ts"));
const { getBookingConfig, CATEGORIES } = jiti(path.join(SRC, "lib/categories.ts"));
const { translations: TR } = jiti(path.join(SRC, "lib/i18n/translations.ts"));

const WA = "+237 677 12 34 56";
const PHONE = "+237 699 00 11 22";
const base = (extra = {}) => ({ username: "ada", category: "other", name: "Ada", ...extra });
const link = (url, extra = {}) => ({ id: "l" + Math.random().toString(36).slice(2, 6), url, title: "T", sort_order: 0, ...extra });
const kind = (p, locale = "en") => H.resolveHeroAction(p, locale).primary.kind;

// ------------------------------------------------------------------ the contact / action matrix
await test("only WhatsApp -> WhatsApp is the primary; Call and Save are quiet shortcuts", () => {
  const r = H.resolveHeroAction(base({ whatsapp_number: WA }), "en");
  assert.equal(r.primary.kind, "whatsapp");
  assert.deepEqual(r.secondary, ["call", "save"]);
  assert.equal(r.callNumber, WA);
});
await test("only a phone -> Call is the primary (it was a dead hero before); WhatsApp is not offered", () => {
  const r = H.resolveHeroAction(base({ about_phone: PHONE }), "en");
  assert.equal(r.primary.kind, "phone");
  assert.equal(r.primary.number, PHONE);
  assert.deepEqual(r.secondary, ["save"], "Call would repeat the primary");
});
await test("only an e-mail -> E-mail is the primary and nothing else is offered", () => {
  const r = H.resolveHeroAction(base({ about_email: "ada@example.com" }), "en");
  assert.equal(r.primary.kind, "email");
  assert.equal(r.primary.address, "ada@example.com");
  assert.deepEqual(r.secondary, []);
});
await test("only a meaningful link -> the first link is the primary, labelled Website for http(s) and Link otherwise", () => {
  const a = H.resolveHeroAction(base({ links: [link("https://shop.example.com/x", { title: "Shop", id: "L1" })] }), "en");
  assert.equal(a.primary.kind, "link");
  assert.equal(a.primary.href, "https://shop.example.com/x");
  assert.equal(a.primary.label, "website");
  assert.equal(a.primary.title, "Shop");
  assert.equal(a.primary.id, "L1");
  const bare = H.resolveHeroAction(base({ links: [link("example.com")] }), "en");
  assert.equal(bare.primary.href, "https://example.com", "a bare address gets https:// exactly as in the links list");
  assert.equal(bare.primary.label, "website");
  const other = H.resolveHeroAction(base({ links: [link("tel:+237677123456")] }), "en");
  assert.equal(other.primary.kind, "link");
  assert.equal(other.primary.label, "link");
});
await test("only social links, or nothing actionable -> Connect is the primary (the fallback)", () => {
  const social = H.resolveHeroAction(base({ social_links: [{ platform: "instagram", url: "https://instagram.com/ada" }] }), "en");
  assert.equal(social.primary.kind, "connect");
  assert.deepEqual(social.secondary, []);
  assert.equal(kind(base()), "connect");
  assert.equal(kind({}), "connect");
  assert.equal(kind(null), "connect");
});
await test("booking wins over everything else; the rest become quiet shortcuts", () => {
  const all = { bookings_enabled: true, whatsapp_number: WA, about_phone: PHONE, about_email: "a@b.co", links: [link("https://x.co")] };
  const r = H.resolveHeroAction(base(all), "en");
  assert.equal(r.primary.kind, "booking");
  assert.equal(r.primary.href, "/ada/book");
  assert.deepEqual(r.secondary, ["whatsapp", "call", "save"]);
  assert.equal(r.callNumber, PHONE, "the About phone is what Call dials when there is one");
  for (const only of [{ whatsapp_number: WA }, { about_phone: PHONE }, { about_email: "a@b.co" }, { links: [link("https://x.co")] }]) {
    assert.equal(kind(base({ bookings_enabled: true, ...only })), "booking");
  }
  assert.equal(kind(base({ bookings_enabled: true })), "booking", "booking alone is enough");
});
await test("bookings switched off, or no username to link to, never produce a booking action", () => {
  assert.equal(kind(base({ bookings_enabled: false, whatsapp_number: WA })), "whatsapp");
  assert.equal(kind(base({ bookings_enabled: null, whatsapp_number: WA })), "whatsapp");
  assert.equal(kind({ bookings_enabled: true, username: "  ", whatsapp_number: WA }), "whatsapp");
});
await test("precedence: WhatsApp > phone > e-mail > link > Connect", () => {
  const l = [link("https://x.co")];
  assert.equal(kind(base({ whatsapp_number: WA, about_phone: PHONE, about_email: "a@b.co", links: l })), "whatsapp");
  assert.equal(kind(base({ about_phone: PHONE, about_email: "a@b.co", links: l })), "phone");
  assert.equal(kind(base({ about_email: "a@b.co", links: l })), "email");
  assert.equal(kind(base({ links: l })), "link");
  assert.equal(kind(base()), "connect");
});
await test("WhatsApp + a different phone: the primary is WhatsApp and Call dials the phone; same number still gets one Call", () => {
  const r = H.resolveHeroAction(base({ whatsapp_number: WA, about_phone: PHONE }), "en");
  assert.equal(r.primary.kind, "whatsapp");
  assert.deepEqual(r.secondary, ["call", "save"]);
  assert.equal(r.callNumber, PHONE);
});
await test("phone + e-mail -> Call primary; e-mail is not duplicated as a hero shortcut", () => {
  const r = H.resolveHeroAction(base({ about_phone: PHONE, about_email: "a@b.co" }), "en");
  assert.equal(r.primary.kind, "phone");
  assert.deepEqual(r.secondary, ["save"]);
});
await test("e-mail + a link -> E-mail primary (the link stays in the links list)", () => {
  assert.equal(kind(base({ about_email: "a@b.co", links: [link("https://x.co")] })), "email");
});

// ------------------------------------------------------------------ invalid / placeholder data never becomes a button
await test("blank, whitespace and placeholder WhatsApp numbers never become a primary or a shortcut", () => {
  for (const bad of ["", "   ", "+", "+237", "abc", "0000000", "000 000 000", "12345", "1234567890123456", null, undefined, 677123456, {}]) {
    const r = H.resolveHeroAction(base({ whatsapp_number: bad }), "en");
    assert.equal(r.primary.kind, "connect", JSON.stringify(bad));
    assert.deepEqual(r.secondary, [], JSON.stringify(bad));
  }
  assert.equal(H.isUsablePhone("677123456"), true);
  assert.equal(H.isUsablePhone("+237 677 12 34 56"), true);
  assert.equal(H.isUsablePhone("(237) 677-123-456"), true);
});
await test("blank / placeholder phones fall through to the next real option", () => {
  for (const bad of ["", "  ", "+", "0", "abc", "0000000"]) {
    const r = H.resolveHeroAction(base({ about_phone: bad, about_email: "a@b.co" }), "en");
    assert.equal(r.primary.kind, "email", JSON.stringify(bad));
    assert.ok(!r.secondary.includes("save") && !r.secondary.includes("call"));
  }
});
await test("invalid e-mails (blank, no domain, spaces, mailto: header tricks) never become a primary", () => {
  for (const bad of ["", "  ", "ada", "ada@", "@example.com", "ada@example", "ada @example.com", "ada@example.com?cc=x@y.co", "ada@example.com&bcc=x@y.co", "a@b.co#frag", null, undefined, 5]) {
    assert.equal(kind(base({ about_email: bad })), "connect", JSON.stringify(bad));
  }
  assert.equal(H.isUsableEmail(" ada@example.com "), true);
  assert.equal(H.resolveHeroAction(base({ about_email: " ada@example.com " }), "en").primary.address, "ada@example.com");
});
await test("unsafe, empty or placeholder links never become a primary; a real link after them does", () => {
  const bad = ["", "https://", "http://", "javascript:alert(1)", "java\tscript:alert(1)", "​javascript:alert(1)", "data:text/html,x", "vbscript:x", "hello world", "mailto:"].map((u, i) => link(u, { sort_order: i }));
  assert.equal(kind(base({ links: bad })), "connect");
  const mixed = [...bad, link("https://real.example.com", { sort_order: 99, title: "Real", id: "R" })];
  const r = H.resolveHeroAction(base({ links: mixed }), "en");
  assert.equal(r.primary.kind, "link");
  assert.equal(r.primary.id, "R");
  assert.equal(r.primary.href, "https://real.example.com");
});
await test("the first link follows the owner's order (sort_order), not the array order", () => {
  const r = H.resolveHeroAction(base({ links: [link("https://b.co", { sort_order: 2, id: "B" }), link("https://a.co", { sort_order: 1, id: "A" })] }), "en");
  assert.equal(r.primary.id, "A");
});
await test("a link saved without a title is still offered (its address is the label text)", () => {
  const r = H.resolveHeroAction(base({ links: [link("https://www.example.com/shop/", { title: "" })] }), "en");
  assert.equal(r.primary.kind, "link");
  assert.equal(r.primary.title, "example.com/shop");
});

// ------------------------------------------------------------------ exactly one primary, no duplicates
await test("every combination yields exactly one primary, and no shortcut repeats it", () => {
  const options = {
    bookings_enabled: [false, true],
    whatsapp_number: ["", WA],
    about_phone: ["", PHONE, WA],
    about_email: ["", "a@b.co"],
    links: [[], [link("https://x.co")], [link("")]],
  };
  const keys = Object.keys(options);
  let combos = 0;
  const walk = (i, acc) => {
    if (i === keys.length) {
      combos++;
      const r = H.resolveHeroAction(base(acc), "fr");
      assert.ok(r.primary && typeof r.primary.kind === "string");
      assert.equal(new Set(r.secondary).size, r.secondary.length, "no shortcut twice");
      if (r.primary.kind === "whatsapp") assert.ok(!r.secondary.includes("whatsapp"));
      if (r.primary.kind === "phone") assert.ok(!r.secondary.includes("call"));
      if (r.primary.kind === "connect") assert.deepEqual(r.secondary, [], "Connect is the primary only when nothing else is actionable");
      // connect only when no other route exists
      const other = acc.bookings_enabled || acc.whatsapp_number || acc.about_phone || acc.about_email || acc.links.some((l) => l.url);
      assert.equal(r.primary.kind === "connect", !other, JSON.stringify(acc));
      return;
    }
    for (const v of options[keys[i]]) walk(i + 1, { ...acc, [keys[i]]: v });
  };
  walk(0, {});
  assert.equal(combos, 2 * 2 * 3 * 2 * 3);
});
await test("Connect is never offered as a second control: it is the primary only, and never a shortcut", () => {
  assert.ok(!JSON.stringify(H.resolveHeroAction(base({ whatsapp_number: WA }), "en").secondary).includes("connect"));
  const types = new Set();
  for (const p of [base(), base({ whatsapp_number: WA }), base({ bookings_enabled: true, whatsapp_number: WA })]) H.resolveHeroAction(p, "en").secondary.forEach((s) => types.add(s));
  assert.deepEqual([...types].sort(), ["call", "save", "whatsapp"]);
});

// ------------------------------------------------------------------ booking uses the existing configuration
await test("booking wording comes from the existing booking configuration for every category (and subcategory)", () => {
  for (const c of CATEGORIES) {
    for (const locale of ["en", "fr"]) {
      const r = H.resolveHeroAction({ username: "ada", category: c.id, bookings_enabled: true }, locale);
      assert.equal(r.primary.label, getBookingConfig(c.id, null).buttonLabel[locale], `${c.id} ${locale}`);
    }
    for (const sub of c.defaults.subcategories || []) {
      const r = H.resolveHeroAction({ username: "ada", category: c.id, subcategory: sub.id, bookings_enabled: true }, "en");
      assert.equal(r.primary.label, getBookingConfig(c.id, sub.id).buttonLabel.en, `${c.id}/${sub.id}`);
    }
  }
  assert.equal(H.resolveHeroAction({ username: "a", category: "real_estate", bookings_enabled: true }, "en").primary.label, "Request Viewing");
  assert.equal(H.resolveHeroAction({ username: "a", category: "construction_home_services", bookings_enabled: true }, "en").primary.label, "Request a Quote");
});
await test("the owner's own booking button text always wins over the category wording", () => {
  const r = H.resolveHeroAction({ username: "a", category: "real_estate", bookings_enabled: true, booking_button_text: "  Visit us  " }, "fr");
  assert.equal(r.primary.label, "Visit us");
});
await test("the resolver adds no label map of its own: wording is not duplicated from the category configuration", () => {
  const h = src("lib/heroAction.ts");
  assert.match(h, /getBookingConfig\(/);
  for (const w of ["Request Viewing", "Request a Quote", "Book Appointment", "Book a Class", "Book a Trip", "Réserver"]) assert.ok(!h.includes(w), w);
});

// ------------------------------------------------------------------ pure and synchronous
await test("the resolver is pure and synchronous: no React, browser, network, storage or database", () => {
  const h = src("lib/heroAction.ts");
  assert.doesNotMatch(h, /"use client"|window|document\.|navigator|fetch\(|supabase|localStorage|sessionStorage|useState|useEffect|async |await |Promise|setTimeout/);
  const input = base({ whatsapp_number: WA, links: [link("https://x.co")] });
  const before = JSON.stringify(input);
  const a = H.resolveHeroAction(input, "en");
  assert.equal(JSON.stringify(input), before, "input untouched");
  assert.deepEqual(H.resolveHeroAction(input, "en"), a, "same data, same answer (public page and preview agree)");
  assert.ok(!(a instanceof Promise) && !(a.primary instanceof Promise));
});

// ------------------------------------------------------------------ category branch protection
await test("branch precedence is unchanged: Restaurant, then Music, then the generic hero", () => {
  const v = src("components/ProfileView.tsx");
  assert.match(v, /\{isRestaurant \? \(\s*<RestaurantHeroButtons[\s\S]*?\) : isMusic \? \(\s*<MusicHeroButtons[\s\S]*?\) : \(\s*genericHero && \(\s*<GenericHeroActions/);
  assert.match(v, /const genericHero = !isRestaurant && !isMusic \? resolveHeroAction\(profile, locale\) : null;/, "the generic resolver only applies to the generic branch");
  assert.equal(count(v, /<RestaurantHeroButtons/g), 1);
  assert.equal(count(v, /<MusicHeroButtons/g), 1);
  assert.equal(count(v, /<GenericHeroActions/g), 1);
  assert.doesNotMatch(v, /profile\.whatsapp_number \|\| profile\.bookings_enabled/, "no raw-truthiness hero any more");
});
await test("the Music and Restaurant hero components, and Stay Connected, are byte-for-byte as approved", () => {
  // Pinned on purpose: Phase 3B must not touch these. If a later phase edits one on purpose, update the hash with it.
  const pins = {
    "components/music/MusicHeroButtons.tsx": null,
    "components/restaurant/RestaurantHeroButtons.tsx": null,
    "components/connect/StayConnectedModal.tsx": null,
  };
  const expected = JSON.parse(fs.readFileSync(path.join(REPO, "scripts/tests/heroActionPins.json"), "utf8"));
  for (const f of Object.keys(pins)) assert.equal(sha(f), expected[f], `${f} changed`);
  for (const f of ["components/music/MusicHeroButtons.tsx", "components/restaurant/RestaurantHeroButtons.tsx"]) {
    assert.doesNotMatch(src(f), /heroAction|GenericHeroActions|ConnectButton/, `${f} must not know about the generic hero`);
  }
});

// ------------------------------------------------------------------ Connect placement and protection
await test("Connect is rendered once, as the first thing inside #profile-content, and never above it", () => {
  const v = src("components/ProfileView.tsx");
  assert.equal(count(v, /<ConnectButton/g), 1, "no duplicate Connect");
  const container = v.indexOf('id={preview ? undefined : "profile-content"}');
  const connect = v.indexOf("<ConnectButton");
  const firstSection = v.indexOf("{(pinnedItem || showPinnedSupport) && (");
  const hero = v.indexOf("<GenericHeroActions");
  assert.ok(container > 0 && connect > container, "Connect is inside the skip-link target");
  assert.ok(connect < firstSection, "and comes before the rest of the page content");
  assert.ok(hero > 0 && hero < container, "the hero's own actions come before it");
  assert.match(v, /\{!isOwner && \(\s*<ConnectButton/, "the owner still never sees Connect");
  assert.match(v, /preview=\{preview\}\s*variant=\{genericHero\?\.primary\.kind === "connect" \? "primary" : "compact"\}/);
  // nothing after the content is a Connect any more
  assert.ok(!v.slice(firstSection).includes("<ConnectButton"));
});
await test("Connect's behaviour and customer endpoints are untouched; only its look has variants", () => {
  const c = src("components/connect/ConnectButton.tsx");
  assert.deepEqual([...c.matchAll(/["'`](\/api\/[^"'`?]*)/g)].map((m) => m[1]).sort(), ["/api/customer/connect", "/api/customer/me"]);
  assert.equal(count(c, /fetch\(/g), 2);
  assert.match(c, /const \[status, setStatus\] = useState<Status>\(preview \? "out" : "loading"\);/);
  assert.match(c, /useEffect\(\(\) => \{\s*if \(preview\) return;/);
  assert.match(c, /if \(preview \|\| busy \|\| status === "loading"\) return;/);
  assert.match(c, /!preview && modal/, "the modal never opens in the preview");
  assert.match(c, /variant = "card"/, "the original card stays the default");
  assert.match(c, /t\.connect\.sectionTitle/);
  assert.match(c, /t\.connect\.sectionSubtitle\(profile\.name\)/);
  assert.match(c, /variant === "compact"[\s\S]{0,120}min-h-\[44px\]/);
  assert.match(c, /variant === "primary"[\s\S]{0,200}min-h-\[48px\]/);
  assert.equal(count(c, /<StayConnectedModal/g), 1);
  assert.equal(count(c, /<button/g), 1, "one button in every variant");
});
await test("the hero never waits for a request: GenericHeroActions has no effects or fetches and ProfileView passes plain data", () => {
  const g = src("components/GenericHeroActions.tsx");
  assert.doesNotMatch(g, /useEffect|useState|fetch\(|async |await |Promise/);
  assert.doesNotMatch(g, /ConnectButton/, "Connect is drawn by ProfileView only");
  assert.match(g, /if \(primary\.kind === "connect" && secondary\.length === 0\) return null;/, "no empty gap when Connect is the answer");
});
await test("preview safety: the generic hero uses the same data in the editor preview and nothing public-only was added to it", () => {
  const v = src("components/ProfileView.tsx");
  assert.match(v, /resolveHeroAction\(profile, locale\)/);
  assert.match(v, /const logClick = async[\s\S]{0,400}if \(preview\) return;/, "hero clicks are not logged from the preview");
  assert.match(v, /onWhatsappClick=\{\(\) => logClick\("whatsapp"/);
  assert.match(v, /onLinkClick=\{\(id, title\) => logClick\("link", id/);
});

// ------------------------------------------------------------------ rendering: sizes, secondary look
await test("rendering: one full-width primary (48px), quiet outline shortcuts (44px), no equal-weight cluster", () => {
  const g = src("components/GenericHeroActions.tsx");
  assert.match(g, /const PRIMARY = "w-full min-h-\[48px\]";/);
  assert.match(g, /const SECONDARY = "min-h-\[44px\]";/);
  assert.match(g, /const quiet: CSSProperties = \{ backgroundColor: "transparent"/);
  assert.equal(count(g, /className=\{PRIMARY\}|\$\{PRIMARY\}/g) >= 4, true, "every primary kind is full width");
  assert.equal(count(g, /buttonStyle=\{quiet\}/g), 3, "all three shortcuts use the quiet style");
  assert.doesNotMatch(g, /min-w-\[100px\]/, "the old equal-width cluster is gone");
  // the shortcuts are chosen from the resolver, not re-derived from raw fields
  assert.match(g, /secondary\.includes\("whatsapp"\)/);
  assert.match(g, /secondary\.includes\("call"\) && callNumber/);
  assert.match(g, /secondary\.includes\("save"\)/);
});

// ------------------------------------------------------------------ translations
await test("every new hero label exists in English AND French and is really translated", () => {
  for (const k of ["callButton", "saveContactButton", "emailButton", "visitWebsite", "visitLink"]) {
    const en = TR.en.profilePage[k];
    const fr = TR.fr.profilePage[k];
    assert.ok(typeof en === "string" && en.trim() && typeof fr === "string" && fr.trim(), k);
    assert.notEqual(en, fr, `${k} is not translated`);
  }
  assert.equal(TR.fr.profilePage.visitWebsite, "Visiter le site");
  assert.equal(TR.fr.profilePage.visitLink, "Visiter le lien");
  assert.equal(TR.en.profilePage.visitWebsite, "Visit Website");
});
await test("the generic hero's Call / Save text no longer comes from hard-coded English", () => {
  const call = src("components/CallButton.tsx");
  const save = src("components/SaveContactButton.tsx");
  assert.match(call, /\{!compact && t\.profilePage\.callButton\}/);
  assert.match(save, /\{!compact && t\.profilePage\.saveContactButton\}/);
  assert.doesNotMatch(call, /\{!compact && "Call"\}/);
  assert.doesNotMatch(save, /\{!compact && "Save"\}/);
  assert.match(call, /useLanguage/);
  assert.match(save, /useLanguage/);
});
await test("no literal user-facing English in the new hero code", () => {
  const g = src("components/GenericHeroActions.tsx");
  const jsxText = [...g.matchAll(/>\s*([A-Za-z][A-Za-z ,.'’!?:-]{2,})\s*</g)].map((m) => m[1]);
  assert.deepEqual(jsxText, []);
  assert.doesNotMatch(g, /(aria-label|title|placeholder|alt)="[A-Za-z]/);
  assert.match(g, /t\.profilePage\.emailButton/);
  assert.match(g, /t\.profilePage\.visitWebsite/);
  assert.match(g, /t\.profilePage\.visitLink/);
  const h = src("lib/heroAction.ts");
  assert.doesNotMatch(h, /["'`](Call|Save|Visit|Send an email|Connect)["'`]/);
});
await test("the shared contact buttons keep their old look for the Music hero (compact stays icon-only, defaults unchanged)", () => {
  for (const f of ["components/CallButton.tsx", "components/SaveContactButton.tsx", "components/WhatsAppButton.tsx"]) {
    const s = src(f);
    assert.match(s, /compact \? "flex-1 py-1\.5" : "px-4 py-2\.5 text-sm font-medium"/, f);
    assert.match(s, /className\?: string;/, f);
    assert.match(s, /\$\{className \?\? ""\}/, f);
  }
});

if (failures.length) {
  console.log(`FAIL: ${failures.length} failed, ${passed} passed`);
  failures.forEach((f) => console.log(" - " + f));
  process.exit(1);
}
console.log(`PASS: ${passed} tests passed`);
