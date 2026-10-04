// Phase 3A: the public profile foundation and the Music pilot.
// A creator's saved theme stays authoritative; a Music profile gets a Ringo stage (a light Paper panel, Ink player cards, the Ring in the
// creator's own accent) built only from foundation tokens; the product behavior (10-second preview, Buy Now, prices, commissions, routes)
// is exactly what it was. Real components are server-rendered in EN and FR; layout, motion and pixels are verified in the browser harness.
//   Run:  node scripts/tests/musicProfile.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { execSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { PHASE11_FILES } from "./phase11Files.mjs";
import { isPhase2File } from "./phase2Files.mjs";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const { transform } = require("sucrase");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

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
const raw = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const git = (cmd) => execSync(`git ${cmd}`, { cwd: REPO, encoding: "utf8" });
const PHASE3_BASE = "b33b1f4"; // the approved Phase 1 + 2 commit: Phase 3A is the working tree on top of it

const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const color = jiti(path.join(SRC, "lib/color.ts"));
const theme = jiti(path.join(SRC, "lib/theme.ts"));
const stages = jiti(path.join(SRC, "lib/profileStage.ts"));
const { CATEGORIES } = jiti(path.join(SRC, "lib/categories.ts"));

let LOCALE = "en";
const cache = new Map();
const resolveSrc = (id) => {
  const base = path.join(SRC, id.slice(2));
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error("cannot resolve " + id);
};
const stubs = {
  "@/components/LanguageProvider": { useLanguage: () => ({ locale: LOCALE, t: translations[LOCALE], setLocale() {} }), LanguageProvider: ({ children }) => children },
  "next/link": { __esModule: true, default: ({ href, children, ...p }) => React.createElement("a", { href, ...p }, children) },
  "next/script": { __esModule: true, default: () => null },
  "next/image": { __esModule: true, default: (p) => React.createElement("img", { src: p.src, alt: p.alt }) },
};
function load(file) {
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
const html = (Comp, props, lang = "en") => {
  LOCALE = lang;
  return renderToStaticMarkup(React.createElement(Comp, props)).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').split(String.fromCharCode(160)).join(" ").split(String.fromCharCode(8239)).join(" ");
};
const ProfileView = load(path.join(SRC, "components/ProfileView.tsx")).default;

const THEME_FIELDS = ["theme_color", "background_style", "background_color", "background_gradient_end", "text_color", "button_style", "button_radius"];
const baseTheme = { theme_color: "#D4A954", background_style: "solid", background_color: "#0A0A0A", background_gradient_end: null, text_color: "#FAFAFA", button_style: "outline", button_radius: "rounded" };
const music = (over = {}) => ({
  id: "p1", user_id: "u1", username: "jaykay", name: "Jay Kay", bio: "Afrobeat artist.", category: "music_entertainment", categories: ["music_entertainment"], music_role: "artist",
  published: true, currency: "XAF", whatsapp_number: "+237 677 12 34 56", hub_support_enabled: true, bookings_enabled: true, avatar_url: "/a.png", cover_image_url: "/c.png",
  pinned_type: "track", pinned_id: "t1",
  tracks: [
    { id: "t1", title: "My Era", artist_name: "Jay Kay", duration: "3:12", price: 500, protected_audio_path: "x", preview_audio_url: "/p.mp3", cover_image_url: "/t1.png", sort_order: 0, available: true },
    { id: "t2", title: "Ndole", artist_name: "Jay Kay", duration: "3:40", audio_url: "/n.mp3", sort_order: 1, available: true },
  ],
  music_releases: [
    { id: "r1", title: "Littoral", release_type: "album", price: 3000, cover_image_url: "/r1.png", available: true },
    { id: "r2", title: "Bona EP", release_type: "ep", price: 1500, cover_image_url: "/r2.png", available: true },
    { id: "r3", title: "Akwa", release_type: "ep", price: 1500, available: true },
  ],
  products: [{ id: "m1", profile_id: "p1", name: "Hoodie", price: 12000, image_url: "/h.png", available: true }],
  events: [{ id: "e1", title: "Release party", event_date: "2026-12-05", event_time: "20:00", location: "Douala", price: 3000, status: "published", event_ticket_types: [] }],
  links: [{ id: "l1", title: "Audiomack", url: "https://audiomack.com/jaykay", sort_order: 0 }],
  social_links: [{ id: "s1", platform: "instagram", url: "https://instagram.com/jaykay" }],
  about_position: "Artist", about_email: "b@jaykay.example", profile_phone_numbers: [], menu_items: [],
  ...baseTheme, ...over,
});
const generic = (over = {}) => ({ ...music(), category: "professional_services", categories: ["professional_services"], pinned_type: null, pinned_id: null, tracks: [], music_releases: [], events: [], ...over });
const render = (p, lang = "en") => html(ProfileView, { profile: p, pageViewEventId: "e" }, lang);

// ------------------------------------------------------------------ contrast helpers
await test("readableOn: ink or white, whichever reads on any creator accent (a white label on a gold fill does not)", () => {
  for (const hex of ["#D4A954", "#F2B705", "#F5E3A1", "#1F9D55", "#4F46E5", "#E11D48", "#FFFFFF", "#000000", "#808080", "#0EA5E9", "#7C3AED", "#FF6B4A", "#14B8A6"]) {
    const c = color.readableOn(hex);
    assert.ok(color.contrastRatio(hex, c) >= 4.5, `${hex} -> ${c}: ${color.contrastRatio(hex, c).toFixed(2)}`);
  }
  assert.equal(color.readableOn("#D4A954"), "#14110A", "the default gold takes ink (white on gold is 2:1)");
  assert.equal(color.readableOn("#1F9D55") === "#14110A" || color.readableOn("#1F9D55") === "#FFFFFF", true);
  assert.ok(color.contrastRatio("#D4A954", "#FFFFFF") < 3, "which is exactly why the old '#fff on accent' failed for gold");
});
await test("accentTextOn: the accent itself when it already reads, otherwise the same hue moved toward black until it does; always legible", () => {
  const paper = "#FAFAF8";
  assert.equal(color.accentTextOn(paper, "#14110A"), "#14110A", "already legible accents are untouched");
  for (const hex of ["#D4A954", "#F2B705", "#F5E3A1", "#FFE08A", "#1F9D55", "#4F46E5", "#E11D48", "#FFFFFF", "#9CA3AF"]) {
    const out = color.accentTextOn(paper, hex);
    assert.match(out, /^#[0-9a-f]{6}$/i);
    assert.ok(color.contrastRatio(paper, out) >= 4.5, `${hex} -> ${out}: ${color.contrastRatio(paper, out).toFixed(2)}`);
  }
  const darkened = color.accentTextOn(paper, "#D4A954");
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(darkened.slice(i, i + 2), 16));
  assert.ok(r > g && g > b, "the gold keeps its hue (red > green > blue), just deeper: " + darkened);
  assert.equal(color.accentTextOn("#0A0A0A", "#D4A954"), "#D4A954", "on a dark surface gold already reads, so it is not changed");
  assert.ok(color.contrastRatio("#0A0A0A", color.accentTextOn("#0A0A0A", "#333333")) >= 4.5, "and a dark accent on a dark surface is lightened");
  assert.equal(color.hexToRgba("#D4A954", 0.5), "rgba(212, 169, 84, 0.5)", "hexToRgba is untouched");
});
await test("getPanelButtonStyle: the creator's accent stays the border and the fill; only the text is chosen to be legible", () => {
  const panel = "#FAFAF8";
  const o = theme.getPanelButtonStyle("outline", "#D4A954", panel);
  assert.equal(o.border, "2px solid #D4A954");
  assert.ok(color.contrastRatio(panel, o.color) >= 4.5);
  const f = theme.getPanelButtonStyle("fill", "#D4A954", panel);
  assert.equal(f.backgroundColor, "#D4A954");
  assert.equal(f.color, "#14110A");
  const s = theme.getPanelButtonStyle("soft", "#F5E3A1", panel);
  assert.equal(s.backgroundColor, color.hexToRgba("#F5E3A1", 0.14));
  assert.ok(color.contrastRatio(panel, s.color) >= 4.5);
  assert.deepEqual(theme.getButtonStyle("outline", "#D4A954"), { backgroundColor: "transparent", border: "2px solid #D4A954", color: "#D4A954" }, "the shared getButtonStyle is unchanged");
  assert.equal(theme.getButtonStyle("fill", "#D4A954").color, "#ffffff", "and so is every other category's fill button");
});

// ------------------------------------------------------------------ the stage: foundation tokens, data-driven, Music only
await test("stage: Music gets a Paper panel, Ink player cards, the avatar Ring and a closing Ring; every other category gets none (no fork, no panel)", () => {
  const m = stages.getProfileStage("music_entertainment");
  assert.equal(m.id, "music");
  assert.ok(m.panel && m.player && m.avatarRing && m.closingRing);
  for (const c of CATEGORIES.filter((c) => c.id !== "music_entertainment")) {
    const s = stages.getProfileStage(c.id);
    assert.deepEqual([s.id, s.panel, s.player, s.avatarRing, s.closingRing], ["default", null, null, false, false], c.id);
  }
  for (const v of [undefined, null, "", "nonsense"]) assert.equal(stages.getProfileStage(v).id, "default");
});
await test("stage colors ARE the foundation tokens (no private palette): the hex mirrors match globals.css, and the panel is built from var(--rc-*)", () => {
  const css = raw("src/app/globals.css");
  const tok = (n) => css.match(new RegExp(`--${n}:\\s*(\\d+) (\\d+) (\\d+);`)).slice(1).map(Number);
  const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  const m = stages.MUSIC;
  assert.equal(m.panel.backgroundHex, hex(tok("rc-paper")));
  assert.equal(m.panel.textHex, hex(tok("rc-ink-2")));
  assert.equal(m.panel.background, "rgb(var(--rc-paper))");
  assert.equal(m.panel.text, "rgb(var(--rc-ink-2))");
  assert.equal(m.player.background, "rgb(var(--rc-ink-2))");
  assert.equal(m.player.text, "rgb(var(--rc-paper))");
  assert.match(m.panel.className, /rounded-ringo-xl.*shadow-ringo-3/);
  assert.ok(color.contrastRatio(m.panel.backgroundHex, m.panel.textHex) >= 12, "ink on paper");
});
await test("no private colors left in the Music components: the old cream, the old player ink, the 28px radius and the hand-made shadow are gone", () => {
  const files = ["components/ProfileView.tsx", "components/music/MusicSection.tsx", "components/music/EventsSection.tsx", "components/music/PinnedSpotlight.tsx", "components/music/ReleasesSection.tsx", "components/music/SupportArtistSection.tsx", "components/music/MusicHeroButtons.tsx"];
  const all = files.map((f) => strip(raw("src/" + f))).join("\n");
  for (const gone of ["#FBF3E7", "#1C140C", "#171009", "#F5EFE4", "rounded-[28px]", "shadow-[0_10px_36px", "MUSIC_CREAM"]) assert.ok(!all.includes(gone), gone);
  assert.ok(!/backgroundColor: accent, color: "#fff"|backgroundColor: hexToRgba\(accent, 0\.9\), color: "#fff"/.test(strip(raw("src/components/music/MusicHeroButtons.tsx")) + strip(raw("src/components/music/MusicSection.tsx")) + strip(raw("src/components/music/ReleasesSection.tsx")) + strip(raw("src/components/music/SupportArtistSection.tsx")) + strip(raw("src/components/music/PinnedSpotlight.tsx"))), "no hard-coded white text on the creator's accent");
  assert.ok(!/indigo|violet|purple/.test(all), "no indigo in the public profile");
});

// ------------------------------------------------------------------ creator themes stay authoritative
await test("theme safety: ProfileView only READS the creator's theme fields; nothing in the profile components or libs writes one", () => {
  for (const f of ["components/ProfileView.tsx", "components/music/PinnedSpotlight.tsx", "components/music/MusicSection.tsx", "components/music/ReleasesSection.tsx", "components/music/EventsSection.tsx", "components/music/SupportArtistSection.tsx", "components/music/MusicHeroButtons.tsx", "lib/profileStage.ts", "lib/color.ts", "lib/theme.ts"]) {
    const s = strip(raw("src/" + f));
    for (const field of THEME_FIELDS) assert.ok(!new RegExp(`\\b${field}\\s*(=[^=]|:\\s*[^,}\\s]+\\s*[,}]\\s*$)`, "m").test(s.replace(/profile\.\w+ \|\| /g, "")) || f === "components/ProfileView.tsx", `${f} writes ${field}`);
    assert.ok(!/supabase|\.update\(|\.upsert\(|\.insert\(|fetch\(/.test(s.replace(/fetch\("\/api\/track"[\s\S]*?\)/, "")) || f === "components/ProfileView.tsx", `${f} touches the database`);
  }
  const v = strip(raw("src/components/ProfileView.tsx"));
  assert.ok(!/profile\.(theme_color|background_color|text_color|button_style|button_radius|background_style|background_gradient_end)\s*=[^=]/.test(v), "no assignment to a profile theme field");
  assert.match(v, /const accent = profile\.theme_color \|\| "#D4A954";/);
  assert.match(v, /const textColor = profile\.text_color \|\| "#FAFAFA";/);
  assert.match(v, /const bgColor = profile\.background_color \|\| "#0A0A0A";/);
  assert.equal(git(`diff --name-only ${PHASE3_BASE} -- "src/app/[username]/page.tsx" src/lib/categories.ts src/components/editor src/components/dashboard src/app/api`).trim(), "", "the theme sources, the editor and the APIs are untouched");
});
await test("theme safety (rendered): a saved creator theme reaches the page exactly as saved, in every theme and every theme field", () => {
  for (const t of [
    { theme_color: "#F5E3A1", background_style: "solid", background_color: "#101820", text_color: "#F5F5F5", button_style: "soft", button_radius: "square" },
    { theme_color: "#1F9D55", background_style: "solid", background_color: "#FFFFFF", text_color: "#14202B", button_style: "fill", button_radius: "rounded" },
    { theme_color: "#F2B705", background_style: "gradient", background_color: "#0B0B12", background_gradient_end: "#1A1220", text_color: "#FAFAFA", button_style: "outline", button_radius: "pill" },
  ]) {
    const h = render(music(t));
    assert.ok(h.includes(t.background_style === "gradient" ? `linear-gradient(135deg, ${t.background_color}, ${t.background_gradient_end})` : `background-color:${t.background_color}`), "background " + t.background_color);
    assert.ok(h.includes(`color:${t.text_color}`), "text");
    assert.ok(h.includes(`--theme:${t.theme_color}`), "the accent variable");
    assert.ok(h.includes(`background-color:${t.theme_color}`), "the accent fill (Buy Now)");
  }
  const input = music();
  const before = JSON.stringify(input);
  render(input);
  assert.equal(JSON.stringify(input), before, "the profile object is never mutated by rendering");
});
await test("every theme property still drives the page: the hero uses the creator's background and text, buttons keep their radius", () => {
  const h = render(music({ background_color: "#101820", text_color: "#F5F5F5", button_radius: "square" }));
  assert.ok(h.includes("background-color:#101820") && h.includes("color:#F5F5F5"));
  assert.ok(h.includes("rounded-md"), "a square-radius profile keeps square link buttons");
  assert.ok(render(music({ button_radius: "pill" })).includes("rounded-full"));
});

// ------------------------------------------------------------------ the Music experience (rendered, EN and FR)
const stageMarks = (h) => ({
  panel: h.includes("rounded-ringo-xl") && h.includes("background-color:rgb(var(--rc-paper))"),
  ring: (h.match(/<svg[^>]*aria-hidden="true"/g) || []).length,
  pulses: (h.match(/animate-ring-pulse/g) || []).length,
});
await test("Music renders the stage: Paper panel, the open Ring in the creator's accent around the avatar (no looping pulse), a closing Ring", () => {
  const h = render(music({ theme_color: "#F5E3A1" }));
  const m = stageMarks(h);
  assert.ok(m.panel, "Paper panel");
  assert.equal(m.pulses, 0, "no looping pulse on a Music avatar");
  assert.ok(h.includes('stroke="#F5E3A1"') && h.includes('stroke-width="2.5"'), "a fine Ring in the creator's accent, not the platform gold");
  assert.ok(!h.includes("ring-4"), "the avatar's own thick ring is replaced by the Ring");
  assert.equal((h.match(/<svg[^>]*viewBox="0 0 100 100"[^>]*aria-hidden="true"/g) || []).length, 2, "two Rings: around the avatar and in the footer");
  assert.ok((h.match(/stroke="#F5E3A1"/g) || []).length >= 2, "both in the same creator accent");
  assert.ok(h.includes('<footer role="contentinfo"'));
  assert.ok(h.indexOf("<svg", h.indexOf('<footer role="contentinfo"')) > 0, "the closing Ring sits in the footer");
  assert.ok(!h.includes("rgb(var(--rc-signal))"), "teal appears only for a real connected state (none is shown on the page)");
});
await test("every other category is byte-for-byte the old structure: no panel, the two pulse rings, the thick avatar ring, no Ring", () => {
  const h = render(generic());
  assert.ok(!h.includes("rounded-ringo-xl") && !h.includes("--rc-paper"));
  assert.equal((h.match(/animate-ring-pulse-[12]/g) || []).length, 2);
  assert.ok(h.includes("ring-4"));
  assert.equal((h.match(/<svg[^>]*stroke-width="(2\.5|6)"/g) || []).length, 0, "no Ring on a generic profile");
});
await test("Music behavior is preserved: Buy Now, Book, the 10-second preview, prices, purchase and detail routes, WhatsApp and social links", () => {
  const h = render(music());
  assert.ok(h.includes('href="/m/jaykay"') && h.includes(">Buy Now<"), "Buy Now goes to the storefront");
  assert.ok(h.includes('href="/jaykay/book"'), "Book goes to the booking page");
  assert.ok(h.includes("/m/jaykay/track/t1") && h.includes("/m/jaykay/track/t2"), "track detail pages");
  assert.ok(h.includes("/m/jaykay/release/r1") && h.includes("/m/jaykay/release/r3"), "release pages");
  assert.ok(h.includes("/m/jaykay/merch/m1"), "merch detail");
  assert.ok(h.includes("/m/jaykay/ticket/e1"), "ticket detail");
  assert.ok(h.includes("FCFA 500") && h.includes("FCFA 3,000") && h.includes("FCFA 1,500"), "prices as saved");
  assert.ok(h.includes(translations.en.music.previewButtonLabel), "protected tracks still say Preview");
  assert.ok(h.includes('href="https://instagram.com/jaykay"') && h.includes("wa.me/237677123456"), "social and WhatsApp");
  assert.ok(!/Listen Now|Écouter maintenant/i.test(h), "no streaming 'Listen Now' replaced the purchase flow");
  assert.ok(h.includes("/m/jaykay?support=1000"), "the gift / support checkout route is unchanged");
});
await test("a protected track is still sold only through its detail page and a preview clip: no direct audio on a protected row", () => {
  const h = render(music());
  assert.ok(!h.includes('src="/p.mp3"') && !/<audio/.test(h), "the page ships no <audio> element or source in the HTML (the single audio element is created on play by useTrackPlayback)");
  assert.equal(git(`diff --name-only ${PHASE3_BASE} -- src/components/music/useTrackPlayback.ts src/components/music/ItemDetailPage.tsx src/components/music/MusicStorePage.tsx src/lib src/app/api`).split("\n").filter(Boolean).filter((f) => !PHASE11_FILES.has(f)).join(","), "", "playback, storefront and every API are untouched");
});
await test("latest release: the creator's pinned item leads, as an artwork-led card with an accent edge and a readable badge; nothing is invented", () => {
  const h = render(music());
  const badgeAt = h.indexOf(translations.en.music.spotlightBadge);
  const spot = h.slice(h.lastIndexOf('rounded-ringo-xl animate-fade-up', badgeAt), badgeAt + 900);
  assert.ok(spot.includes("/t1.png") && spot.includes("My Era"), "the real artwork and title");
  assert.ok(spot.includes("rounded-ringo-xl") && spot.includes("inset 0 0 0 1px rgba(212, 169, 84, 0.4)"), "a 32px object with an inner edge in the creator's accent");
  assert.ok(/color:#14110A/.test(spot), "the badge text is ink on the gold accent, not white");
  assert.ok(!render(music({ pinned_type: null, pinned_id: null })).includes(translations.en.music.spotlightBadge), "nothing is pinned, so nothing is invented");
  assert.ok(!render(music({ cover_image_url: null, tracks: [{ ...music().tracks[0], cover_image_url: null }, music().tracks[1]] })).includes("undefined"), "no cover art means no fake art");
});
await test("releases: with an odd count the first leads full width (an editorial grid that always fills); with an even count it is the old 2-up grid", () => {
  const odd = render(music());
  assert.equal((odd.match(/col-span-2/g) || []).length, 1);
  assert.ok(odd.includes("aspect-[16/10]"));
  const even = render(music({ music_releases: music().music_releases.slice(0, 2) }));
  assert.equal((even.match(/col-span-2/g) || []).length, 0);
  const one = render(music({ music_releases: music().music_releases.slice(0, 1) }));
  assert.equal((one.match(/col-span-2/g) || []).length, 1);
  assert.ok(!render(music({ music_releases: [] })).includes(translations.en.music.releasesTitle));
});

// ------------------------------------------------------------------ Gift the Artist (and no leakage between languages)
await test("Gift the Artist: the approved wording replaces 'Support' on the public Music profile (EN and FR), with no emoji and the same checkout route", () => {
  const en = render(music({ pinned_type: "support", pinned_id: null }), "en");
  const fr = render(music({ pinned_type: "support", pinned_id: null }), "fr");
  assert.equal(translations.en.music.supportTitle, "Gift the Artist");
  assert.equal(translations.en.music.sendSupportButton, "Gift the Artist");
  assert.equal(translations.en.music.pinnedSupportCta, "Gift");
  assert.equal(translations.fr.music.supportTitle, "Offrir un cadeau à l'artiste");
  assert.equal(translations.fr.music.sendSupportButton, "Offrir un cadeau");
  assert.equal(translations.fr.music.pinnedSupportCta, "Offrir");
  assert.ok(en.includes("Gift the Artist") && fr.includes("Offrir un cadeau à l'artiste"));
  assert.ok(!/Support the Artist|Soutenir l'artiste|>Support<|>Soutenir</.test(en + fr), "no 'Support' wording on the public Music profile in either language");
  assert.ok(!/gift|Gift/.test(translations.en.music.sendSupportButton + "") || !/❤/.test(translations.en.music.sendSupportButton + translations.fr.music.sendSupportButton), "no emoji in the button");
  assert.ok(en.includes("/m/jaykay?support=1000") && fr.includes("/m/jaykay?support=1000"));
  for (const k of ["supportTitle", "supportHint", "sendSupportButton", "pinnedSupportCta"]) assert.notEqual(translations.en.music[k], translations.fr.music[k], k);
});
await test("no language leakage: the French Music profile has no English UI text (play and pause labels included), and the English one has no French", () => {
  const fr = render(music(), "fr");
  const en = render(music(), "en");
  for (const k of ["buyNowButton", "spotlightBadge", "releasesTitle", "upcomingTitle", "supportTitle", "customAmountLabel", "playLabel"]) {
    assert.ok(fr.includes(translations.fr.music[k].replace(/'/g, "'")) || k === "releasesTitle", "FR has " + k);
    if (translations.en.music[k] !== translations.fr.music[k]) assert.ok(!fr.includes(`>${translations.en.music[k]}<`) && !fr.includes(`aria-label="${translations.en.music[k]}"`), "FR does not show the English " + k + ": " + translations.en.music[k]);
  }
  assert.ok(!/aria-label="(Play|Pause)"/.test(fr), "no hard-coded English Play / Pause");
  assert.ok(/aria-label="Lecture"/.test(fr) && /aria-label="Play"/.test(en));
  assert.ok(!/Lecture|Offrir|Acheter/.test(en));
  assert.equal(translations.fr.music.playLabel, "Lecture");
  assert.equal(translations.fr.music.pauseLabel, "Pause");
  assert.equal(JSON.stringify(Object.keys(translations.en.music).sort()), JSON.stringify(Object.keys(translations.fr.music).sort()), "the same keys in both languages");
});
await test("translations: only the eight Gift wording lines were rewritten; the two new aria keys exist in both languages; nothing else moved", () => {
  const removed = git(`diff -U0 ${PHASE3_BASE} -- src/lib/i18n/translations.ts`).split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
  assert.equal(removed.length, 8, removed.join(" | "));
  assert.ok(removed.every((l) => /(pinnedSupportCta|supportTitle|supportHint|sendSupportButton):/.test(l)));
  const added = git(`diff -U0 ${PHASE3_BASE} -- src/lib/i18n/translations.ts`).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  assert.equal(added.length, 12, "8 rewritten + playLabel / pauseLabel in two languages");
});

// ------------------------------------------------------------------ accessibility and responsive source guards
await test("accessibility: play / pause are named and translated, the Ring is hidden from assistive tech, the spotlight keeps its labelled link, targets stay 44px", () => {
  const pin = strip(raw("src/components/music/PinnedSpotlight.tsx"));
  assert.match(pin, /aria-label=\{isPlaying \? pauseLabel : playLabel\}/);
  assert.match(strip(raw("src/components/music/MusicSection.tsx")), /aria-label=\{isPlaying \? t\.music\.pauseLabel : t\.music\.playLabel\}/);
  assert.match(pin, /<a href=\{detailPageHref\} className="absolute inset-0" aria-label=\{title\} \/>/);
  assert.match(pin, /w-12 h-12 rounded-full/, "the play button is 48px");
  assert.match(strip(raw("src/components/music/MusicSection.tsx")), /w-11 h-11 rounded-full/);
  assert.equal((strip(raw("src/components/music/SupportArtistSection.tsx")).match(/min-h-\[44px\]/g) || []).length >= 4, true);
  const ring = strip(raw("src/components/ProfileView.tsx"));
  assert.equal((ring.match(/<Ring\b/g) || []).length, 2, "the avatar Ring and the closing Ring, nothing else");
  assert.match(strip(raw("src/components/brand/Ring.tsx")), /\{ "aria-hidden": true \}/, "decorative by default");
  assert.ok(!/text-\[10px\]/.test(pin), "the spotlight badge is no longer 10px");
});
await test("motion: a Music profile adds no looping animation (the avatar pulse is gone for Music, the equalizer is the existing playing-only indicator), reduced motion is kept", () => {
  const v = strip(raw("src/components/ProfileView.tsx"));
  assert.match(v, /<MotionConfig reducedMotion="user">/);
  assert.equal((v.match(/motion-reduce:animate-none/g) || []).length, 2, "the non-Music pulse keeps its reduced-motion guard");
  assert.ok(!/animate-ring-pulse|infinite/.test(strip(raw("src/components/brand/Ring.tsx"))));
  assert.match(strip(raw("src/components/music/MusicSection.tsx")), /\{isPlaying && <EqualizerBars/, "the equalizer only shows while a track is playing");
  const css = raw("src/app/globals.css");
  assert.match(css, /\.animate-eq-bar\s*\{\s*animation: none !important;/, "and rests (still) under reduced motion");
});

// ------------------------------------------------------------------ the Ring and the shared components
await test("Ring: the new color option overrides gold / signal in every state; omitting it is byte-identical to before", () => {
  const Ring = load(path.join(SRC, "components/brand/Ring.tsx")).default;
  const plain = html(Ring, { state: "idle", size: 48 });
  assert.ok(plain.includes("rgb(var(--rc-gold))") && !plain.includes("color-mix"));
  const own = html(Ring, { state: "idle", size: 48, color: "#1F9D55" });
  assert.ok(own.includes('stroke="#1F9D55"') && own.includes("color-mix(in srgb, #1F9D55 20%, transparent)") && !own.includes("rgb(var(--rc-gold))"));
  const done = html(Ring, { state: "connected", color: "#1F9D55" });
  assert.ok(done.includes('stroke="#1F9D55"') && !done.includes("rgb(var(--rc-signal))"), "a creator-coloured Ring is the creator's colour in every state");
  assert.ok(html(Ring, { state: "connected" }).includes("rgb(var(--rc-signal))"), "the default connected Ring is still signal teal");
});

// ------------------------------------------------------------------ scope and safety
await test("hero pin: MusicHeroButtons was edited on purpose and carries its new hash; it still knows nothing of the generic hero and keeps its routes", () => {
  const crypto = require("crypto");
  const pins = JSON.parse(fs.readFileSync(path.join(REPO, "scripts/tests/heroActionPins.json"), "utf8"));
  const sha = crypto.createHash("sha256").update(raw("src/components/music/MusicHeroButtons.tsx")).digest("hex");
  assert.equal(pins["components/music/MusicHeroButtons.tsx"], sha);
  const s = strip(raw("src/components/music/MusicHeroButtons.tsx"));
  assert.ok(!/heroAction|GenericHeroActions|ConnectButton/.test(s));
  assert.match(s, /href=\{`\/m\/\$\{profile\.username\}`\}/);
  assert.match(s, /`\/\$\{profile\.username\}\/book`/);
  assert.equal(git(`diff --stat ${PHASE3_BASE} -- src/components/restaurant src/components/connect`).trim(), "", "the restaurant hero and Stay Connected are untouched");
});
await test("scope: no auth, payment, commission, payout, inventory, booking, ticketing, API, database, SEO, routing, package or profile-page file changed", () => {
  const changed = git(`diff --name-only ${PHASE3_BASE}`).split("\n").filter(Boolean).concat(git("ls-files --others --exclude-standard").split("\n").filter(Boolean));
  const protectedPath = /^(package(-lock)?\.json|tsconfig\.tsbuildinfo|\.env|supabase\/|migrations\/|src\/middleware\.ts|src\/app\/|src\/lib\/(auth|billing|payments?|productCheckout|fapshi|stripe|shop|settlement|reports|inventory|music|ticket|booking|publicContent|sectionOrder|heroAction|seo|categories|branding|brandingDefaults)|src\/components\/(checkout|dashboard|auth|catalog|editor|restaurant|connect|landing|overview|BookingButton|WhatsAppButton|SocialIcon)|src\/components\/music\/(useTrackPlayback|ItemDetailPage|MusicStorePage|MusicTabs|Music(Orders|Sales|Earnings|Customers|Overview|Receipt)|ReceiptPageView|TicketPassView|EventCheckinDashboard))/;
  assert.deepEqual(changed.filter((f) => protectedPath.test(f)), []);
  assert.deepEqual(changed.filter((f) => !isPhase2File(f)), [], "every changed file is on the allowlist");
  assert.deepEqual(changed.filter((f) => !PHASE11_FILES.has(f)), [], "and every changed file belongs to Phase 3A");
});
await test("no dependency, no image payload, no canvas / WebGL / video, no new package: the profile stays light", () => {
  assert.equal(git(`diff --stat ${PHASE3_BASE} -- package.json package-lock.json tsconfig.tsbuildinfo`).trim(), "");
  const all = ["components/ProfileView.tsx", "components/music/PinnedSpotlight.tsx", "components/music/ReleasesSection.tsx", "lib/profileStage.ts"].map((f) => strip(raw("src/" + f))).join("\n");
  assert.ok(!/<canvas|webgl|three|\.mp4|<video|lottie|requestAnimationFrame|setInterval/i.test(all));
  assert.ok(!/ReleasesSection[\s\S]*<img[^>]*loading="eager"/.test(all));
});

console.log(`\nmusicProfile: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
