// Phase 3A: the public profile foundation and the Music pilot; since the Music Artist Profile redesign (phase24Files.mjs) the Music page's design contract is asserted below.
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
import { PHASE12_FILES } from "./phase12Files.mjs";
import { PHASE26_FILES } from "./phase26Files.mjs";
import { isPhase2File } from "./phase2Files.mjs";
import { isPhase16ProtectedFile } from "./phase16Files.mjs"; // security remediation: the exact files (billing webhook / upgrade stub, package files, next-env.d.ts) it changes on purpose
import { legacyTranslationsSource } from "./i18nSource.mjs"; // the dictionaries are two modules now; this rebuilds the old single-file text byte for byte

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
const PHASE3_BASE = "b33b1f4"; // the approved Phase 1 + 2 commit
const PHASE3A_COMMIT = "55eb256"; // Phase 3A as committed. The WhatsApp inbox commits landed on this branch after it, so "everything since PHASE3_BASE" is no longer
const PHASE3B_COMMIT = "8fc6f6c"; // Phase 3B-3F as committed (category stages, connection journey), also on top of the WhatsApp commits
// the Phase 3 work; phase3Diff() is the Phase 3 work only: exactly the two Phase 3 commits. It does NOT read the working tree: whatever is uncommitted
// on top of HEAD belongs to the work in progress after Phase 3 and is guarded by that work's own scope tests (see ownerWorkspaceFiles.mjs).
const phase3Diff = (opts, paths = "") => git(`diff ${opts} ${PHASE3_BASE} ${PHASE3A_COMMIT} ${paths}`) + git(`diff ${opts} ${PHASE3B_COMMIT}^ ${PHASE3B_COMMIT} ${paths}`);

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
  // The Music artist view is code-split with next/dynamic and uses next/font; the harness resolves both eagerly so the real component is what gets rendered.
  "next/dynamic": { __esModule: true, default: (loader) => { let C = null; loader().then((m) => { C = m.default || m; }); return (p) => (C ? React.createElement(C, p) : null); } },
  "next/font/google": new Proxy({ __esModule: true }, { get: (t, k) => (k === "__esModule" ? true : (o) => ({ variable: o && o.variable ? "font-var" + o.variable : "", className: "", style: {} })) }),
  "next/image": { __esModule: true, default: (p) => React.createElement("img", { src: p.src, alt: p.alt }) },
};
function load(file) {
  if (file.endsWith("musicFont.ts")) return { display: { variable: "font-mp-display" } }; // next/font only exists inside the Next build
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
const generic = (over = {}) => ({ ...music(), category: "other", categories: ["other"], pinned_type: null, pinned_id: null, tracks: [], music_releases: [], events: [], ...over });
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
await test("stage: Music gets a Paper panel, Ink player cards, the avatar Ring and a closing seal; \"other\" and anything unknown get the neutral default (no fork, no panel)", () => {
  const m = stages.getProfileStage("music_entertainment");
  assert.equal(m.id, "music");
  assert.ok(m.panel && m.player && m.avatar === "ring" && m.closingRing);
  assert.equal(m.eventDate, "badge", "Music keeps the small date stamp on its event thumbnails");
  const s = stages.getProfileStage("other");
  assert.deepEqual([s.id, s.panel, s.player, s.avatar, s.cover, s.name, s.headings, s.eventDate, s.closingRing], ["default", null, null, "pulse", "standard", "upper", "label", "badge", false]);
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
  assert.equal(phase3Diff("--name-only", `-- "src/app/[username]/page.tsx" src/lib/categories.ts src/components/editor src/components/dashboard src/app/api`).trim(), "", "the theme sources, the editor and the APIs are untouched");
});
// ===== Music Artist Profile redesign (phase24Files.mjs): the design contract, rendered through the real ProfileView -> MusicArtistView =====
const MUSIC_GROUND = "#120B10";
const MUSIC_TEXT = "#F3E9DC";
const visible = (h) => h.replace(/<[^>]*>/g, "\n").split("\n").map((x) => x.trim()).filter(Boolean);
await new Promise((r) => setTimeout(r, 100)); // the code-split Music view resolves before the first render
await test("theme contract (rendered): the Music page keeps its fixed plum-black ground and warm text whatever the creator saved; only the ACCENT is the creator's", () => {
  for (const t of [
    { theme_color: "#F5E3A1", background_style: "solid", background_color: "#101820", text_color: "#F5F5F5", button_style: "soft", button_radius: "square" },
    { theme_color: "#1F9D55", background_style: "solid", background_color: "#FFFFFF", text_color: "#14202B", button_style: "fill", button_radius: "rounded" },
    { theme_color: "#F2B705", background_style: "gradient", background_color: "#0B0B12", background_gradient_end: "#1A1220", text_color: "#FAFAFA", button_style: "outline", button_radius: "pill" },
  ]) {
    const h = render(music(t));
    assert.ok(h.includes(`background-color:${MUSIC_GROUND}`) && h.includes(`color:${MUSIC_TEXT}`), "the fixed Music ground and text");
    for (const needle of [`background-color:${t.background_color}`, `;color:${t.text_color}`, `linear-gradient(135deg, ${t.background_color}`]) assert.ok(!h.includes(needle), "not applied: " + needle); assert.ok(true, "the creator's saved background / text are not applied on a Music page");
    assert.ok(h.includes(`--theme:${t.theme_color}`) && h.includes(`--mp-accent:${t.theme_color}`), "the creator's accent drives the page");
    assert.ok(h.includes(`stroke="${t.theme_color}"`) || h.includes(`background-color:${t.theme_color}`) || h.includes(`color:${t.theme_color}`), "and is what the actions and the Ring are drawn in");
    assert.ok(h.includes(`--mp-on-accent:${color.readableOn(t.theme_color)}`), "text on the accent is whichever of ink / white reads");
  }
  const input = music();
  const before = JSON.stringify(input);
  render(input);
  assert.equal(JSON.stringify(input), before, "the profile object is never mutated by rendering");
  const pal = jiti(path.join(SRC, "components/music/profile/musicTheme.ts")).MP;
  assert.equal(pal.bg.toUpperCase(), MUSIC_GROUND);
  assert.equal(pal.fg.toUpperCase(), MUSIC_TEXT);
  assert.ok(color.contrastRatio(pal.bg, pal.fg) >= 12, "warm paper on plum-black");
  assert.ok(color.contrastRatio(pal.bg, pal.muted) >= 4.5, "the muted text still reads on the ground");
});
await test("theme contract: the accent stays legible on every creator accent (Buy / Gift text uses readableOn), the platform gold is only the default", () => {
  for (const accent of ["#D4A954", "#F5E3A1", "#1F9D55", "#4F46E5", "#E11D48"]) {
    const h = render(music({ theme_color: accent }));
    assert.ok(h.includes(`--mp-on-accent:${color.readableOn(accent)}`));
    assert.ok(color.contrastRatio(accent, color.readableOn(accent)) >= 4.5, accent);
  }
  assert.ok(render(music({ theme_color: null })).includes("--mp-accent:#D4A954"), "no saved accent falls back to the platform gold");
  const v = strip(raw("src/components/ProfileView.tsx"));
  assert.match(v, /\.\.\.\(isMusic \? \{ backgroundImage: "none", background: "#120B10", backgroundColor: "#120B10", color: "#F3E9DC" \} : \{\}\)/, "only the Music category overrides the ground");
});
await test("Music renders its own composition: dark ground, the open Ring in the creator's accent around the avatar (no looping pulse), the connection path and the Ringo footer", () => {
  const h = render(music({ theme_color: "#F5E3A1" }));
  assert.equal((h.match(/animate-ring-pulse/g) || []).length, 0, "no looping pulse");
  assert.ok(h.includes('stroke="#F5E3A1"'), "a Ring in the creator's accent, not the platform gold");
  assert.ok(!h.includes("--rc-paper") && !h.includes("rounded-ringo-xl"), "no light Paper panel: the old stage is not used on the Music profile");
  assert.ok(h.includes('<footer role="contentinfo"') && h.includes("Powered by"), "the Ringo footer");
  assert.ok(h.includes('aria-label="Connection journey"'), "the connection journey");
  assert.ok(h.includes("#profile-content"), "skip link");
  for (const bad of ["undefined", "NaN", "[object Object]", "GH₵", "GHS"]) assert.ok(!h.includes(bad), "no " + bad);
});
await test("every other category is byte-for-byte the old structure: no Music view, no panel, the two pulse rings, the thick avatar ring, no Ring", () => {
  const h = render(generic());
  assert.ok(!h.includes("rounded-ringo-xl") && !h.includes("--rc-paper") && !h.includes("--mp-accent") && !h.includes("#120B10"));
  assert.equal((h.match(/animate-ring-pulse-[12]/g) || []).length, 2);
  assert.ok(h.includes("ring-4"));
  assert.equal((h.match(/<svg[^>]*stroke-width="(2\.5|6)"/g) || []).length, 0, "no Ring on a generic profile");
  assert.ok(h.includes("background-color:#0A0A0A") && h.includes("color:#FAFAFA"), "a generic profile still gets the creator's saved background and text");
});
await test("Music behavior is preserved: Buy, Book, the 10-second preview, prices in XAF / FCFA, purchase and detail routes, WhatsApp and social links", () => {
  const h = render(music());
  assert.ok(h.includes('href="/m/jaykay/music"') && h.includes(translations.en.musicProfile.buyMusic || "Buy music"), "Buy music opens the artist's Music page (whose items lead to the one storefront checkout)");
  assert.ok(h.includes('href="/jaykay/book"'), "Book goes to the booking page");
  assert.ok(h.includes("/m/jaykay/track/t1") && h.includes("/m/jaykay/track/t2"), "track detail pages");
  assert.ok(h.includes("/m/jaykay/release/r1") && h.includes("/m/jaykay/release/r3"), "release pages");
  assert.ok(h.includes("/m/jaykay/merch/m1"), "merch detail");
  assert.ok(h.includes("/m/jaykay/ticket/e1"), "ticket detail");
  assert.ok(h.includes("500 FCFA") && h.includes("3,000 FCFA") && h.includes("1,500 FCFA") && h.includes("12,000 FCFA"), "prices exactly as saved, in FCFA");
  assert.ok(h.includes('aria-label="Play: My Era"') && !h.includes("preview_audio_url"), "a protected track shows a plain Play (the 10-second limit is enforced by the playback hook, not announced in the UI)");
  assert.ok(!/Preview 10|Preview \d+\s?s|Aperçu|Extrait \d+|10 seconds|10 secondes/i.test(visible(h).join("|") + visible(render(music(), "fr")).join("|")), "no 'Preview 10 sec' wording anywhere on the Music profile (EN or FR)");
  assert.ok(h.includes('aria-label="Buy My Era, 500 FCFA"'), "and the full song is bought, at its real price");
  assert.ok(h.includes('aria-label="Play: Ndole"'), "an unprotected track just plays");
  assert.ok(h.includes('href="https://instagram.com/jaykay"') && h.includes("wa.me/237677123456") && h.includes('href="tel:+237677123456"'), "social, WhatsApp and call");
  assert.ok(h.includes("data:text/vcard"), "save contact");
  assert.ok(!/Listen Now|Écouter maintenant/i.test(h), "no streaming 'Listen Now' replaced the purchase flow");
  assert.ok(h.includes("/m/jaykay?support=1000"), "the gift / support checkout route is unchanged");
});
await test("Music data is never invented: a profile with no songs, releases, events, merch, links or about shows none of those sections", () => {
  const h = render(music({ pinned_type: null, pinned_id: null, tracks: [], music_releases: [], events: [], products: [], links: [], hub_support_enabled: false, about_position: null, about_email: null, about_long_bio: null }));
  const text = visible(h).join("|");
  for (const k of ["songsTitle", "releasesTitle", "upcomingTitle", "merchTitle"]) {
    const label = translations.en.music[k] || translations.en.musicProfile[k];
    if (label) assert.ok(!text.includes(label), "hidden when empty: " + k);
  }
  assert.ok(!h.includes('aria-label="Featured"'), "nothing is pinned or released, so no featured card is invented");
  assert.ok(!h.includes("FCFA"), "and no price appears");
  assert.ok(!h.includes("undefined") && !h.includes("GH₵"));
});
await test("a protected track is still sold only through its detail page and a preview clip: no direct audio on a protected row", () => {
  const h = render(music());
  assert.ok(!h.includes('src="/p.mp3"') && !/<audio/.test(h), "the page ships no <audio> element or source in the HTML (the single audio element is created on play by useTrackPlayback)");
  assert.ok(!h.includes("protected_audio_path") && !h.includes('"x"'), "the protected path never reaches the page");
  assert.equal(git(`diff --name-only HEAD -- src/components/music/useTrackPlayback.ts src/lib/music/previewLimit.ts src/lib/music/currency.ts src/lib/currency.ts src/app/api`).split("\n").filter((f) => f.trim() && f.trim() !== "src/app/api/admin/branding/route.ts").join(","), "", "playback, preview limit, currency and every API route are untouched by the redesign (the performance project only adds a cache refresh to the admin branding save, proven in performance.test.mjs)");
  for (const f of ["src/components/music/ItemDetailPage.tsx", "src/components/music/MusicStorePage.tsx"]) {
    const changed = git(`diff -U0 HEAD -- ${f}`).split("\n").filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+)/.test(l));
    assert.ok(changed.every((l) => /OptImg|<img|no-img-element|^[-+]import /.test(l)), `${f}: only image tags changed (the storefront, purchase and playback code is untouched)`);
  }
});
await test("10-second preview: the shared playback hook still enforces MAX_PREVIEW_SECONDS and the redesign only calls it", () => {
  const hook = strip(raw("src/components/music/useTrackPlayback.ts"));
  assert.match(hook, /MAX_PREVIEW_SECONDS/);
  const view = strip(raw("src/components/ProfileView.tsx"));
  assert.match(view, /useTrackPlayback\(/, "ProfileView still owns the one playback");
  const mine = strip(raw("src/components/music/profile/MusicSections.tsx")) + strip(raw("src/components/music/profile/MusicArtistView.tsx"));
  assert.ok(!/new Audio\(|<audio|\.play\(\)|currentTime\s*=/.test(mine), "the redesign never touches an audio element or the clock");
  assert.ok(!/fapshi|checkout\/|\/api\/(payments|music|webhooks)|fetch\(/i.test(mine), "and no payment or API call is made from the Music profile components");
});
await test("featured card: the creator's pinned item leads with its real artwork and title; with nothing pinned the newest real release leads; nothing is invented", () => {
  const h = render(music());
  const at = h.indexOf('aria-label="Featured"');
  assert.ok(at > 0, "a featured section");
  const spot = h.slice(at, at + 2500);
  assert.ok(spot.includes("/t1.png") && spot.includes("My Era") && spot.includes("500 FCFA"), "the pinned track: real artwork, title and price");
  const none = render(music({ pinned_type: null, pinned_id: null, tracks: [], music_releases: [], products: [], events: [], hub_support_enabled: false }));
  assert.ok(!none.includes('aria-label="Featured"'), "nothing pinned and nothing released: no featured card");
  assert.ok(!render(music({ cover_image_url: null, tracks: [{ ...music().tracks[0], cover_image_url: null }, music().tracks[1]] })).includes("undefined"), "no cover art means no fake art");
});
await test("releases: one rail with a link to the storefront and one link per real release; hidden when there are none", () => {
  const h = render(music({ products: [] }));
  assert.ok(h.includes('aria-label="' + translations.en.music.releasesTitle + '"') || visible(h).includes(translations.en.music.releasesTitle), "the releases section");
  assert.ok(visible(h).includes("View all") && !visible(h).some((x) => /^shop (now|all)$/i.test(x)), "the releases section says View all (not Shop now / Shop all)");
  assert.ok(h.includes('href="/m/jaykay/music"'), "and it opens the Music page");
  for (const id of ["r1", "r2", "r3"]) assert.ok(h.includes(`/m/jaykay/release/${id}`), "every release keeps its own link " + id);
  assert.ok(!render(music({ music_releases: [] })).includes("/m/jaykay/release/"));
  assert.ok(!render(music({ music_releases: music().music_releases.map((r) => ({ ...r, available: false })) })).includes("/m/jaykay/release/"), "unavailable releases are not shown");
});

// ===== Music Artist Profile refinement: identity header, coloured socials, borders, and the Music / Merch / Tickets destinations =====
const Destination = load(path.join(SRC, "components/music/profile/MusicDestinationView.tsx")).default;
const MPH = jiti(path.join(SRC, "lib/music/profileMusic.ts"));
const dest = (kind, over = {}, lang = "en") => html(Destination, { kind, profile: music(over) }, lang);
await test("identity header: the artist name is a normal heading, the avatar and the cover are two separate images, the location sits above the name", () => {
  assert.ok(MPH.profileNameSize("Jay Kay") <= 40 && MPH.profileNameSize("A Very Long Artist Name Indeed And More") <= 28 && MPH.profileNameSize("Jay Kay") >= MPH.profileNameSize("A Very Long Artist Name Indeed And More"), "responsive, never a poster headline");
  const h = render(music({ avatar_url: "/avatar.png", cover_image_url: "/cover.png", about_location: "Douala" }));
  assert.ok(h.includes('src="/cover.png"') && h.includes('src="/avatar.png"'), "both images are used, each in its own place");
  assert.ok(h.indexOf('src="/cover.png"') < h.indexOf('src="/avatar.png"'), "the cover first, the avatar hanging off it");
  assert.ok(/font-size:(40|36|32|28)px/.test(h), "the name is 28-40px");
  assert.ok(h.indexOf("Douala") < h.indexOf("<h1"), "the location line sits above the name");
  assert.ok(!render(music({ avatar_url: null, cover_image_url: null })).includes("undefined"), "no images: no broken markup");
  assert.ok(render(music({ avatar_url: null })).includes('src="/default-avatar.png"'), "no avatar falls back to Ringo's own default avatar");
  assert.ok(!render(music({ cover_image_url: null, avatar_url: "/avatar.png" })).includes('object-[50%_30%]'), "no cover: the avatar is NOT stretched into a hero (a tinted ground is shown)");
});
await test("social icons are recognisable: each platform keeps its own colour (restrained tint + hairline), not a monochrome placeholder", () => {
  const h = render(music({ social_links: ["instagram", "facebook", "tiktok", "youtube", "x"].map((p, i) => ({ id: "s" + i, platform: p, url: `https://${p}.com/jaykay` })) }));
  for (const c of ["#F2557F", "#4C97FF", "#25F4EE", "#FF3B3B", "#F5F5F5"]) assert.ok(h.includes(`color:${c}`), "brand colour " + c);
  assert.ok(h.includes("color-mix(in srgb, #4C97FF 13%, transparent)") && h.includes("color-mix(in srgb, #4C97FF 42%, transparent)"), "a faint tint and a hairline of the same colour");
  assert.ok(h.includes('aria-label="facebook"') && h.includes('href="https://facebook.com/jaykay"'), "named, real links");
});
await test("Play: songs say Play / Lecture (an icon button), never 'Preview 10 sec'; the price and Buy sit beside it in FCFA", () => {
  const en = visible(render(music()));
  const fr = visible(render(music(), "fr"));
  assert.ok(en.includes("Play") && en.includes("500 FCFA"), "EN: Play and the real price");
  assert.ok(fr.includes("Lecture") && fr.includes("500 FCFA"), "FR: Lecture and the real price");
  assert.ok(!en.concat(fr).some((x) => /preview|aperçu|extrait|10 ?s/i.test(x)), "no preview wording in the UI text");
  const sections = strip(raw("src/components/music/profile/MusicSections.tsx"));
  assert.ok(!/MAX_PREVIEW_SECONDS|previewHint|musicProfile\.preview\(|playPreview/.test(sections), "the sections no longer explain the restriction");
  assert.ok(/MAX_PREVIEW_SECONDS/.test(strip(raw("src/components/music/useTrackPlayback.ts"))), "the limit itself still lives in the playback hook");
});
await test("borders: one border token, applied to song, release, merch, link, gift, about and ticket cards", () => {
  const theme = strip(raw("src/components/music/profile/musicTheme.ts"));
  assert.match(theme, /border: "rgba\(243,233,220,0\.13\)"/);
  const sec = strip(raw("src/components/music/profile/MusicSections.tsx"));
  assert.ok((sec.match(/borderColor: MP\.border/g) || []).length >= 6, "the one token is what the cards use");
  const h = render(music());
  assert.ok((h.match(/border-color:rgba\(243,233,220,0\.13\)/g) || []).length >= 6, "rendered on the cards");
  assert.ok(h.includes("box-shadow:0 0 0 1px rgba(243,233,220,.22)"), "the ticket stubs carry a hairline too");
  assert.ok(!/border-b py-3/.test(sec), "the floating divider rows are gone");
});
await test("destinations: the profile offers Music / Merch / Tickets as links to their own pages (never an in-page scroll), and only for what exists", () => {
  const h = render(music());
  for (const href of ["/m/jaykay/music", "/m/jaykay/merch", "/m/jaykay/tickets"]) assert.ok(h.includes(`href="${href}"`), href);
  assert.ok(h.includes('aria-label="Artist pages"'), "a named navigation");
  assert.ok(!h.includes("#tickets") && !h.includes('href="#music"') && !h.includes('href="#merch"'), "no scroll anchors");
  const bare = render(music({ products: [], events: [], tracks: [], music_releases: [] }));
  assert.ok(!bare.includes("/m/jaykay/merch") && !bare.includes("/m/jaykay/tickets") && !bare.includes("/m/jaykay/music"), "nothing to show means no link");
  const fr = render(music(), "fr");
  assert.ok(fr.includes(">Musique<") && fr.includes(">Billets<"), "FR labels");
  for (const k of ["music", "merch", "tickets"]) {
    const f = path.join(SRC, `app/m/[username]/${k}/page.tsx`);
    assert.ok(fs.existsSync(f), `route ${k} exists`);
    const src = strip(fs.readFileSync(f, "utf8"));
    assert.match(src, /loadMusicDestination\(params\.username\)/);
    assert.match(src, /export \{ generateMetadata, generateViewport \} from "@\/lib\/profileMetadata"/, "SEO / PWA metadata like every public profile route");
  }
});
await test("Music page: artwork, albums & EPs, singles / songs with Play and Buy in FCFA, links into the existing item pages and checkout", () => {
  const h = dest("music");
  const t = visible(h);
  assert.ok(t.includes("Music") && t.includes("Albums & EPs") && t.includes("All songs"), "its own structure");
  assert.ok(h.includes("/m/jaykay/release/r1") && h.includes("/m/jaykay/track/t1") && h.includes("/m/jaykay/track/t2"), "item pages");
  assert.ok(h.includes('aria-label="Play: Ndole"') && h.includes('aria-label="Buy My Era, 500 FCFA"'), "Play and Buy");
  assert.ok(h.includes("3,000 FCFA") && h.includes("1,500 FCFA") && !/GH₵|GHS/.test(h), "XAF / FCFA only");
  assert.ok(h.includes('href="/jaykay"') && h.includes('aria-label="Artist pages"') && h.includes('aria-current="page"'), "the way back to the profile, and where you are");
  assert.ok(!/<audio|protected_audio_path/.test(h), "no audio is shipped in the page");
  assert.ok(h.includes("--mp-accent:#D4A954") && h.includes("background:#120B10"), "same palette and the creator's accent");
});
await test("Merch page: products with images, prices and availability, linking to the existing merch pages; a calm empty state", () => {
  const h = dest("merch");
  assert.ok(visible(h).includes("Merch") && visible(h).includes("1 item"), "header and count");
  assert.ok(h.includes("/m/jaykay/merch/m1") && h.includes('src="/h.png"') && h.includes("12,000 FCFA") && visible(h).includes("AVAILABLE"), "product, image, price, availability");
  const sold = dest("merch", { products: [{ id: "m1", profile_id: "p1", name: "Hoodie", price: 12000, image_url: "/h.png", available: true, inventory_count: 0 }] });
  assert.ok(visible(sold).some((x) => /^sold out$/i.test(x)), "sold out is said");
  const none = dest("merch", { products: [] });
  assert.ok(visible(none).includes(translations.en.musicProfile.emptyMerch) && none.includes('href="/jaykay"'), "empty state, with the way back");
  assert.ok(!/cart|checkout|fapshi/i.test(strip(raw("src/components/music/profile/MusicDestinationView.tsx"))), "no second checkout: purchases open the existing item pages");
});
await test("Merch page analytics: a product tap goes through the existing /api/track mechanism (same body as the profile and the product page), not a second system", () => {
  const v = strip(raw("src/components/music/profile/MusicDestinationView.tsx"));
  assert.match(v, /fetch\("\/api\/track"/, "the existing endpoint");
  assert.match(v, /import \{ newEventId \} from "@\/lib\/pixelClient"/, "the existing event-id helper");
  assert.match(v, /profileId: profile\.id,\s*targetType,\s*targetId: targetId \?\? null,\s*eventId: newEventId\(\),\s*contentName: content\?\.name \?\? null,/, "the same payload ProfileView sends");
  assert.ok(!/noClick|fbq|ttq|click_events|supabase/.test(v), "no no-op logger, no private pixel code, no direct database write");
  assert.equal((v.match(/logClick=\{logClick\}/g) || []).length, 2, "both the lead product and the grid are tracked");
  assert.match(v, /logClick\("product", product\.id, \{ name: product\.name/, "the lead card logs a product click");
  assert.match(strip(raw("src/components/music/profile/MusicSections.tsx")), /onClick=\{\(\) => logClick\("product", p\.id/, "and so does every grid card");
  const before = strip(raw("src/components/ProfileView.tsx"));
  assert.match(before, /fetch\("\/api\/track"/, "ProfileView's own tracking is untouched");
  assert.equal(git("diff --name-only HEAD -- src/app/api src/lib/pixelClient.ts src/lib/pixelEvents.ts src/lib/pixelTracking.ts").split("\n").filter((f) => f.trim() && f.trim() !== "src/app/api/admin/branding/route.ts").join(","), "", "the analytics implementation itself is unchanged");
});
await test("Tickets page: the next event leads with its artwork, date, venue and price; the rest follow; past events are separated; empty state", () => {
  const two = [
    { id: "e1", title: "Release party", event_date: "2099-12-05", event_time: "20:00", location: "Douala", price: 3000, status: "published", cover_image_url: "/e1.png", event_ticket_types: [] },
    { id: "e2", title: "Open stage", event_date: "2099-12-20", event_time: "19:00", location: "Yaoundé", price: 2000, status: "published", event_ticket_types: [] },
    { id: "e3", title: "Old gig", event_date: "2020-01-01", location: "Kribi", price: 1000, status: "completed", event_ticket_types: [] },
  ];
  const h = dest("tickets", { events: two });
  const t = visible(h);
  assert.ok(t.includes("Tickets") && t.includes("Next up") && t.includes("Upcoming") && t.includes("Past and cancelled"), "its own structure");
  assert.ok(h.includes('src="/e1.png"') && h.includes("/m/jaykay/ticket/e1") && t.includes("Douala") && h.includes("3,000 FCFA"), "artwork, route, venue, price");
  assert.ok(h.indexOf("Release party") < h.indexOf("Open stage") && h.indexOf("Open stage") < h.indexOf("Old gig"), "soonest first, past last");
  assert.ok(visible(dest("tickets", { events: [] })).includes(translations.en.musicProfile.emptyTickets), "empty state");
  assert.ok(!dest("tickets", { events: [{ ...two[0], status: "draft" }] }).includes("Release party"), "a draft is never shown");
});
await test("destinations: EN/FR, the same keys in both languages, and only the artist's own data (no hard-coded artist, song, price or event)", () => {
  const fr = visible(dest("music", {}, "fr")).concat(visible(dest("merch", {}, "fr")), visible(dest("tickets", {}, "fr")));
  for (const w of ["The catalog", "Albums & EPs", "All songs", "Official store", "Next up", "Back to profile", "Upcoming"]) assert.ok(!fr.includes(w), "FR shows English: " + w);
  assert.ok(fr.includes("Musique") && fr.includes("Tous les titres") && fr.includes("Retour au profil"));
  const src = strip(raw("src/components/music/profile/MusicDestinationView.tsx")) + strip(raw("src/components/music/profile/MusicNav.tsx")) + strip(raw("src/lib/music/loadDestination.ts"));
  assert.ok(!/GH₵|GHS|Jay Kay|Afrobeat|\b\d{3,}\s?(FCFA|XAF)/.test(src), "no reference data in production code");
  assert.match(strip(raw("src/lib/music/loadDestination.ts")), /\.eq\("published", true\)/, "only published profiles");
  assert.match(strip(raw("src/lib/music/loadDestination.ts")), /isPublicProfileSuspended/, "a suspended owner stays hidden");
  assert.match(strip(raw("src/lib/music/loadDestination.ts")), /music_entertainment/, "Music category only");
});

await test("profile picture shape: round by default everywhere; a profile that chose square gets a soft rounded square (Ringo radius tokens) on the public page, the Music profile and the Music pages", () => {
  const sq = { avatar_shape: "square" };
  const gen = render(generic());
  assert.ok(gen.includes("rounded-full ring-4") && gen.includes("animate-ring-pulse-1"), "no choice: round, exactly as before");
  assert.ok(render(generic({ avatar_shape: "round" })) === gen, "an explicit 'round' renders byte-for-byte like no choice");
  for (const bad of ["nonsense", "", null, "SQUARE", 7]) assert.ok(render(generic({ avatar_shape: bad })) === gen, "invalid value falls back to round: " + String(bad));
  const gsq = render(generic(sq));
  assert.ok(gsq.includes("rounded-ringo-lg ring-4"), "a square picture on any other category: soft square, not sharp");
  assert.ok(!gsq.includes("rounded-full ring-4") && !/<span[^>]*rounded-full[^>]*animate-ring-pulse/.test(gsq), "and no circle is drawn around it");
  assert.ok(/<span[^>]*rounded-ringo-lg[^>]*animate-ring-pulse-1/.test(gsq) && /<span[^>]*rounded-ringo-lg[^>]*animate-ring-pulse-2/.test(gsq), "the pulse keeps its motion, now shaped to the square");
  const img = (h) => (h.match(/<img[^>]*src="\/a\.png"[^>]*>/) || [""])[0];
  assert.ok(/rounded-ringo-lg/.test(img(render(music(sq)))) && !/rounded-full/.test(img(render(music(sq)))), "Music profile: soft square");
  assert.ok(/rounded-full/.test(img(render(music()))), "Music profile: round by default");
  assert.ok(/rounded-ringo-sm/.test(img(dest("music", sq))) && /rounded-full/.test(img(dest("music"))), "Music page");
  assert.ok(/rounded-ringo-sm/.test(img(dest("merch", sq))) && /rounded-ringo-sm/.test(img(dest("tickets", sq))), "Merch and Tickets pages");
  const portrait = (h) => (h.match(/<img[^>]*width="112"[^>]*>/) || [""])[0];
  assert.ok(portrait(render(music({ about_long_bio: "Bio", ...sq }))) !== "" && portrait(render(music({ about_long_bio: "Bio", ...sq }))) === portrait(render(music({ about_long_bio: "Bio" }))), "the Music About portrait is unaffected by the choice");
});
// ------------------------------------------------------------------ Gift the Artist (and no leakage between languages)
await test("Gift the Artist: the approved wording on the public Music profile (EN and FR), no 'Support' wording, no emoji, the same checkout route", () => {
  const en = render(music(), "en");
  const fr = render(music(), "fr");
  assert.equal(translations.en.music.supportTitle, "Gift the Artist");
  assert.equal(translations.fr.music.supportTitle, "Offrir un cadeau à l'artiste");
  assert.equal(translations.en.musicProfile.giftEyebrow, "Gift the Artist");
  assert.equal(translations.fr.musicProfile.giftEyebrow, "Offrir un cadeau à l'artiste");
  assert.ok(en.includes("Gift the Artist") && fr.includes("Offrir un cadeau à l'artiste"));
  assert.ok(!/Support the Artist|Soutenir l'artiste|>Support<|>Soutenir</.test(en + fr), "no 'Support' wording in either language");
  assert.ok(!/[❤♥\u{1F300}-\u{1FAFF}]/u.test(visible(en).join(" ") + visible(fr).join(" ")), "no emoji");
  assert.ok(en.includes("/m/jaykay?support=1000") && fr.includes("/m/jaykay?support=1000"));
  assert.ok(en.includes("1,000 FCFA") && fr.includes("1 000 FCFA"), "gift amounts in FCFA, formatted per language");
  assert.ok(!/GH₵|GHS|\$|€/.test(visible(en).join(" ") + visible(fr).join(" ")), "no foreign currency");
  const s = render(music({ pinned_type: "support", pinned_id: null }), "en");
  assert.ok(s.includes('aria-label="Featured"') && s.includes("Gift"), "a pinned Gift leads the page");
});
await test("no language leakage: the French Music profile has no English UI text, and the English one has no French; musicProfile has the same keys in both", () => {
  const fr = visible(render(music(), "fr"));
  const en = visible(render(music(), "en"));
  const enOnly = (k) => translations.en.musicProfile[k] && typeof translations.en.musicProfile[k] === "string" && translations.en.musicProfile[k] !== translations.fr.musicProfile[k] && translations.en.musicProfile[k] !== "Artist"; // "Artist" is also the fixture's saved position text (data, not UI)
  for (const k of Object.keys(translations.en.musicProfile).filter(enOnly)) {
    assert.ok(!fr.includes(translations.en.musicProfile[k]), "FR shows the English " + k + ": " + translations.en.musicProfile[k]);
    assert.ok(!en.includes(translations.fr.musicProfile[k]), "EN shows the French " + k + ": " + translations.fr.musicProfile[k]);
  }
  for (const word of ["Preview 10s", "Buy music", "Book Artist", "Save", "Call", "Songs", "Tickets"]) assert.ok(!fr.some((x) => x === word), "FR shows the English '" + word + "'");
  for (const word of ["Extrait 10 s", "Acheter la musique", "Réserver l'artiste", "Enregistrer", "Appeler", "Billets"]) assert.ok(!en.some((x) => x === word), "EN shows the French '" + word + "'");
  assert.ok(!/aria-label="(Play|Pause|Share)"/.test(render(music(), "fr")), "no hard-coded English Play / Pause / Share in French");
  assert.equal(JSON.stringify(Object.keys(translations.en.musicProfile).sort()), JSON.stringify(Object.keys(translations.fr.musicProfile).sort()), "musicProfile: the same keys in both languages");
  assert.equal(JSON.stringify(Object.keys(translations.en.music).sort()), JSON.stringify(Object.keys(translations.fr.music).sort()), "music: the same keys in both languages");
});
await test("translations: the redesign only ADDS the musicProfile namespace; no existing translation line is rewritten", () => {
  // The dictionaries are two modules now (performance project); legacyTranslationsSource() rebuilds the old single file from them, line for line.
  const base = git("show 5a5f8bc:src/lib/i18n/translations.ts").replace(/\r\n/g, "\n").split("\n");
  const now = legacyTranslationsSource().replace(/\r\n/g, "\n").split("\n");
  const count = (lines) => lines.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const have = count(now);
  const removed = [...count(base)].filter(([l, n]) => (have.get(l) || 0) < n).map(([l]) => l);
  assert.deepEqual(removed, [], "nothing removed or rewritten");
  const baseCount = count(base);
  const added = now.filter((l) => (baseCount.get(l) || 0) === 0);
  assert.ok(added.length > 0 && added.some((l) => /musicProfile:/.test(l)), "the musicProfile namespace is added");
});
await test("accessibility (source): every interactive control in the redesign is named, ghost social icons are 48px with a visible focus ring, the page respects reduced motion", () => {
  const s = strip(raw("src/components/music/profile/MusicSections.tsx"));
  assert.match(s, /focus-visible:outline-\[var\(--mp-accent\)\]/, "a visible accent focus ring");
  assert.match(s, /aria-label=\{/, "named controls");
  assert.match(strip(raw("src/components/SocialIcon.tsx")), /h-12 w-12/, "48px ghost social icons");
  assert.match(strip(raw("src/components/ProfileView.tsx")), /<MotionConfig reducedMotion="user">/);
  assert.ok(!/animate-ring-pulse|infinite/.test(strip(raw("src/components/music/profile/MusicArtistView.tsx"))), "no looping animation on the Music page");
});
// ------------------------------------------------------------------ the Music experience (rendered, EN and FR)
// ------------------------------------------------------------------ Gift the Artist (and no leakage between languages)
// ------------------------------------------------------------------ accessibility and responsive source guards
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
  assert.equal(git(`diff --stat ${PHASE3_BASE} -- src/components/connect ":(exclude)src/components/connect/ConnectButton.tsx" ":(exclude)src/components/connect/StayConnectedModal.tsx"`).trim(), "", "Stay Connected is untouched (ConnectButton.tsx only changed look: the UX refinement phase; its behaviour is pinned in heroAction.test.mjs)");
  // Phase 3B: the restaurant hero and menu teaser changed ONLY in the text colour on the accent (readableOn instead of fixed white) and an 11px badge.
  const rest = phase3Diff("-U0", "-- src/components/restaurant").split("\n").filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+)/.test(l));
  assert.ok(rest.every((l) => /readableOn|#fff|lib\/color|text-\[(9|11)px\]|icon: Phone, label: (\"Call\"|t\.profilePage\.callButton)/.test(l)), "restaurant: colour and size only: " + rest.join(" | "));
});
await test("scope: no auth, payment, commission, payout, inventory, booking, ticketing, API, database, SEO, routing, package or profile-page file changed", () => {
  const changed = phase3Diff("--name-only").split("\n").filter(Boolean).filter((f) => !PHASE12_FILES.has(f)); // Phase 3B files are pinned by their own list
  const protectedPath = /^(package(-lock)?\.json|tsconfig\.tsbuildinfo|\.env|supabase\/|migrations\/|src\/middleware\.ts|src\/app\/|src\/lib\/(auth|billing|payments?|productCheckout|fapshi|stripe|shop|settlement|reports|inventory|music|ticket|booking|publicContent|sectionOrder|heroAction|seo|categories|branding|brandingDefaults)|src\/components\/(checkout|dashboard|auth|catalog|editor|restaurant|connect|landing|overview|BookingButton|WhatsAppButton|SocialIcon)|src\/components\/music\/(useTrackPlayback|ItemDetailPage|MusicStorePage|MusicTabs|Music(Orders|Sales|Earnings|Customers|Overview|Receipt)|ReceiptPageView|TicketPassView|EventCheckinDashboard))/;
  assert.deepEqual(changed.filter((f) => protectedPath.test(f)), []);
  assert.deepEqual(changed.filter((f) => !isPhase2File(f)), [], "every changed file is on the allowlist");
  assert.deepEqual(changed.filter((f) => !PHASE11_FILES.has(f)), [], "and every changed file belongs to Phase 3A (3B has its own list)");
});
await test("no dependency, no image payload, no canvas / WebGL / video, no new package: the profile stays light", () => {
  const touchedPackageFiles = git(`diff --name-only ${PHASE3_BASE} -- package.json package-lock.json tsconfig.tsbuildinfo`).split("\n").map((x) => x.trim()).filter(Boolean);
  assert.deepEqual(touchedPackageFiles.filter((f) => !isPhase16ProtectedFile(f)), []); // the security phase's next / sharp bump is proven separately (securityPhase1.test.mjs)
  const all = ["components/ProfileView.tsx", "components/music/PinnedSpotlight.tsx", "components/music/ReleasesSection.tsx", "lib/profileStage.ts"].map((f) => strip(raw("src/" + f))).join("\n");
  assert.ok(!/<canvas|webgl|three|\.mp4|<video|lottie|requestAnimationFrame|setInterval/i.test(all));
  assert.ok(!/ReleasesSection[\s\S]*<img[^>]*loading="eager"/.test(all));
});

console.log(`\nmusicProfile: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
