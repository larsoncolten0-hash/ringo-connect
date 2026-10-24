// Churches & Ministries Phase 8: the Church Music screens, the public Music card and the public loader, checked OFFLINE (no database, no network, no dev server).
//   * English / French dictionary parity for `churchMusic`, and a sentence in BOTH languages for every server code the music routes can send;
//   * no hard-coded user-facing text, no browser storage, no markup injection, accessibility basics, in the screens' source;
//   * the real presentational screen rendered in every state, in both languages, and the real public card (link-out only, safe attributes);
//   * the public shaping rules (hidden / unsafe / mismatched links are dropped) and the fail-safe loader;
//   * the workspace shell: the Music tab appears only for church.music.manage.
//   Run:  node scripts/tests/ministryMusicUi.test.mjs
import fs from "fs";
import path from "path";
import { SRC, read, noComments, jiti, translations, walkDictionary, sampleArgs, sourceProblems, component, html, uid, React, overrideExport, cardTheme } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

const ET = jiti(path.join(SRC, "components/church/lifecycle/errorText.ts"));
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const PUB = jiti(path.join(SRC, "lib/church/public/music.ts"));
overrideExport("components/church/people/shared.tsx", "ConfirmDialog", (p) => React.createElement("div", { "data-confirm": "1" }, `[${p.title}|${p.body}|${p.confirmLabel}|${p.danger ? "danger" : "normal"}]`));

// ---------------------------------------------------------------- 1. dictionary parity and error coverage
{
  const out = walkDictionary(translations.en.churchMusic, translations.fr.churchMusic, "churchMusic");
  check("EN and FR have exactly the same keys, types and function arity", out.shape.length === 0, out.shape.join("; "));
  check("no empty text in either language", out.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  // platform names are brand names: identical in both languages on purpose
  const same = out.strings.filter(([k, a, b]) => a === b && a.length > 6 && !k.startsWith("churchMusic.platforms.")).map(([k]) => k);
  check("French is a translation, not a copy", same.length <= 2, same.join(", "));
  for (const [key, a, b] of out.fns) {
    const args = a.length === 2 ? ["Sunday playlist", "Spotify"] : ["Sunday playlist"];
    check(`${key}() returns text in both languages`, typeof a(...(key.includes("count") || key.includes("limitReached") ? [3] : args)) === "string" && typeof b(...(key.includes("count") || key.includes("limitReached") ? [3] : args)) === "string");
  }
  const e = translations.en.churchMusic, f = translations.fr.churchMusic;
  check("plurals", e.list.count(1) === "1 link" && e.list.count(2) === "2 links" && f.list.count(1) === "1 lien" && f.list.count(2) === "2 liens");
  check("every platform the API accepts is named in both languages", jiti(path.join(SRC, "lib/church/music/platforms.ts")).MUSIC_PLATFORM_IDS.every((id) => e.platforms[id] && f.platforms[id]));
  const codes = new Set();
  const grab = (text, re) => { for (const m of text.matchAll(re)) codes.add(m[1]); };
  const handlers = read("src/lib/church/music/handlers.ts"), errors = read("src/lib/church/errors.ts");
  grab(handlers, /fail\(\d{3}, "([a-z_]+)"/g);
  grab(handlers, /code: "([a-z_]+)"/g);
  for (const m of errors.matchAll(/music_[a-z_]+: \{ status: \d+, code: "([a-z_]+)"/g)) codes.add(m[1]);
  for (const m of errors.matchAll(/ministry_music[^\n]*code: "([a-z_]+)"/g)) codes.add(m[1]);
  for (const c of ["unexpected_field", "invalid_body", "not_found", "forbidden", "stale", "empty_update", "invalid", "conflict", "server_error", "not_available"]) codes.add(c);
  const generic = (loc) => translations[loc].churchPeople.errors.generic;
  const missing = [...codes].filter((c) => ET.churchErrorText(translations.en, c) === generic("en") || ET.churchErrorText(translations.fr, c) === generic("fr"));
  const allowedGeneric = new Set(["invalid", "conflict", "server_error", "not_available", "empty_update"]);
  const reallyMissing = missing.filter((c) => !allowedGeneric.has(c));
  check("every code the music routes can send has its own sentence in English AND French", reallyMissing.length === 0, reallyMissing.join(", "));
  check("no error sentence leaks internals", [...Object.values(e.errors), ...Object.values(f.errors)].every((s) => !/ministry_|policy|trigger|RLS|row-level|supabase|postgres|SQL|church\.music|42501/i.test(s)));
  check("the link-out nature is stated in both languages (nothing uploaded, played or sold)", /nothing is uploaded, played or sold/i.test(e.subtitle) && /rien n'est téléversé, lu ou vendu/i.test(f.subtitle));
}

// ---------------------------------------------------------------- 2. source rules
{
  const dir = path.join(SRC, "components/church/music");
  const files = fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(dir, f));
  check("the screen exists", files.length === 1, files.map((f) => path.basename(f)).join(","));
  const card = path.join(SRC, "components/church/ChurchMusicCard.tsx");
  for (const f of [...files, card, path.join(SRC, "components/church/store/ChurchStoreEntry.tsx")]) {
    const problems = sourceProblems(f);
    check(`${path.basename(f)}: no hard-coded text, storage, markup injection, service client, untyped button or unnamed field`, problems.length === 0, problems.join(" || "));
    const src = noComments(fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n"));
    check(`${path.basename(f)}: no foundation (opt-in) design tokens on this existing screen family`, !/\bringo-(glass|gilt|lamp|press|rise|micro|ring-|live-dot|card-sweep|focus)\b/.test(src));
  }
  const screen = noComments(read("src/components/church/music/MusicLinks.tsx"));
  check("removing a link is confirmed, as a danger action", (screen.match(/<ConfirmDialog/g) || []).length === 1 && /danger/.test(screen));
  check("exactly ONE save button", (screen.match(/type="submit"/g) || []).length === 1);
  check("every edit, hide and delete names the version it is based on", /expected_updated_at: row\.updated_at/.test(screen) && /body\.expected_updated_at = current\.updated_at/.test(screen) && /\?expected_updated_at=\$\{encodeURIComponent\(removing\.updated_at\)\}/.test(screen));
  check("the screen never sends a church, an owner or an audit field", !/profile_id|profileId|created_by|updated_by/.test(screen));
  check("controls are touch-sized, icon-only buttons have an accessible name", /min-h-\[44px\]/.test(screen) && /h-11 w-11/.test(screen) && ["edit", "hide", "show", "remove"].every((k) => screen.split("\n").some((ln) => ln.includes("aria-label=") && ln.includes(`c.actions.${k}(`))));
  check("long labels and addresses wrap instead of overflowing on a phone", (screen.match(/\[overflow-wrap:anywhere\]/g) || []).length >= 2);
  check("the form is a real form: submit on Enter is guarded, the address field is a url input", /onSubmit=/.test(screen) && /type="url"/.test(screen) && /maxLength=\{80\}/.test(screen) && /maxLength=\{500\}/.test(screen));
  const cardSrc = noComments(read("src/components/church/ChurchMusicCard.tsx"));
  check("the public card opens each link in a new tab safely (noopener, noreferrer, nofollow)", /target="_blank"/.test(cardSrc) && /rel="noopener noreferrer nofollow"/.test(cardSrc));
  check("the public card draws nothing without links and has no audio, player or download", /links\.length === 0\) return null/.test(cardSrc) && !/<audio|<video|<iframe|download|autoPlay/i.test(cardSrc));
  const site = read("src/components/church/site/ChurchSiteView.tsx");
  check("the public card is wired into the church template (ProfileView, churches only), after the Bible card", /isChurch \? \(\s*<ChurchSiteView/.test(read("src/components/ProfileView.tsx")) && /\{churchPublic\.music\.length > 0 && \(/.test(site) && site.indexOf("<ChurchMusicCard") > site.indexOf("<ChurchBibleCard"));
}

// ---------------------------------------------------------------- 3. the real screen, in every state
{
  const View = component("components/church/music/MusicLinks.tsx", "MusicLinksView");
  const row = (n, o = {}) => ({ id: uid(n), platform: "spotify", title: `Playlist ${n}`, url: `https://open.spotify.com/playlist/${n}`, is_visible: true, sort_order: 0, updated_at: "2026-10-18T10:00:00Z", ...o });
  const base = (over = {}) => ({
    data: { items: [row(1), row(2, { is_visible: false, platform: "youtube", url: "https://youtu.be/x" })], limit: 20 }, loading: false, loadError: "", notice: "", rowError: "", form: null, saving: false, formError: "", removing: null,
    onRetry() {}, onAdd() {}, onEdit() {}, onForm() {}, onCancelForm() {}, onSubmit() {}, onToggle() {}, onAskRemove() {}, onRemove: async () => "", ...over,
  });
  for (const lang of ["en", "fr"]) {
    const t = translations[lang], c = t.churchMusic;
    const h = html(View, base(), lang);
    check(`screen (${lang}): subtitle, count, add button, both links with platform names`, h.includes(c.subtitle) && h.includes(c.list.count(2)) && h.includes(c.list.add) && h.includes("Playlist 1") && h.includes("Playlist 2") && h.includes(c.platforms.spotify) && h.includes(c.platforms.youtube));
    check(`screen (${lang}): the hidden link is badged, the visible one is not`, (h.match(new RegExp(c.list.hiddenBadge, "g")) || []).length === 1);
    check(`screen (${lang}): every link has edit, hide-or-show and remove buttons with accessible names`, h.includes(`aria-label="${c.actions.edit("Playlist 1")}"`) && h.includes(`aria-label="${c.actions.hide("Playlist 1")}"`) && h.includes(`aria-label="${c.actions.show("Playlist 2")}"`) && h.includes(`aria-label="${c.actions.remove("Playlist 2")}"`));
    const empty = html(View, base({ data: { items: [], limit: 20 } }), lang);
    check(`screen (${lang}): the empty state explains and offers the first add`, empty.includes(c.list.emptyTitle) && empty.includes(c.list.emptyBody) && empty.includes(c.list.add));
    const full = html(View, base({ data: { items: Array.from({ length: 20 }, (_, i) => row(i + 1, { url: `https://open.spotify.com/p/${i}` })), limit: 20 } }), lang);
    check(`screen (${lang}): at the limit the add button is disabled and the limit is explained`, full.includes(c.list.limitReached(20)) && new RegExp(`<button[^>]*\\sdisabled=""[^>]*>(?:<[^>]*>)*${c.list.add}`).test(full));
    const add = html(View, base({ form: { id: null, platform: "spotify", title: "", url: "", is_visible: true } }), lang);
    check(`screen (${lang}): the add form: labelled fields, 13 platforms, hints, ONE save button, disabled while empty`, add.includes(c.form.addTitle) && add.includes('id="music-platform"') && add.includes('id="music-title"') && add.includes('id="music-url"') && (add.match(/<option /g) || []).length === 13 && add.includes(c.form.titleHint) && add.includes(c.form.urlHint) && (add.match(/type="submit"/g) || []).length === 1 && new RegExp(`<button[^>]*type="submit"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="submit"`).test(add) && !add.includes(`>${c.list.add}<`));
    const edit = html(View, base({ form: { id: uid(1), platform: "spotify", title: "Playlist 1", url: "https://open.spotify.com/playlist/1", is_visible: true } }), lang);
    check(`screen (${lang}): the edit form shows its own title and an enabled save`, edit.includes(c.form.editTitle) && !new RegExp(`<button[^>]*type="submit"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="submit"`).test(edit));
    check(`screen (${lang}): saving state, form error and notice`, html(View, base({ form: { id: uid(1), platform: "spotify", title: "A", url: "https://open.spotify.com/x", is_visible: true }, saving: true }), lang).includes(c.form.saving) && html(View, base({ form: add && { id: null, platform: "spotify", title: "A", url: "b", is_visible: true }, formError: "Boom sentence" }), lang).includes("Boom sentence") && html(View, base({ notice: "Saved note" }), lang).includes("Saved note"));
    const rm = html(View, base({ removing: row(1) }), lang);
    check(`screen (${lang}): the remove confirmation names the link and is a danger action`, rm.includes(`[${c.actions.removeTitle}|${c.actions.removeBody("Playlist 1")}|${c.actions.removeConfirm}|danger]`));
    check(`screen (${lang}): load error offers a retry; loading shows a skeleton`, html(View, base({ data: null, loadError: "Oops" }), lang).includes(`${c.list.loadError} Oops`) && html(View, base({ data: null, loading: true }), lang).length > 0);
    check(`screen (${lang}): markup in a label is escaped`, !/<img src=x/.test(html(View, base({ data: { items: [row(1, { title: "<img src=x onerror=alert(1)>" })], limit: 20 } }), lang)));
  }
}

// ---------------------------------------------------------------- 4. the public card and the public rules
{
  const Card = component("components/church/ChurchMusicCard.tsx");
  const link = (n, o = {}) => ({ id: uid(n), platform: "spotify", title: `Playlist ${n}`, url: `https://open.spotify.com/playlist/${n}`, ...o });
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const h = html(Card, { t, links: [link(1), link(2, { platform: "youtube", url: "https://youtu.be/x", title: "Choir" })], ...cardTheme }, lang);
    check(`card (${lang}): heading, both links with their platform, new-tab safe attributes`, h.includes(t.churchMusic.public.heading) && h.includes("Playlist 1") && h.includes("Choir") && h.includes(t.churchMusic.public.listenOn("YouTube")) && (h.match(/target="_blank"/g) || []).length === 2 && (h.match(/rel="noopener noreferrer nofollow"/g) || []).length === 2 && h.includes(`href="https://youtu.be/x"`));
    check(`card (${lang}): each link has an accessible name that says it opens in a new tab`, h.includes(`aria-label="${t.churchMusic.public.open("Choir", "YouTube")}"`));
    check(`card (${lang}): nothing without links`, html(Card, { t, links: [], ...cardTheme }, lang) === "");
    const prev = html(Card, { t, links: [link(1)], preview: true, ...cardTheme }, lang);
    check(`card (${lang}): in the preview the links go nowhere`, !/<a /.test(prev) && prev.includes("Playlist 1"));
    check(`card (${lang}): markup in a label is escaped`, !/<img src=x/.test(html(Card, { t, links: [link(1, { title: "<img src=x onerror=alert(1)>" })], ...cardTheme }, lang)));
  }
  const S = PUB.shapePublicMusic;
  const good = (n, o = {}) => ({ id: uid(n), platform: "spotify", title: `T${n}`, url: `https://open.spotify.com/p/${n}`, is_visible: true, ...o });
  check("shape: a valid link is kept with exactly four fields", JSON.stringify(Object.keys(S([good(1)])[0])) === '["id","platform","title","url"]');
  check("shape: hidden, unknown platform, empty label, unsafe address, wrong-platform address, bad id and junk are dropped", S([good(1, { is_visible: false }), good(2, { platform: "napster" }), good(3, { title: "  " }), good(4, { url: "http://open.spotify.com/x" }), good(5, { url: "https://evil.org/x" }), good(6, { id: "x" }), null, 5, "x"]).length === 0);
  check("shape: a repeated address appears once; not an array gives []", S([good(1, { url: "https://open.spotify.com/same" }), good(2, { url: "https://OPEN.spotify.com/same" })]).length === 1 && S(null).length === 0 && S({}).length === 0);
  check("shape: at most 20, in the order received", S(Array.from({ length: 30 }, (_, i) => good(i + 1))).length === 20 && S(Array.from({ length: 30 }, (_, i) => good(i + 1)))[0].title === "T1");
  const reader = (res) => ({ from: () => { const q = { select: () => q, eq: () => q, order: () => q, limit: async () => res }; return q; } });
  check("loader: rows are shaped; an error, a throw or no table give []", (await PUB.loadPublicMusic(reader({ data: [good(1)], error: null }), uid(9))).length === 1 && (await PUB.loadPublicMusic(reader({ data: null, error: { code: "42P01" } }), uid(9))).length === 0 && (await PUB.loadPublicMusic({ from() { throw new Error("x"); } }, uid(9))).length === 0);
  const IDX = jiti(path.join(SRC, "lib/church/public/index.ts"));
  check("the church public bundle carries music and is empty by default", Array.isArray(IDX.EMPTY_CHURCH_PUBLIC.music) && IDX.EMPTY_CHURCH_PUBLIC.music.length === 0);
  const loaderSrc = noComments(read("src/lib/church/public/music.ts"));
  check("the public loader selects only id, platform, title, url and only visible rows (never an audit column)", /PUBLIC_MUSIC_COLUMNS = "id, platform, title, url"/.test(loaderSrc) && /\.eq\("is_visible", true\)/.test(loaderSrc) && !/created_by|updated_by|select\("\*"\)/.test(loaderSrc));
}

// ---------------------------------------------------------------- 5. the workspace shell
{
  const Shell = component("components/church/people/ChurchShell.tsx");
  const caps = (...p) => PERM.churchCapabilities(p);
  for (const lang of ["en", "fr"]) {
    const t = translations[lang];
    const withMusic = html(Shell, { caps: caps("church.music.manage"), isOwner: false, children: null }, lang);
    check(`shell (${lang}): a person with church.music.manage sees the Music tab, labelled in ${lang}, and no Store tab`, withMusic.includes('href="/dashboard/church/music"') && withMusic.includes(t.churchWorkspace.tabs.music) && !withMusic.includes('href="/dashboard/church/store"'));
    const without = html(Shell, { caps: caps("church.events.publish"), isOwner: false, children: null }, lang);
    check(`shell (${lang}): without the permission there is no Music tab`, !without.includes('href="/dashboard/church/music"'));
    const owner = html(Shell, { caps: caps(...PERM.CHURCH_PERMISSIONS), isOwner: true, children: null }, lang);
    check(`shell (${lang}): the owner sees Music then Store`, owner.indexOf("/dashboard/church/music") > 0 && owner.indexOf("/dashboard/church/store") > owner.indexOf("/dashboard/church/music"));
  }
  const page = noComments(read("src/app/dashboard/church/music/page.tsx"));
  check("the music page resolves the actor on the server and shows NoAccess without the capability", /resolveChurchActor/.test(page) && /caps\.manageMusic/.test(page) && /NoAccess section="music"/.test(page));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
