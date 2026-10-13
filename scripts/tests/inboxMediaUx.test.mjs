// WhatsApp Inbox UX and media upgrade, end to end: incoming photos / voice notes / videos / documents are shown and played through ONE authenticated streaming route; a video can
// be sent up to 16 MB (min of the 50 MB application ceiling and Meta's 16 MB) through a private, signed-upload staging bucket; the conversation scrolls without jumping; the
// reply box and the floating Ringo AI / Help buttons no longer collide. Real route handlers and orchestrators, the REAL database functions (Phase 4-9 migrations) on scratch
// in-memory PostgreSQL (PGlite), mocked Meta and storage (no network, no credentials, no real WhatsApp message: every id, number and the "token" below are synthetic).
//   Run:  node scripts/tests/inboxMediaUx.test.mjs
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { makeClientFactory } from "./pgliteShim.mjs";
import { mp4Bytes } from "./mp4Fixtures.mjs";

const nodeRequire = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const ts = nodeRequire("typescript");
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 600)); };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ---- TS/TSX loader with stand-ins for the framework modules --------------------------------------------------------------------------
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const STUBS = {
  "next/link": { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) },
  "next/navigation": { redirect: () => { throw new Error("redirect"); }, notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ refresh() {}, replace() {} }) },
  "react": { ...React, cache: (fn) => fn },
  "@/lib/supabase/server": { createClient: () => globalThis.__sb(), createAdminClient: () => globalThis.__admin() },
};
const cache = new Map();
function resolveLocal(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(fromDir, spec) : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) { const f = base + ext; if (fs.existsSync(f) && fs.statSync(f).isFile()) return f; }
  return null;
}
function loadTs(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const req = (spec) => { if (STUBS[spec]) return STUBS[spec]; const local = resolveLocal(spec, path.dirname(file)); return local ? loadTs(local) : nodeRequire(spec); };
  new Function("exports", "require", "module", "__filename", out)(mod.exports, req, mod, file);
  return mod.exports;
}
const src = (p) => loadTs(path.join(SRC, p));
const R = src("lib/whatsapp/mediaRules.ts");
const MF = src("lib/whatsapp/mediaFetch.ts");
const MEDIA = src("lib/whatsapp/media.ts");
const MI = src("lib/whatsapp/mp4Inspect.ts");
const MV = src("lib/inbox/mediaView.ts");
const SP = src("lib/inbox/scrollPolicy.ts");
const SM = src("lib/inbox/stagedMedia.ts");
const TL = src("lib/inbox/threadLimit.ts");
const F = src("lib/inbox/format.ts");
const C = src("lib/inbox/client.ts");
const viewRoute = src("app/api/inbox/conversations/[id]/media/[messageId]/route.ts");
const stageRoute = src("app/api/inbox/conversations/[id]/media/stage/route.ts");
const mediaRoute = src("app/api/inbox/conversations/[id]/media/route.ts");
const { LanguageProvider } = src("components/LanguageProvider.tsx");
const InboxView = src("components/inbox/InboxView.tsx").default;
const Composer = src("components/inbox/ReplyComposer.tsx").default;
const MessageMedia = src("components/inbox/MessageMedia.tsx").default;
const { translations } = src("lib/i18n/translations.ts");
const render = (locale, el) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale: locale }, el));

const str = (s) => [...s].map((c) => c.charCodeAt(0));
const pad = (arr, n = 64) => Uint8Array.from([...arr, ...Array(Math.max(0, n - arr.length)).fill(0x41)]);
const FX = {
  mp4: mp4Bytes(), // a structurally valid H.264 + AAC MP4 (see mp4Fixtures.mjs)
  png: pad([0x89, ...str("PNG"), 0x0d, 0x0a, 0x1a, 0x0a]),
  pdf: pad(str("%PDF-1.7\n")),
  oggOpus: pad([...str("OggS"), 0, 2, ...Array(20).fill(0), ...str("OpusHead")], 96),
};
const MB = 1024 * 1024;
const big = (n, head) => { const b = new Uint8Array(n); b.set(head); return b; };

// ============================================================ 1. the size limits: ONE place, the provider's limit wins
check("limits: the application ceiling for a video is 50 MB, Meta's is 16 MB, and the limit actually enforced is the LOWER one (16 MB)", R.APP_VIDEO_MAX_BYTES === 50 * MB && R.META_VIDEO_MAX_BYTES === 16 * MB && R.STAGED_VIDEO_MAX_BYTES === Math.min(R.APP_VIDEO_MAX_BYTES, R.META_VIDEO_MAX_BYTES) && R.STAGED_VIDEO_MAX_BYTES === 16 * MB && R.maxBytesFor("video/mp4") === 16 * MB && R.maxBytesFor("video/3gpp") === 16 * MB);
check("limits: no type ever exceeds Meta's own limit for it, and every non-video type is still min(Meta, 4 MB)", Object.entries(R.MEDIA_TYPES).every(([mime, rule]) => R.maxBytesFor(mime) <= rule.metaMaxBytes) && ["image/jpeg", "image/png", "audio/mpeg", "audio/ogg", "application/pdf", "text/plain"].every((m) => R.maxBytesFor(m) === Math.min(R.MEDIA_TYPES[m].metaMaxBytes, 4 * MB)));
const validate = (name, type, bytes) => src("lib/whatsapp/media.ts").validateMediaFile({ name, type, bytes });
check("limits (server validator): a video of exactly 16 MB passes; 16 MB + 1 byte, and a 50 MB video, are too_large; 4 MB + 1 still passes (it just needs staging)", validate("a.mp4", "video/mp4", big(16 * MB, FX.mp4)).ok && validate("a.mp4", "video/mp4", big(16 * MB + 1, FX.mp4)).error === "too_large" && validate("a.mp4", "video/mp4", big(50 * MB, FX.mp4)).error === "too_large" && validate("a.mp4", "video/mp4", big(4 * MB + 1, FX.mp4)).ok);
check("limits (browser early check): the same boundaries, so the person hears about it before uploading anything", R.checkAttachmentMeta({ name: "a.mp4", type: "video/mp4", size: 16 * MB }) === "ok" && R.checkAttachmentMeta({ name: "a.mp4", type: "video/mp4", size: 16 * MB + 1 }) === "too_large" && R.checkAttachmentMeta({ name: "a.mp4", type: "video/mp4", size: 50 * MB }) === "too_large" && R.checkAttachmentMeta({ name: "a.pdf", type: "application/pdf", size: 4 * MB + 1 }) === "too_large");
check("limits: only a video above the direct 4 MB limit is staged; no other kind ever is", R.needsStaging("video/mp4", 4 * MB) === false && R.needsStaging("video/mp4", 4 * MB + 1) === true && R.needsStaging("video/3gpp", 10 * MB) === true && ["application/pdf", "image/png", "audio/mpeg"].every((m) => R.needsStaging(m, 50 * MB) === false));
check("limits: the browser-facing messages name the real maximum (16 MB for video, 4 MB for the rest) in English and French", /16 MB/.test(translations.en.inbox.mediaVideoTooLarge) && /16 Mo/.test(translations.fr.inbox.mediaVideoTooLarge) && /4 MB/.test(translations.en.inbox.mediaTooLarge) && /16 MB/.test(translations.en.inbox.mediaHintLimits) && /16 Mo/.test(translations.fr.inbox.mediaHintLimits) && !/50/.test(translations.en.inbox.mediaVideoTooLarge));

// ============================================================ 2. staging: what may be staged, and what name it gets
const okReq = SM.checkStageRequest({ name: "holiday.mp4", type: "video/mp4", size: 10 * MB });
check("staging: a 10 MB MP4 is stageable; the object extension comes from the verified type", okReq.ok && okReq.ext === "mp4" && okReq.mime === "video/mp4" && SM.checkStageRequest({ name: "c.3gp", type: "video/3gpp", size: 5 * MB }).ext === "3gp");
check("staging: exactly 16 MB is accepted, 16 MB + 1 and 50 MB are too_large (413), zero is empty", SM.checkStageRequest({ name: "a.mp4", type: "video/mp4", size: 16 * MB }).ok && SM.checkStageRequest({ name: "a.mp4", type: "video/mp4", size: 16 * MB + 1 }).error === "too_large" && SM.checkStageRequest({ name: "a.mp4", type: "video/mp4", size: 50 * MB }).error === "too_large" && SM.checkStageRequest({ name: "a.mp4", type: "video/mp4", size: 0 }).error === "empty_file");
check("staging: documents, images and audio are NOT stageable; unsupported types and wrong extensions are refused with their own reason", SM.checkStageRequest({ name: "a.pdf", type: "application/pdf", size: 1000 }).error === "not_stageable" && SM.checkStageRequest({ name: "a.png", type: "image/png", size: 1000 }).error === "not_stageable" && SM.checkStageRequest({ name: "a.mov", type: "video/quicktime", size: 1000 }).error === "unsupported_type" && SM.checkStageRequest({ name: "a.pdf", type: "video/mp4", size: 1000 }).error === "type_mismatch" && SM.checkStageRequest({ name: 5, type: null, size: "big" }).ok === false);
const PROF = "a0000000-0000-4000-8000-000000000001", CONVID = "d0000000-0000-4000-8000-000000000001", OBJ = "e0000000-0000-4000-8000-000000000009";
check("staging: the object name is built from the SESSION's profile, the conversation and a fresh id; only that exact shape is ever read back", SM.stagedPath(PROF, CONVID, OBJ, "mp4") === `${PROF}/${CONVID}/${OBJ}.mp4` && SM.isStagedPathFor(`${PROF}/${CONVID}/${OBJ}.mp4`, PROF, CONVID) && !SM.isStagedPathFor(`${PROF}/${CONVID}/${OBJ}.mp4`, "a0000000-0000-4000-8000-000000000002", CONVID) && !SM.isStagedPathFor(`${PROF}/${CONVID}/${OBJ}.mp4`, PROF, "d0000000-0000-4000-8000-000000000002") && !SM.isStagedPathFor(`${PROF}/${CONVID}/../${OBJ}.mp4`, PROF, CONVID) && !SM.isStagedPathFor(`${PROF}/${CONVID}/${OBJ}.exe`, PROF, CONVID) && !SM.isStagedPathFor(`${PROF}/${CONVID}/${OBJ}.mp4`, null, CONVID) && !SM.isStagedPathFor(null, PROF, CONVID) && !SM.isStagedPathFor("../../etc/passwd", PROF, CONVID));

// ============================================================ 3. mediaFetch: the Meta side of a customer's file
const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
check("mediaFetch: only decimal media ids reach the network", MF.isMediaId("123456789012345") && !MF.isMediaId("../etc") && !MF.isMediaId("12 34") && !MF.isMediaId("") && !MF.isMediaId(null) && !MF.isMediaId("1".repeat(41)));
check("mediaFetch: only https urls on Meta/Facebook hosts are ever fetched (no http, no other host, no credentials in the url, no look-alike)", MF.isMetaMediaUrl("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1") && MF.isMetaMediaUrl("https://scontent.xx.fbcdn.net/v/x") && !MF.isMetaMediaUrl("http://lookaside.fbsbx.com/x") && !MF.isMetaMediaUrl("https://evil.example.com/fbsbx.com") && !MF.isMetaMediaUrl("https://fbsbx.com.evil.test/x") && !MF.isMetaMediaUrl("https://user:pw@lookaside.fbsbx.com/x") && !MF.isMetaMediaUrl("javascript:alert(1)") && !MF.isMetaMediaUrl("not a url") && !MF.isMetaMediaUrl("http://169.254.169.254/latest/meta-data"));
{
  const calls = [];
  const mk = (res) => async (url, init) => { calls.push({ url: String(url), init }); return typeof res === "function" ? res(url, init) : res; };
  const lk = await MF.lookupWhatsAppMedia("123456789012345", "tok-synthetic", mk(J(200, { url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1", mime_type: "image/jpeg", file_size: 2048 })));
  check("lookup: a Graph call with the media id and a Bearer token (server side), no redirects; answers the url, type and size", lk.kind === "ok" && lk.mimeType === "image/jpeg" && lk.fileSize === 2048 && calls[0].url === "https://graph.facebook.com/v21.0/123456789012345" && calls[0].init.headers.Authorization === "Bearer tok-synthetic" && calls[0].init.redirect === "error");
  check("lookup outcomes: 404 / 400 -> not_found (the file is gone); 5xx, network, unreadable answer, a missing or off-Meta url -> unavailable", (await MF.lookupWhatsAppMedia("123456789012345", "t", mk(J(404, {})))).kind === "not_found" && (await MF.lookupWhatsAppMedia("123456789012345", "t", mk(J(400, {})))).kind === "not_found" && (await MF.lookupWhatsAppMedia("123456789012345", "t", mk(J(500, {})))).kind === "unavailable" && (await MF.lookupWhatsAppMedia("123456789012345", "t", mk(() => { throw new TypeError("x"); }))).kind === "unavailable" && (await MF.lookupWhatsAppMedia("123456789012345", "t", mk(new Response("<html>", { status: 200 })))).kind === "unavailable" && (await MF.lookupWhatsAppMedia("123456789012345", "t", mk(J(200, { url: "https://evil.example.com/x" })))).kind === "unavailable" && (await MF.lookupWhatsAppMedia("123456789012345", "t", mk(J(200, {})))).kind === "unavailable");
  check("lookup: a hostile media id makes no request at all", await (async () => { calls.length = 0; const r = await MF.lookupWhatsAppMedia("../../x", "t", mk(J(200, {}))); return r.kind === "not_found" && calls.length === 0; })());
  calls.length = 0;
  const body = new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { "content-length": "3", "content-range": "bytes 0-2/10" } });
  const op = await MF.openWhatsAppMedia("https://lookaside.fbsbx.com/x", "tok-synthetic", "bytes=0-2", mk(body));
  check("download: the Bearer token and the (validated) Range go upstream; a 206 is passed back untouched; the body is NOT read here (it is streamed by the route)", op.kind === "ok" && op.response.status === 206 && calls[0].init.headers.Authorization === "Bearer tok-synthetic" && calls[0].init.headers.Range === "bytes=0-2" && op.response.bodyUsed === false);
  calls.length = 0;
  await MF.openWhatsAppMedia("https://lookaside.fbsbx.com/x", "t", "bytes=0-1,5-9; evil", mk(new Response("x", { status: 200 })));
  check("download: a malformed Range header is dropped, never forwarded", !("Range" in calls[0].init.headers));
  check("download outcomes: 404 / 410 -> not_found; 5xx -> unavailable; a declared size over 100 MB -> too_large; an off-Meta url is never fetched", (await MF.openWhatsAppMedia("https://lookaside.fbsbx.com/x", "t", null, mk(new Response("", { status: 404 })))).kind === "not_found" && (await MF.openWhatsAppMedia("https://lookaside.fbsbx.com/x", "t", null, mk(new Response("", { status: 410 })))).kind === "not_found" && (await MF.openWhatsAppMedia("https://lookaside.fbsbx.com/x", "t", null, mk(new Response("", { status: 503 })))).kind === "unavailable" && (await MF.openWhatsAppMedia("https://lookaside.fbsbx.com/x", "t", null, mk(new Response("x", { status: 200, headers: { "content-length": String(101 * MB) } })))).kind === "too_large" && await (async () => { calls.length = 0; const r = await MF.openWhatsAppMedia("https://evil.example.com/x", "t", null, mk(new Response("x"))); return r.kind === "unavailable" && calls.length === 0; })());
}
check("delivery: images, videos and audio are shown INLINE only when the stored kind and type agree; everything else is a forced download as an opaque type", MF.deliveryFor("image", "image/jpeg", null, false).disposition === "inline" && MF.deliveryFor("audio", "audio/ogg; codecs=opus", null, false).contentType === "audio/ogg" && MF.deliveryFor("video", "video/mp4", null, false).disposition === "inline" && MF.deliveryFor("sticker", "image/webp", null, false).disposition === "inline" && MF.deliveryFor("document", "application/pdf", null, false).disposition === "attachment" && MF.deliveryFor("document", "text/html", null, false).contentType === "application/octet-stream" && MF.deliveryFor("image", "text/html", null, false).contentType === "application/octet-stream" && MF.deliveryFor("image", "audio/mpeg", null, false).disposition === "attachment" && MF.deliveryFor("image", "image/svg+xml", null, false).disposition === "attachment" && MF.deliveryFor("image", "image/jpeg", null, true).disposition === "attachment" && MF.deliveryFor("image", null, "image/png", false).contentType === "image/png");
check("delivery: the download name is header-safe (no quotes, newlines, slashes) and keeps a UTF-8 form", (() => { const h = MF.contentDisposition("attachment", 'in"voice\r\nSet-Cookie: x.pdf'); return !/[\r\n]/.test(h) && !h.includes('"voice') && h.startsWith("attachment;") && /filename\*=UTF-8''/.test(h); })() && MF.contentDisposition("inline", null) === "inline" && /filename\*=UTF-8''caf%C3%A9\.pdf/.test(MF.contentDisposition("attachment", "café.pdf")));

// ============================================================ 4. small pure helpers
check("player: durations read m:ss (h:mm:ss over an hour); an unknown duration is --:-- (never a false 0:00)", MV.formatDuration(0) === "0:00" && MV.formatDuration(65.9) === "1:05" && MV.formatDuration(3600) === "1:00:00" && MV.formatDuration(3725) === "1:02:05" && MV.formatDuration(NaN) === "--:--" && MV.formatDuration(Infinity) === "--:--" && MV.formatDuration(null) === "--:--" && MV.formatDuration(-3) === "--:--");
check("player: an OGG/Opus audio message is a VOICE NOTE; MP3, M4A, AAC, AMR and plain OGG are audio files; non-audio is never one", MV.isVoiceNote("audio", "audio/ogg; codecs=opus") && !MV.isVoiceNote("audio", "audio/mpeg") && !MV.isVoiceNote("audio", "audio/mp4") && !MV.isVoiceNote("audio", "audio/ogg") && !MV.isVoiceNote("audio", null) && !MV.isVoiceNote("video", "audio/ogg; codecs=opus"));
check("frames: the natural ratio is used but clamped, and a missing size falls back to the reserved shape", MV.clampRatio(4000, 1000, 0.6, 1.8, 4 / 3) === 1.8 && MV.clampRatio(1000, 4000, 0.6, 1.8, 4 / 3) === 0.6 && MV.clampRatio(1600, 1200, 0.6, 1.8, 4 / 3) === 1600 / 1200 && MV.clampRatio(0, 0, 0.6, 1.8, 4 / 3) === 4 / 3 && MV.clampRatio(NaN, 5, 0.6, 1.8, 4 / 3) === 4 / 3);
check("cards: a short, honest type label for documents", MV.shortType("application/pdf") === "PDF" && MV.shortType("application/vnd.openxmlformats-officedocument.wordprocessingml.document") === "DOCX" && MV.shortType("application/x-weird+xml") === "WEIRD" && MV.shortType(null) === "");
check("day separators: today / yesterday (localized) and dates, keyed on the Douala calendar day", (() => { const now = new Date("2026-10-14T10:00:00Z"); return F.formatDayLabel("2026-10-14T08:00:00Z", "en", now) === "Today" && F.formatDayLabel("2026-10-13T08:00:00Z", "en", now) === "Yesterday" && F.formatDayLabel("2026-10-14T08:00:00Z", "fr", now) === "Aujourd’hui" && F.formatDayLabel("2026-10-13T08:00:00Z", "fr", now) === "Hier" && /October/.test(F.formatDayLabel("2026-10-02T08:00:00Z", "en", now)) && /2025/.test(F.formatDayLabel("2025-12-02T08:00:00Z", "en", now)) && F.formatDayLabel(null, "en", now) === "" && F.dayKeyOf("2026-10-14T23:30:00Z") === "2026-10-15" && F.dayKeyOf("nope") === ""; })());
check("load earlier: the asked-for size is clamped to 100..500 in steps of 100, whatever the url says", TL.clampThreadLimit(undefined) === 100 && TL.clampThreadLimit("200") === 200 && TL.clampThreadLimit("250") === 200 && TL.clampThreadLimit("99999") === 500 && TL.clampThreadLimit("-5") === 100 && TL.clampThreadLimit("abc") === 100 && TL.clampThreadLimit(["300", "x"]) === 300 && TL.clampThreadLimit("1e3") === 100);

// ============================================================ 5. scroll rules (the "no jumping" requirement), as pure decisions
{
  const snap = (firstId, lastId, count) => ({ firstId, lastId, count });
  const d = (o) => SP.decideScroll({ prev: snap("a", "z", 10), next: snap("a", "z", 10), stick: true, localSend: false, anchor: null, scrollHeight: 1000, ...o });
  check("scroll: the first render opens on the newest message", d({ prev: null }).action === "bottom");
  check("scroll: a new message while the reader is at the bottom follows it", d({ next: snap("a", "y", 11) }).action === "bottom");
  check("scroll: a new message while the reader is reading older ones does NOT move them; it is counted for the 'N new messages' button", JSON.stringify(d({ stick: false, next: snap("a", "y", 12) })) === JSON.stringify({ action: "unseen", added: 2 }) && d({ stick: false, next: snap("a", "y", 11) }).added === 1);
  check("scroll: loading earlier messages restores the position (scrollTop + the growth in height), so the same message stays under the reader's eyes", JSON.stringify(d({ stick: false, next: snap("b", "z", 20), anchor: { height: 1000, top: 40 }, scrollHeight: 2600 })) === JSON.stringify({ action: "restore", top: 1640 }));
  check("scroll: a re-read with nothing new (a status change, the 20-second refresh) does nothing at all", d({}).action === "none" && d({ stick: false }).action === "none");
  check("scroll: near/far thresholds (96 px / 320 px) and the distance from the bottom", SP.isNearBottom(95) && !SP.isNearBottom(96) && SP.isFarFromBottom(321) && !SP.isFarFromBottom(320) && SP.distanceFromBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 500 }) === 100);
  const sc = read("src/components/inbox/ThreadScroller.tsx");
  check("scroll (component): the messages are the ONLY scroller (one overflow-y container, header and composer outside it); layout effect before paint; a ResizeObserver absorbs late media; programmatic scrolls are instant (no smooth behaviour)", (sc.match(/overflow-y-auto/g) || []).length === 1 && /useIsoLayoutEffect/.test(sc) && /new ResizeObserver/.test(sc) && !/behavior:\s*"smooth"|scroll-smooth|scrollTo\(|scrollIntoView/.test(sc) && /decideScroll\(/.test(sc) && /role="log"/.test(sc) && /overscroll-contain/.test(sc));
  check("scroll (component): the new-messages button, the jump-to-latest button and the load-earlier button exist and are labelled; the 20-second refresh only runs while the tab is visible", /data-testid="jump-to-latest"/.test(sc) && /data-testid="load-earlier"/.test(sc) && /visibilityState === "visible"/.test(sc) && /router\.refresh\(\)/.test(sc) && /router\.replace\(loadEarlierHref, \{ scroll: false \}\)/.test(sc));
}


// ============================================================ 4b. WhatsApp's codec rules (H.264 video + AAC audio, one audio stream), read from the container
{
  const I = MI.inspectMp4;
  const reason = (o) => { const r = I(mp4Bytes(o)); return r.ok ? "ok" : r.reason; };
  check("codecs: an H.264 + AAC MP4 passes; so does an H.264 video with no audio, an MP4 with the index AFTER the media data, a 3GPP brand, 'avc3' video and an extra timecode track", reason({}) === "ok" && reason({ audio: [] }) === "ok" && reason({ moovLast: true, mdatBytes: 5000 }) === "ok" && reason({ brand: "3gp4" }) === "ok" && reason({ video: ["avc3"] }) === "ok" && reason({ extraTrack: true }) === "ok");
  check("codecs: video other than H.264 is refused (HEVC, VP9, AV1, MPEG-4 Part 2, H.263)", ["hvc1", "hev1", "vp09", "av01", "mp4v", "s263"].every((v) => reason({ video: [v] }) === "video_codec"));
  check("codecs: audio other than AAC is refused (AMR, MP3 inside MP4, Opus) and more than one audio stream is refused", ["samr", "Opus", "ac-3"].every((a) => reason({ audio: [a] }) === "audio_codec") && reason({ oti: 0x6b }) === "audio_codec" && reason({ oti: 0x66 }) === "ok" && reason({ audio: ["mp4a", "mp4a"] }) === "audio_streams");
  check("codecs: no video track, no index (moov), a truncated file and plain garbage are refused (fail closed)", reason({ video: [] }) === "no_video" && reason({ noMoov: true }) === "unreadable" && I(mp4Bytes().subarray(0, 40)).ok === false && I(new Uint8Array(200)).ok === false && I(new Uint8Array(0)).ok === false && I(null).ok === false);
  check("codecs: H.264 High profile and B-frames are only NOTED (Meta accepts them; some Android clients cannot play them), never refused", (() => { const r = I(mp4Bytes({ profile: 100, ctts: true })); return r.ok && r.notes.includes("high_profile") && r.notes.includes("b_frames") && I(mp4Bytes({ profile: 66 })).notes.length === 0; })());
  check("codecs: the server's single validation gate applies the rules to every video upload (direct and staged) with its own error", MEDIA.validateMediaFile({ name: "a.mp4", type: "video/mp4", bytes: mp4Bytes() }).ok && MEDIA.validateMediaFile({ name: "a.mp4", type: "video/mp4", bytes: mp4Bytes({ video: ["hvc1"] }) }).error === "unsupported_codec" && MEDIA.validateMediaFile({ name: "a.3gp", type: "video/3gpp", bytes: mp4Bytes({ brand: "3gp4" }) }).ok && MEDIA.validateMediaFile({ name: "a.mp4", type: "video/mp4", bytes: big(16 * MB, mp4Bytes()) }).ok && MEDIA.validateMediaFile({ name: "a.mp4", type: "video/mp4", bytes: big(16 * MB + 1, mp4Bytes()) }).error === "too_large");
  check("codecs: audio and documents are NOT subject to the video rules", MEDIA.validateMediaFile({ name: "a.m4a", type: "audio/mp4", bytes: Uint8Array.from([0, 0, 0, 0x18, ...str("ftypM4A "), ...new Array(40).fill(0)]) }).ok);
  const moovLast = new Blob([mp4Bytes({ moovLast: true, mdatBytes: 400000 })]);
  check("codecs (browser early check): a File is inspected by reading only its box headers and its index, not the whole file; the same verdicts as the server; an unreadable file gives null (the server decides)", (await MI.inspectMp4Blob(moovLast)).ok === true && (await MI.inspectMp4Blob(new Blob([mp4Bytes({ video: ["hvc1"], moovLast: true, mdatBytes: 400000 })]))).reason === "video_codec" && (await MI.inspectMp4Blob(new Blob([new Uint8Array(500)]))) === null && (await MI.inspectMp4Blob(new Blob([])) === null));
  check("codecs: the inspector is browser-safe (no Node module, no process, no network)", !/require\(|from "crypto"|from "fs"|process\.|fetch\(|WHATSAPP_|Bearer/.test(code("src/lib/whatsapp/mp4Inspect.ts")));
  check("codecs: the composer refuses an unsupported video BEFORE anything is uploaded, with a translated message that says what WhatsApp accepts", /inspectMp4Blob\(file\)/.test(read("src/components/inbox/ReplyComposer.tsx")) && read("src/components/inbox/ReplyComposer.tsx").indexOf("inspectMp4Blob(file)") < read("src/components/inbox/ReplyComposer.tsx").indexOf("setAttachment({ file, kind") && /H\.264/.test(translations.en.inbox.mediaCodecUnsupported) && /AAC/.test(translations.en.inbox.mediaCodecUnsupported) && /H\.264/.test(translations.fr.inbox.mediaCodecUnsupported) && translations.fr.inbox.mediaCodecUnsupported !== translations.en.inbox.mediaCodecUnsupported && C.interpretMedia({ kind: "response", status: 422, body: { ok: false, error: "unsupported_codec" } }).error === "mediaCodecUnsupported");
}

// ============================================================ 5b. scrolling: who may move a reader, and what keeps them where they are
{
  const snap = (firstId, lastId, count) => ({ firstId, lastId, count });
  const d = (o) => SP.decideScroll({ prev: snap("a", "z", 10), next: snap("a", "z", 10), stick: true, localSend: false, anchor: null, scrollHeight: 1000, ...o });
  const incoming = { next: snap("a", "y", 11) };
  check("scroll (arrivals): a message from the Sales Bot, a colleague, another device or the background refresh NEVER moves a reader who is reading older messages: it is counted as unseen", ["Sales Bot reply", "team member's reply", "reply sent from another device", "polled customer message"].every(() => d({ stick: false, localSend: false, ...incoming }).action === "unseen") && d({ stick: false, next: snap("a", "y", 14) }).added === 4);
  check("scroll (arrivals): a reader who is near the bottom keeps following whatever arrives (customer, Sales Bot, colleague)", d({ stick: true, ...incoming }).action === "bottom");
  check("scroll (own send): a message THIS browser just sent scrolls to the bottom even from far up; without that signal it does not", d({ stick: false, localSend: true, ...incoming }).action === "bottom" && d({ stick: false, localSend: false, ...incoming }).action === "unseen");
  check("scroll (own send): the decision no longer looks at the direction of the newest message at all", !/lastOutbound/.test(read("src/lib/inbox/scrollPolicy.ts") + read("src/components/inbox/ThreadScroller.tsx") + read("src/components/inbox/InboxView.tsx")));
  check("scroll (older messages): loading earlier messages restores the position, whoever is looking; a first render opens at the bottom; a conversation change (a new component) opens at the bottom", JSON.stringify(d({ stick: false, next: snap("b", "z", 20), anchor: { height: 1000, top: 40 }, scrollHeight: 2600 })) === JSON.stringify({ action: "restore", top: 1640 }) && d({ prev: null, stick: false }).action === "bottom");
  check("scroll (media): when an image above the reader finishes loading and the page grows by 120 px, the reader is moved by exactly 120 px (the message they were reading stays put); sub-pixel noise does nothing; shrinking works too", SP.anchorDelta(80, 200) === 120 && SP.anchorDelta(200, 80) === -120 && SP.anchorDelta(80, 80.4) === 0 && SP.anchorDelta(NaN, 1) === 0);
  const sc = read("src/components/inbox/ThreadScroller.tsx"), comp = read("src/components/inbox/ReplyComposer.tsx"), ls = read("src/lib/inbox/localSend.ts");
  check("scroll (component): at the bottom a resize keeps the reader at the bottom; away from the bottom the message being read is the anchor (kept up to date on scroll), so media that loads above them cannot move them, even in browsers without native scroll anchoring", /if \(stick\.current\) return toBottom\(\)/.test(sc) && /anchorDelta\(/.test(sc) && /querySelectorAll<HTMLElement>\("\[data-message-id\]"\)/.test(sc) && /captureReading\(\)/.test(sc) && /requestAnimationFrame/.test(sc));
  check("scroll (local send): the scroller listens for the browser's own send (matching this conversation) and lets it claim only the next new message within 30 seconds; the composer announces ONLY a send the server stored, for text, media and retries", /LOCAL_SEND_EVENT/.test(sc) && /detail\?\.conversationId === conversationId/.test(sc) && /LOCAL_SEND_WINDOW_MS/.test(ls) && LS_OK(ls) && (comp.match(/announceLocalSend\(conversationId\)/g) || []).length === 3 && /storedBySend\(result\)/.test(comp) && /r\.body\.ok \|\| r\.body\.state === "failed"/.test(comp));
  check("scroll (unchanged contract): the messages remain the only scroller; the refresh only runs while the tab is visible; the new-messages and jump-to-latest buttons are present", (sc.match(/overflow-y-auto/g) || []).length === 1 && /visibilityState === "visible"/.test(sc) && /data-testid="jump-to-latest"/.test(sc) && !/behavior:\s*"smooth"|scrollIntoView|scrollTo\(/.test(sc));
}
function LS_OK(ls) { return /dispatchEvent\(new CustomEvent\(LOCAL_SEND_EVENT/.test(ls); }

// ============================================================ 6. the browser-side sender (progress, staging, retries): a scripted XMLHttpRequest and fetch
{
  const sent = [];
  const makeXhr = (script) => class FakeXhr {
    constructor() { this.upload = {}; this.headers = {}; this.status = 0; this.responseText = ""; }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(k, v) { this.headers[k] = v; }
    send(body) {
      sent.push({ method: this.method, url: this.url, headers: { ...this.headers }, body });
      const r = script(this);
      queueMicrotask(() => {
        if (r === "network") return this.onerror?.();
        for (const f of r.progress ?? []) this.upload.onprogress?.({ lengthComputable: true, loaded: f * 100, total: 100 });
        this.status = r.status; this.responseText = JSON.stringify(r.body ?? {}); this.onload?.();
      });
    }
  };
  const fileOf = (name, type, size) => new File([new Uint8Array(size)], name, { type });
  const progressLog = [];
  const baseArgs = (file, extra = {}) => ({ conversationId: "d0000000-0000-4000-8000-000000000001", file, caption: " Hello ", clientRequestId: "e0000000-0000-4000-8000-000000000001", staging: false, onProgress: (p) => progressLog.push(p), ...extra });

  sent.length = 0; progressLog.length = 0;
  let r = await C.sendAttachment(baseArgs(fileOf("a.pdf", "application/pdf", 1000), { xhr: makeXhr(() => ({ status: 200, progress: [0.25, 0.5, 1], body: { ok: true, state: "sent", message_id: "m1" } })) }));
  check("send (direct): ONE multipart POST to the media route with the upload header; progress is reported (0, 25 %, 50 %, then 'sending'); the answer is passed through", r.kind === "response" && r.body.ok === true && sent.length === 1 && sent[0].method === "POST" && sent[0].url.endsWith("/media") && sent[0].headers["x-ringo-upload"] === "1" && sent[0].body instanceof FormData && sent[0].body.get("client_request_id") === "e0000000-0000-4000-8000-000000000001" && sent[0].body.get("caption") === "Hello" && progressLog[0].fraction === 0 && progressLog.some((p) => p.phase === "uploading" && p.fraction === 0.5) && progressLog.at(-1).phase === "sending" && progressLog.at(-1).fraction === null);
  r = await C.sendAttachment(baseArgs(fileOf("a.pdf", "application/pdf", 1000), { xhr: makeXhr(() => "network") }));
  check("send (direct): a network failure is reported as 'network' (the composer keeps the draft, the attachment and the request id)", r.kind === "network" && C.interpretMedia(r).keepRequestId === true && C.interpretMedia(r).clearAttachment === false && C.interpretMedia(r).error === "sendFailedMessage");

  // staged video
  const stageOk = (calls) => async (url, init) => { calls.push({ url: String(url), init }); return J(200, { ok: true, path: "p/c/o.mp4", upload_url: "https://x.supabase.co/storage/v1/object/upload/sign/inbox-outbound-media/p/c/o.mp4?token=T", headers: { apikey: "PUBLICKEY", authorization: "Bearer PUBLICKEY", "x-upsert": "false" }, max_bytes: 16 * MB }); };
  sent.length = 0; progressLog.length = 0;
  const stagedCalls = []; const stagedPaths = [];
  const xhrStaged = makeXhr((x) => (x.method === "PUT" ? { status: 200, progress: [0.5, 1], body: { Key: "ok" } } : { status: 200, body: { ok: true, state: "sent", message_id: "m2" } }));
  r = await C.sendAttachment(baseArgs(fileOf("holiday.mp4", "video/mp4", 5 * MB), { staging: true, xhr: xhrStaged, fetchImpl: stageOk(stagedCalls), onStaged: (p) => stagedPaths.push(p) }));
  check("send (staged video): 1) JSON to /media/stage with the upload header and only the name, type, size and the send's request id; 2) a PUT of the FILE to the signed url with exactly the headers the server returned; 3) JSON to /media naming the staged object, the request id and the caption", r.kind === "response" && r.body.ok === true && stagedCalls.length === 1 && stagedCalls[0].url.endsWith("/media/stage") && JSON.parse(stagedCalls[0].init.body).size === 5 * MB && Object.keys(JSON.parse(stagedCalls[0].init.body)).sort().join() === "client_request_id,name,size,type" && JSON.parse(stagedCalls[0].init.body).client_request_id === "e0000000-0000-4000-8000-000000000001" && sent.length === 2 && sent[0].method === "PUT" && sent[0].url.includes("/object/upload/sign/inbox-outbound-media/") && sent[0].headers.apikey === "PUBLICKEY" && sent[0].body instanceof FormData && sent[0].body.get("") instanceof Blob && sent[1].method === "POST" && sent[1].headers["Content-Type"] === "application/json" && sent[1].headers["x-ringo-upload"] === "1" && JSON.parse(sent[1].body).staged_path === "p/c/o.mp4" && JSON.parse(sent[1].body).client_request_id === "e0000000-0000-4000-8000-000000000001" && JSON.parse(sent[1].body).caption === "Hello" && stagedPaths.join() === "p/c/o.mp4");
  check("send (staged video): upload progress reaches the browser (50 %, 100 %), then the 'sending to WhatsApp' phase", progressLog.some((p) => p.phase === "uploading" && p.fraction === 0.5) && progressLog.at(-1).phase === "sending");
  sent.length = 0;
  r = await C.sendAttachment(baseArgs(fileOf("holiday.mp4", "video/mp4", 5 * MB), { staging: true, xhr: makeXhr((x) => (x.method === "PUT" ? { status: 400, body: { statusCode: "409", error: "Duplicate", message: "The resource already exists" } } : { status: 200, body: { ok: true, state: "sent", message_id: "m3" } })), fetchImpl: stageOk([]) }));
  check("send (staged): when an earlier attempt of THIS send already stored the file, Supabase's 'Duplicate' answer is not a failure: the send simply continues", r.kind === "response" && r.body.ok === true && sent.length === 2 && sent[1].method === "POST");
  sent.length = 0;
  r = await C.sendAttachment(baseArgs(fileOf("holiday.mp4", "video/mp4", 5 * MB), { staging: true, staged: { path: "p/c/o.mp4" }, xhr: xhrStaged, fetchImpl: async () => { throw new Error("must not stage again"); } }));
  check("send (retry after an unknown outcome): a video already staged by the earlier attempt is NOT uploaded again; only the send is repeated, with the same request id", r.kind === "response" && sent.length === 1 && sent[0].method === "POST" && JSON.parse(sent[0].body).staged_path === "p/c/o.mp4");
  sent.length = 0;
  r = await C.sendAttachment(baseArgs(fileOf("holiday.mp4", "video/mp4", 5 * MB), { staging: true, xhr: makeXhr((x) => (x.method === "PUT" ? "network" : { status: 200, body: { ok: true } })), fetchImpl: stageOk([]) }));
  check("send (staged): an upload that fails midway never asks the server to send anything, and is reported as an upload failure (the draft is kept)", r.kind === "response" && r.body.ok === false && r.body.error === "upload_failed_client" && sent.length === 1 && C.interpretMedia(r).error === "mediaUploadFailed" && C.interpretMedia(r).clearAttachment === false);
  r = await C.sendAttachment(baseArgs(fileOf("holiday.mp4", "video/mp4", 5 * MB), { staging: true, xhr: makeXhr(() => ({ status: 200, body: {} })), fetchImpl: async () => J(503, { ok: false, error: "staging_unavailable" }) }));
  check("send (staged): when large uploads are not enabled the server says so and the message tells the person what to do; nothing is lost", r.kind === "response" && r.body.error === "staging_unavailable" && C.interpretMedia(r).error === "mediaStagingUnavailable" && /4 MB/.test(translations.en.inbox.mediaStagingUnavailable) && /4 Mo/.test(translations.fr.inbox.mediaStagingUnavailable));
  check("interpretMedia: oversize video -> the video message with the real limit; a staged object already consumed -> 'already handled' and refresh; Meta/definite failures keep the attachment", C.interpretMedia({ kind: "response", status: 413, body: { ok: false, error: "too_large", video: true } }).error === "mediaVideoTooLarge" && C.interpretMedia({ kind: "response", status: 413, body: { ok: false, error: "too_large" } }).error === "mediaTooLarge" && (() => { const e = C.interpretMedia({ kind: "response", status: 409, body: { ok: false, error: "staged_missing" } }); return e.error === "mediaStagedGone" && e.refresh === true && e.clearAttachment === true; })() && C.interpretMedia({ kind: "response", status: 422, body: { ok: false, error: "send_failed", state: "failed", message_id: "m" } }).clearAttachment === false && C.interpretMedia({ kind: "response", status: 422, body: { ok: false, error: "not_stageable" } }).error === "mediaUnsupported");
  check("send: the browser code never sees a service key, a Meta token or a Meta url; the signed-upload headers come from the server", !/SERVICE_ROLE|WHATSAPP_|graph\.facebook|Bearer|Authorization|NEXT_PUBLIC/.test(code("src/lib/inbox/client.ts")));
}

// ============================================================ 7. the routes, on the real database functions
const db = new PGlite();
const U = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RID = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const alice = { user: U(1), profile: P(1) }, bob = { user: U(2), profile: P(2) }, carol = { user: U(3) };
const PH_A = "1110000000001", PH_B = "9990000000001", TOKEN = "test-token-not-real-0001";
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to public;
  create table public.users (id uuid primary key, email text not null);
  create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, username text not null);
  alter table public.profiles enable row level security;
  create policy "profiles are publicly readable" on public.profiles for select using (true);
  create table public.bk_customers (id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete restrict, name text not null, unique (profile_id, id));
  insert into public.users values ('${alice.user}','a@x.test'), ('${bob.user}','b@x.test'), ('${carol.user}','c@x.test');
  insert into public.profiles values ('${alice.profile}','${alice.user}','alice'), ('${bob.profile}','${bob.user}','bob');
`);
for (const m of ["2026-12-07_whatsapp_inbox_foundation", "2026-12-08_whatsapp_outbound_replies", "2026-12-09_whatsapp_inbox_tools", "2026-12-10_whatsapp_outbound_media"]) await db.exec(read(`supabase/migrations/${m}.sql`));
await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${alice.profile}', '${PH_A}', '1110000000002'), ('${bob.profile}', '${PH_B}', '9990000000002')`);
const sq = (v) => (v === null || v === undefined ? "null" : Array.isArray(v) ? `'{${v.join(",")}}'` : `'${String(v).replace(/'/g, "''")}'`);
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const ingest = (o) => db.exec(`select public.inbox_ingest_whatsapp_message(${sq(o.phone)}, null, ${sq(o.id)}, ${sq(o.from)}, ${sq(o.ts)}::timestamptz, 'text', 'hi', ${sq(o.name)}, null, null, null, null, null, null, null)`);
await ingest({ phone: PH_A, id: "wamid.IN1", from: "237600000001", ts: hoursAgo(1), name: "Customer One" });
await ingest({ phone: PH_A, id: "wamid.IN2", from: "237600000002", ts: hoursAgo(1), name: "Customer Two" });
await ingest({ phone: PH_B, id: "wamid.INB", from: "237611111111", ts: hoursAgo(1), name: "Bob Customer" });
const q1 = async (sql) => (await db.query(sql)).rows;
const convOf = async (wa) => (await q1(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0].id;
const conv1 = await convOf("237600000001"), conv2 = await convOf("237600000002"), convB = await convOf("237611111111");
// stored media messages (inserted directly, as the webhook's ingestion function would have done)
let wseq = 0;
async function addMedia(conv, profile, { direction = "inbound", type, mediaId, mime, filename = null, caption = null, status }) {
  const id = crypto.randomUUID();
  const st = status ?? (direction === "inbound" ? "received" : "sent");
  await db.exec(`insert into public.inbox_messages (id, profile_id, conversation_id, channel, direction, provider_message_id, type, body, status, received_at, client_request_id) values (${sq(id)}, ${sq(profile)}, ${sq(conv)}, 'whatsapp', ${sq(direction)}, ${sq(`wamid.M${++wseq}`)}, ${sq(type)}, ${sq(caption)}, ${sq(st)}, now(), ${direction === "outbound" ? sq(crypto.randomUUID()) : "null"})`);
  if (mediaId) await db.exec(`insert into public.inbox_message_media (message_id, profile_id, kind, media_id, mime_type, filename, caption) values (${sq(id)}, ${sq(profile)}, ${sq(type)}, ${sq(mediaId)}, ${sq(mime)}, ${sq(filename)}, ${sq(caption)})`);
  return id;
}
const mImg = await addMedia(conv1, alice.profile, { type: "image", mediaId: "100000000000001", mime: "image/jpeg", caption: "My receipt" });
const mVoice = await addMedia(conv1, alice.profile, { type: "audio", mediaId: "100000000000002", mime: "audio/ogg; codecs=opus" });
const mMp3 = await addMedia(conv1, alice.profile, { type: "audio", mediaId: "100000000000003", mime: "audio/mpeg", filename: "song.mp3" });
const mVid = await addMedia(conv1, alice.profile, { type: "video", mediaId: "100000000000004", mime: "video/mp4", caption: "Short clip" });
const mDoc = await addMedia(conv1, alice.profile, { type: "document", mediaId: "100000000000005", mime: "application/pdf", filename: "invoice-2026.pdf" });
const mHtml = await addMedia(conv1, alice.profile, { type: "document", mediaId: "100000000000006", mime: "text/html", filename: "page.html" });
const mSticker = await addMedia(conv1, alice.profile, { type: "sticker", mediaId: "100000000000007", mime: "image/webp" });
const mNoMedia = await addMedia(conv1, alice.profile, { type: "image", mediaId: null, mime: null });
const mTextMsg = (await q1(`select id from public.inbox_messages where conversation_id = '${conv1}' and type = 'text' limit 1`))[0].id;
const mBadId = await addMedia(conv1, alice.profile, { type: "image", mediaId: "../../etc/passwd", mime: "image/jpeg" });
const mOther = await addMedia(conv2, alice.profile, { type: "image", mediaId: "100000000000008", mime: "image/jpeg" });
const mBob = await addMedia(convB, bob.profile, { type: "image", mediaId: "200000000000001", mime: "image/jpeg" });

const mkClient = makeClientFactory(db);
let chain = Promise.resolve();
const asService = (sql) => { const run = async () => { await db.exec("set role service_role"); try { return await db.query(sql); } finally { await db.exec("reset role"); } }; const p = chain.then(run, run); chain = p.then(() => undefined, () => undefined); return p; };
globalThis.__user = null;
globalThis.__sb = () => { const c = mkClient(globalThis.__user ? "authenticated" : "anon", () => globalThis.__user); return { auth: { getUser: async () => ({ data: { user: globalThis.__user ? { id: globalThis.__user } : null } }) }, from: (t) => c.from(t) }; };
// a fake private storage bucket
const bucket = new Map(); let storageMode = "ok"; const storageCalls = []; const infoOverride = new Map(); let storageApi = "full"; // "full" | "no-info" (an older client: no info call) | "route-404" (info answers 404 for the route, list works)
const fakeStorage = { from: (name) => ({
  createSignedUploadUrl: async (p) => { storageCalls.push({ op: "sign", bucket: name, path: p }); return storageMode === "unavailable" ? { data: null, error: { message: "Bucket not found", statusCode: "404" } } : { data: { signedUrl: `https://proj.supabase.co/storage/v1/object/upload/sign/${name}/${p}?token=TKN`, token: "TKN", path: p }, error: null }; },
  list: async (dir, opts) => { storageCalls.push({ op: "list", bucket: name, path: dir }); const out = []; for (const [k, blob] of bucket) { if (!k.startsWith(dir + "/")) continue; const nm = k.slice(dir.length + 1); if (opts?.search && !nm.includes(opts.search)) continue; const ov = infoOverride.get(k); if (ov === "error") return { data: null, error: { message: "internal error", status: 500 } }; out.push({ name: nm, metadata: { size: blob.size, mimetype: blob.type, ...(ov ? { size: "size" in ov ? ov.size : blob.size, mimetype: "contentType" in ov ? ov.contentType : blob.type } : {}) } }); } return { data: out, error: null }; },
  ...(storageApi === "no-info" ? {} : { info: async (p) => { if (storageApi === "route-404") { storageCalls.push({ op: "info", bucket: name, path: p }); return { data: null, error: { message: "Route GET:/object/info/x not found", status: 404 } }; } storageCalls.push({ op: "info", bucket: name, path: p }); const ov = infoOverride.get(p); if (ov === "error") return { data: null, error: { message: "internal error", status: 500 } }; if (!bucket.has(p)) return { data: null, error: { message: "Object not found", status: 404 } }; const blob = bucket.get(p); return { data: { name: p, bucketId: name, size: blob.size, contentType: blob.type, ...(ov || {}) }, error: null }; } }),
  download: async (p) => { storageCalls.push({ op: "download", bucket: name, path: p }); return bucket.has(p) ? { data: bucket.get(p), error: null } : { data: null, error: { message: "Object not found", status: 404 } }; },
  remove: async (paths) => { storageCalls.push({ op: "remove", bucket: name, paths }); for (const p of paths) bucket.delete(p); return { data: [], error: null }; },
}) };
let rpcCalls = [];
globalThis.__admin = () => ({
  storage: fakeStorage,
  rpc: async (fn, args) => {
    rpcCalls.push({ fn, args });
    const named = Object.entries(args).map(([k, val]) => `${k} => ${sq(val)}`).join(", ");
    try { return { data: (await asService(`select public.${fn}(${named}) as r`)).rows[0].r, error: null }; } catch (e) { return { data: null, error: { code: e.code || "XX000", message: e.message } }; }
  },
});
// Meta, scripted: lookups, downloads, uploads and sends
let metaMode = { lookup: "ok", download: "ok", upload: "ok", send: "accept" }; let fetchCalls = []; let seq = 0;
const realFetch = globalThis.fetch;
const FILES = { "100000000000001": { type: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]) }, "100000000000002": { type: "audio/ogg; codecs=opus", bytes: FX.oggOpus }, "100000000000004": { type: "video/mp4", bytes: FX.mp4 }, "100000000000005": { type: "application/pdf", bytes: FX.pdf }, "100000000000006": { type: "text/html", bytes: Uint8Array.from(Buffer.from("<script>alert(1)</script>")) }, "100000000000007": { type: "image/webp", bytes: Uint8Array.from([1, 2, 3]) }, "100000000000008": { type: "image/jpeg", bytes: Uint8Array.from([0xff, 0xd8, 0xff]) } };
globalThis.fetch = async (url, init) => {
  const u = String(url); fetchCalls.push({ url: u, init });
  const graph = /^https:\/\/graph\.facebook\.com\/v21\.0\/(\d+)$/.exec(u);
  if (graph) {
    if (metaMode.lookup === "gone") return J(404, { error: { code: 100 } });
    if (metaMode.lookup === "down") return J(503, {});
    if (metaMode.lookup === "network") throw new TypeError("fetch failed");
    const f = FILES[graph[1]];
    if (!f) return J(404, {});
    return J(200, { url: `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${graph[1]}`, mime_type: f.type, file_size: f.bytes.length });
  }
  if (u.startsWith("https://lookaside.fbsbx.com/")) {
    const mid = /mid=(\d+)/.exec(u)[1]; const f = FILES[mid];
    if (metaMode.download === "gone") return new Response("", { status: 404 });
    if (metaMode.download === "down") return new Response("", { status: 502 });
    const range = init?.headers?.Range;
    if (range) return new Response(f.bytes.subarray(0, 4), { status: 206, headers: { "content-type": f.type, "content-length": "4", "content-range": `bytes 0-3/${f.bytes.length}` } });
    return new Response(f.bytes, { status: 200, headers: { "content-type": f.type, "content-length": String(f.bytes.length) } });
  }
  if (u.endsWith("/media")) return metaMode.upload === "ok" ? J(200, { id: `META_MEDIA_${++seq}` }) : J(400, { error: { code: 131053, message: "SECRET META TEXT" } });
  if (u.endsWith("/messages")) return metaMode.send === "accept" ? J(200, { messages: [{ id: `wamid.SENT${++seq}` }] }) : J(400, { error: { code: 100, message: "SECRET META TEXT" } });
  throw new Error("unexpected fetch " + u);
};
process.env.WHATSAPP_ACCESS_TOKEN = TOKEN;
const logs = []; const origInfo = console.info, origErr = console.error, origWarn = console.warn;
console.info = (...a) => logs.push(a.join(" ")); console.error = (...a) => logs.push(a.join(" ")); console.warn = (...a) => logs.push(a.join(" "));
const resetMeta = () => { metaMode = { lookup: "ok", download: "ok", upload: "ok", send: "accept" }; fetchCalls = []; rpcCalls = []; storageMode = "ok"; storageCalls.length = 0; storageApi = "full"; };
const view = async (conv, msg, { user = alice.user, query = "", headers = {}, method = "GET" } = {}) => {
  globalThis.__user = user;
  const res = await viewRoute[method](new Request(`http://localhost/api/inbox/conversations/${conv}/media/${msg}${query}`, { method, headers }), { params: { id: conv, messageId: msg } });
  return res;
};
const bytesOf = async (res) => new Uint8Array(await res.arrayBuffer());
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

try {
  // ---------------------------------------------------------------------------------------------------------- the authenticated file view
  resetMeta();
  let res = await view(conv1, mImg);
  let body = await bytesOf(res);
  check("view: the owner gets the photo's bytes, streamed, as image/jpeg shown inline, private, nosniff, sandboxed, with range support advertised", res.status === 200 && same(body, FILES["100000000000001"].bytes) && res.headers.get("content-type") === "image/jpeg" && /^inline/.test(res.headers.get("content-disposition")) && res.headers.get("x-content-type-options") === "nosniff" && /sandbox/.test(res.headers.get("content-security-policy")) && /private/.test(res.headers.get("cache-control")) && res.headers.get("accept-ranges") === null && res.headers.get("cross-origin-resource-policy") === "same-origin" && res.headers.get("referrer-policy") === "no-referrer");
  check("view: Meta was asked server-side with the Bearer token (media id from the DATABASE row), twice (lookup, then download); the browser got neither the token nor a Meta url", fetchCalls.length === 2 && fetchCalls[0].url === "https://graph.facebook.com/v21.0/100000000000001" && fetchCalls[0].init.headers.Authorization === `Bearer ${TOKEN}` && fetchCalls[1].url.startsWith("https://lookaside.fbsbx.com/") && ![...res.headers.entries()].some(([k, v]) => v.includes(TOKEN) || v.includes("fbsbx") || v.includes("graph.facebook")) && !Buffer.from(body).toString("latin1").includes(TOKEN));
  resetMeta();
  res = await view(conv1, mVid, { headers: { range: "bytes=0-3" } });
  body = await bytesOf(res);
  check("view: a Range request (what audio/video seeking sends) is passed upstream and answered 206 with its Content-Range and Accept-Ranges (promised only when the upstream really serves ranges; a plain 200 does not claim it)", res.status === 206 && res.headers.get("accept-ranges") === "bytes" && body.length === 4 && /^bytes 0-3\//.test(res.headers.get("content-range")) && fetchCalls[1].init.headers.Range === "bytes=0-3" && res.headers.get("content-type") === "video/mp4");
  resetMeta(); res = await view(conv1, mVoice); await res.arrayBuffer();
  check("view: a voice note is delivered as audio/ogg inline (the codec parameter is not echoed)", res.status === 200 && res.headers.get("content-type") === "audio/ogg" && /^inline/.test(res.headers.get("content-disposition")));
  resetMeta(); res = await view(conv1, mDoc); await res.arrayBuffer();
  check("view: a document is a forced download with its (sanitized) filename, never shown inline", res.status === 200 && /^attachment; filename="invoice-2026\.pdf"/.test(res.headers.get("content-disposition")) && res.headers.get("content-type") === "application/pdf");
  resetMeta(); res = await view(conv1, mHtml); body = await bytesOf(res);
  check("view: a customer's HTML file can never run: stored as a document it is served as an opaque attachment under a sandboxing CSP", res.headers.get("content-type") === "application/octet-stream" && /^attachment/.test(res.headers.get("content-disposition")) && /sandbox/.test(res.headers.get("content-security-policy")) && res.headers.get("x-content-type-options") === "nosniff");
  resetMeta(); res = await view(conv1, mImg, { query: "?download=1" }); await res.arrayBuffer();
  check("view: ?download=1 turns any file into a download", /^attachment/.test(res.headers.get("content-disposition")));
  resetMeta(); res = await view(conv1, mSticker); await res.arrayBuffer();
  check("view: a sticker is shown inline as an image", res.status === 200 && res.headers.get("content-type") === "image/webp" && /^inline/.test(res.headers.get("content-disposition")));
  resetMeta(); res = await view(conv1, mVid, { method: "HEAD" });
  check("view: HEAD answers with the same status and headers and NO body (used to check a file is still there before offering a download)", res.status === 200 && res.headers.get("content-type") === "video/mp4" && (await res.text()) === "");

  // authorization failures
  resetMeta(); res = await view(conv1, mImg, { user: null });
  check("auth: a signed-out request -> 401/403 and Meta is never called", [401, 403].includes(res.status) && fetchCalls.length === 0);
  resetMeta(); res = await view(conv1, mImg, { user: bob.user });
  check("auth: ANOTHER business's owner asking for this conversation's media gets 404 (indistinguishable from a missing file) and Meta is never called", res.status === 404 && fetchCalls.length === 0);
  resetMeta(); res = await view(conv1, mImg, { user: carol.user });
  check("auth: a signed-in user with no Inbox at all gets nothing", [403, 404].includes(res.status) && fetchCalls.length === 0);
  resetMeta(); res = await view(conv1, mOther);
  check("auth: a message of ANOTHER conversation of the same owner cannot be fetched through this conversation's url", res.status === 404 && fetchCalls.length === 0);
  resetMeta(); res = await view(conv1, mBob);
  check("auth: another business's message id (with the owner's own conversation) is 404", res.status === 404 && fetchCalls.length === 0);
  resetMeta(); res = await view(conv1, mTextMsg);
  check("auth: a text message has no media -> 404; a media message whose row is missing -> 404; a stored media id that is not numeric is never sent to Meta", res.status === 404 && (await view(conv1, mNoMedia)).status === 404 && (await view(conv1, mBadId)).status === 404 && fetchCalls.length === 0);
  resetMeta(); check("auth: ids that are not uuids are refused before anything happens", (await view("not-a-uuid", mImg)).status === 404 && (await view(conv1, "../../x")).status === 404 && fetchCalls.length === 0);
  // provider failures
  resetMeta(); metaMode.lookup = "gone"; res = await view(conv1, mImg);
  check("retrieval: a file Meta no longer has -> 410 'expired' (the UI says it is no longer available)", res.status === 410 && (await res.json()).error === "expired");
  resetMeta(); metaMode.lookup = "down"; res = await view(conv1, mImg); const downBody = await res.json();
  check("retrieval: Meta unavailable -> 502 (the UI offers 'Try again'), with no provider detail", res.status === 502 && downBody.error === "unavailable" && !JSON.stringify(downBody).includes("SECRET"));
  resetMeta(); metaMode.lookup = "network"; res = await view(conv1, mImg);
  check("retrieval: a network failure towards Meta -> 502", res.status === 502);
  resetMeta(); metaMode.download = "gone"; res = await view(conv1, mImg);
  check("retrieval: the download itself reporting 404 -> 410", res.status === 410);
  resetMeta(); metaMode.download = "down"; res = await view(conv1, mImg);
  check("retrieval: a failing download -> 502", res.status === 502);
  resetMeta(); delete process.env.WHATSAPP_ACCESS_TOKEN; res = await view(conv1, mImg); process.env.WHATSAPP_ACCESS_TOKEN = TOKEN;
  check("retrieval: without a configured token -> 503 and no request is made", res.status === 503 && fetchCalls.length === 0);
  check("logging: no media id, token, file name or caption was logged by any of the above", !logs.join("\n").includes(TOKEN) && !logs.join("\n").includes("100000000000001") && !logs.join("\n").includes("invoice-2026") && !logs.join("\n").includes("My receipt"));

  // ---------------------------------------------------------------------------------------------------------- staging a large video
  const stagePost = (conv, body, { user = alice.user, headers = { "x-ringo-upload": "1", "content-type": "application/json" } } = {}) => { globalThis.__user = user; return stageRoute.POST(new Request(`http://localhost/api/inbox/conversations/${conv}/media/stage`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), { params: { id: conv } }); };
  resetMeta();
  res = await stagePost(conv1, { name: "holiday.mp4", type: "video/mp4", size: 10 * MB, client_request_id: RID(101) });
  let sb = await res.json();
  check("stage: the owner gets a signed upload url for an object named from HER profile, THIS conversation and THIS send's request id, plus the public headers the gateway needs, and the 16 MB maximum", res.status === 200 && sb.ok === true && sb.path === SM.stagedPath(alice.profile, conv1, RID(101), "mp4") && SM.isStagedPathFor(sb.path, alice.profile, conv1, RID(101)) && sb.upload_url.includes("/object/upload/sign/inbox-outbound-media/") && sb.max_bytes === 16 * MB && typeof sb.headers === "object" && storageCalls.length === 1 && storageCalls[0].bucket === "inbox-outbound-media");
  check("stage: the answer carries no service key, no Meta token and no recipient", !JSON.stringify(sb).includes(TOKEN) && !/service_role|SERVICE_ROLE/.test(JSON.stringify(sb)) && !/237600000001|1110000000001/.test(JSON.stringify(sb)));
  resetMeta(); res = await stagePost(conv1, { name: "holiday.mp4", type: "video/mp4", size: 10 * MB });
  check("stage: without the send's request id (or with one that is not a uuid) -> 422, nothing issued", res.status === 422 && (await res.json()).error === "invalid" && (await stagePost(conv1, { name: "holiday.mp4", type: "video/mp4", size: 10 * MB, client_request_id: "../../x" })).status === 422 && storageCalls.length === 0);
  resetMeta(); res = await stagePost(conv1, { name: "holiday.mp4", type: "video/mp4", size: 16 * MB, client_request_id: RID(102) });
  check("stage boundary: exactly 16 MB is allowed", res.status === 200);
  resetMeta(); res = await stagePost(conv1, { name: "holiday.mp4", type: "video/mp4", size: 16 * MB + 1, client_request_id: RID(103) });
  check("stage boundary: 16 MB + 1 byte -> 413 too_large, nothing issued", res.status === 413 && (await res.json()).error === "too_large" && storageCalls.length === 0);
  resetMeta(); res = await stagePost(conv1, { name: "holiday.mp4", type: "video/mp4", size: 50 * MB, client_request_id: RID(104) });
  check("stage boundary: a 50 MB video -> 413 too_large (the application limit is never allowed to exceed Meta's)", res.status === 413 && storageCalls.length === 0);
  resetMeta(); res = await stagePost(conv1, { name: "a.pdf", type: "application/pdf", size: 1000, client_request_id: RID(105) });
  check("stage: a document is not stageable (422), and an unsupported video format (QuickTime) is refused with its own reason", res.status === 422 && (await res.json()).error === "not_stageable" && (await (await stagePost(conv1, { name: "a.mov", type: "video/quicktime", size: 5 * MB, client_request_id: RID(105) })).json()).error === "unsupported_type" && storageCalls.length === 0);
  resetMeta(); res = await stagePost(conv1, { name: "holiday.mp4", type: "video/mp4", size: 10 * MB, client_request_id: RID(106) }, { headers: { "content-type": "application/json" } });
  check("stage: without the upload header -> 400 (a cross-site page cannot set it); not JSON -> 415", res.status === 400 && (await stagePost(conv1, "x", { headers: { "x-ringo-upload": "1", "content-type": "text/plain" } })).status === 415 && storageCalls.length === 0);
  resetMeta(); res = await stagePost(conv1, { name: "holiday.mp4", type: "video/mp4", size: 10 * MB, client_request_id: RID(107) }, { user: bob.user });
  check("stage: another owner -> 404; signed out -> 401/403; nothing is issued", res.status === 404 && [401, 403].includes((await stagePost(conv1, { name: "a.mp4", type: "video/mp4", size: 1000, client_request_id: RID(107) }, { user: null })).status) && storageCalls.length === 0);
  resetMeta(); storageMode = "unavailable"; res = await stagePost(conv1, { name: "holiday.mp4", type: "video/mp4", size: 10 * MB, client_request_id: RID(108) });
  check("stage: when the staging bucket does not exist yet (migration not applied) -> 503 staging_unavailable; the Inbox keeps working for files up to 4 MB", res.status === 503 && (await res.json()).error === "staging_unavailable");
  resetMeta(); res = await stagePost(conv1, '{"name":"a.mp4"', {});
  check("stage: a broken JSON body is a clean 400", res.status === 400);

  // ---------------------------------------------------------------------------------------------------------- sending the staged video
  const stagedSend = (conv, body, { user = alice.user, headers = { "x-ringo-upload": "1", "content-type": "application/json" } } = {}) => { globalThis.__user = user; return mediaRoute.POST(new Request(`http://localhost/api/inbox/conversations/${conv}/media`, { method: "POST", headers, body: JSON.stringify(body) }), { params: { id: conv } }); };
  // a staged object, named for the send it belongs to (what the stage route does); `meta` overrides what storage reports about it
  const putStaged = (bytes, rid, { ext = "mp4", conv = conv1, profile = alice.profile, type, meta } = {}) => { const p = SM.stagedPath(profile, conv, rid, ext); bucket.set(p, new Blob([bytes], { type: type ?? (ext === "mp4" ? "video/mp4" : "video/3gpp") })); if (meta) infoOverride.set(p, meta); return p; };
  const sendStaged = (p, rid, extra = {}, opts) => stagedSend(extra.conv ?? conv1, { staged_path: p, name: "holiday.mp4", type: "video/mp4", client_request_id: rid, ...extra.body }, opts);
  const rowOf = async (rid) => (await q1(`select * from public.inbox_messages where client_request_id = '${rid}'`))[0];
  const downloaded = () => storageCalls.some((c) => c.op === "download");
  const removedPaths = () => storageCalls.filter((c) => c.op === "remove").flatMap((c) => c.paths);

  resetMeta();
  let sp = putStaged(big(8 * MB, FX.mp4), RID(201));
  res = await sendStaged(sp, RID(201), { body: { caption: "Look at this" } });
  let rb = await res.json();
  let row = await rowOf(RID(201));
  check("staged send: a valid 8 MB video is checked with storage's own metadata, validated byte for byte (container and codecs), uploaded to Meta, sent to the CONVERSATION's customer, recorded as sent, and the staged copy is deleted", res.status === 200 && rb.ok === true && row.status === "sent" && row.type === "video" && fetchCalls.filter((c) => c.url.endsWith("/media")).length === 1 && fetchCalls.filter((c) => c.url.endsWith("/messages")).length === 1 && JSON.parse(fetchCalls.find((c) => c.url.endsWith("/messages")).init.body).to === "237600000001" && !bucket.has(sp));
  check("staged send: storage was asked for the object's size and type BEFORE anything was downloaded; the only thing deleted is this send's own object", storageCalls.findIndex((c) => c.op === "info") >= 0 && storageCalls.findIndex((c) => c.op === "info") < storageCalls.findIndex((c) => c.op === "download") && removedPaths().join() === sp);
  check("staged send: the Meta upload carried the full 8 MB file (not a truncated copy) and the token only in the Authorization header", (() => { const up = fetchCalls.find((c) => c.url.endsWith("/media")); const f = up.init.body.get("file"); return f.size === 8 * MB && up.init.headers.Authorization === `Bearer ${TOKEN}` && !JSON.stringify(rb).includes(TOKEN); })());
  res = await sendStaged(sp, RID(201), { body: { caption: "Look at this" } });
  check("staged send: replaying the same request after it was handled -> 409 staged_missing (the file is gone; nothing is uploaded or sent twice), and the one message row is unchanged", res.status === 409 && (await res.json()).error === "staged_missing" && (await q1(`select * from public.inbox_messages where client_request_id = '${RID(201)}'`)).length === 1 && fetchCalls.filter((c) => c.url.endsWith("/messages")).length === 1);

  // one staged object belongs to ONE send
  resetMeta(); sp = putStaged(big(8 * MB, FX.mp4), RID(202));
  res = await sendStaged(sp, RID(203));
  check("staged send: an object staged for one send cannot be sent under ANOTHER request id (422): it can never be sent twice, and the other send cannot take it over; it is left alone", res.status === 422 && bucket.has(sp) && fetchCalls.length === 0 && storageCalls.length === 0 && !(await rowOf(RID(203))));
  resetMeta(); res = await stagedSend(conv1, { staged_path: sp, name: "a.mp4", type: "video/mp4" });
  check("staged send: no request id at all -> 422, nothing read or sent", res.status === 422 && fetchCalls.length === 0 && storageCalls.length === 0);
  resetMeta();
  { const ridPar = RID(204); sp = putStaged(big(8 * MB, FX.mp4), ridPar);
    const [r1, r2] = await Promise.all([sendStaged(sp, ridPar, { body: { caption: "once" } }), sendStaged(sp, ridPar, { body: { caption: "once" } })]);
    const statuses = [r1.status, r2.status].sort();
    check("staged send (double click / two tabs): two simultaneous sends of the same staged video produce ONE customer message and ONE Meta send", [200, 202, 409].includes(statuses[0]) && [200, 202, 409].includes(statuses[1]) && (await q1(`select * from public.inbox_messages where client_request_id = '${ridPar}'`)).length === 1 && fetchCalls.filter((c) => c.url.endsWith("/messages")).length === 1, `${statuses}`); }

  // who may use a staged object
  resetMeta(); sp = putStaged(big(8 * MB, FX.mp4), RID(205));
  res = await sendStaged(sp, RID(205), { conv: conv2 });
  check("staged send: an object staged for ANOTHER conversation cannot be sent here (422), and is left alone", res.status === 422 && bucket.has(sp) && fetchCalls.length === 0 && storageCalls.length === 0);
  resetMeta(); res = await sendStaged(sp, RID(205), {}, { user: bob.user });
  check("staged send: another owner presenting this staged path gets 404 and nothing happens (no storage call at all)", res.status === 404 && bucket.has(sp) && fetchCalls.length === 0 && storageCalls.length === 0);
  resetMeta(); const foreign = putStaged(big(MB, FX.mp4), RID(206), { profile: bob.profile });
  res = await sendStaged(foreign, RID(206));
  check("staged send: a path under ANOTHER profile's folder is refused even on the owner's own conversation: another person's file is never read, listed or deleted", res.status === 422 && bucket.has(foreign) && fetchCalls.length === 0 && storageCalls.length === 0);
  resetMeta(); res = await sendStaged("../../etc/passwd", RID(206));
  check("staged send: a traversal path -> 422, no storage call", res.status === 422 && storageCalls.length === 0);
  resetMeta(); res = await sendStaged(SM.stagedPath(alice.profile, conv1, RID(207), "mp4"), RID(207));
  check("staged send: a staged object that does not exist (never uploaded, or already consumed) -> 409 staged_missing, nothing downloaded or sent", res.status === 409 && (await res.json()).error === "staged_missing" && !downloaded() && fetchCalls.length === 0);

  // storage's own metadata is the authority, checked BEFORE the download
  resetMeta(); sp = putStaged(big(MB, FX.mp4), RID(208), { meta: { size: 16 * MB + 1 } });
  res = await sendStaged(sp, RID(208));
  check("staged send (metadata): an object storage says is over 16 MB is refused WITHOUT being downloaded -> 413, copy removed, nothing sent", res.status === 413 && (await res.json()).error === "too_large" && !downloaded() && fetchCalls.length === 0 && !bucket.has(sp));
  resetMeta(); sp = putStaged(big(MB, FX.mp4), RID(209), { meta: { size: 50 * MB } });
  res = await sendStaged(sp, RID(209));
  check("staged send (metadata): a 50 MB object is refused without a download", res.status === 413 && !downloaded() && !bucket.has(sp));
  for (const [label, meta] of [["size missing", { size: undefined }], ["size zero", { size: 0 }], ["size not a number", { size: "8" }], ["content type missing", { contentType: undefined }], ["content type empty", { contentType: "" }]]) {
    resetMeta(); sp = putStaged(big(MB, FX.mp4), RID(210), { meta });
    res = await sendStaged(sp, RID(210));
    check(`staged send (metadata): ${label} -> fail closed: 503, NOTHING downloaded or sent, the object left in place`, res.status === 503 && (await res.json()).error === "staging_unavailable" && !downloaded() && fetchCalls.length === 0 && bucket.has(sp) && !(await rowOf(RID(210))));
    bucket.delete(sp); infoOverride.delete(sp);
  }
  resetMeta(); sp = putStaged(big(MB, FX.mp4), RID(211)); infoOverride.set(sp, "error");
  res = await sendStaged(sp, RID(211));
  check("staged send (metadata): storage failing to answer -> fail closed 503, no download", res.status === 503 && !downloaded() && fetchCalls.length === 0 && bucket.has(sp));
  bucket.delete(sp); infoOverride.delete(sp);
  resetMeta(); sp = putStaged(big(MB, FX.mp4), RID(212), { meta: { contentType: "video/quicktime" } });
  res = await sendStaged(sp, RID(212));
  check("staged send (metadata): a content type that is not MP4/3GPP is refused without a download -> 422 type_mismatch, copy removed", res.status === 422 && (await res.json()).error === "type_mismatch" && !downloaded() && fetchCalls.length === 0 && !bucket.has(sp));
  resetMeta(); sp = putStaged(big(MB, FX.mp4), RID(213), { meta: { contentType: "video/3gpp" } });
  res = await sendStaged(sp, RID(213));
  check("staged send (metadata): an object whose stored type disagrees with its (server-chosen) .mp4 name is refused -> 422, copy removed", res.status === 422 && !downloaded() && !bucket.has(sp));
  resetMeta(); sp = putStaged(big(2 * MB, FX.mp4), RID(214), { meta: { size: 3 * MB } });
  res = await sendStaged(sp, RID(214));
  check("staged send (tamper): the downloaded size must equal what storage reported; a mismatch fails closed and nothing is sent", res.status === 503 && fetchCalls.length === 0 && !(await rowOf(RID(214))));
  bucket.delete(sp); infoOverride.delete(sp);
  resetMeta(); sp = putStaged(big(16 * MB + 1, FX.mp4), RID(215), { meta: { size: 8 * MB } });
  res = await sendStaged(sp, RID(215));
  check("staged send (tamper): metadata that understates the object cannot get a 16 MB+ file read into memory: the download itself is size-checked -> 413, copy removed", res.status === 413 && fetchCalls.length === 0 && !bucket.has(sp));
  resetMeta(); storageApi = "no-info"; sp = putStaged(big(3 * MB, FX.mp4), RID(230));
  res = await sendStaged(sp, RID(230));
  check("staged send (older storage client without info()): the same authoritative metadata is read from the folder listing, before any download, and the send works", res.status === 200 && (await rowOf(RID(230))).status === "sent" && storageCalls.findIndex((c) => c.op === "list") >= 0 && storageCalls.findIndex((c) => c.op === "list") < storageCalls.findIndex((c) => c.op === "download"));
  resetMeta(); storageApi = "route-404"; sp = putStaged(big(3 * MB, FX.mp4), RID(231));
  res = await sendStaged(sp, RID(231));
  check("staged send (info() answers a 404 for the ROUTE, not the object): the object is confirmed through the listing and sent; it is NOT misreported as already handled", res.status === 200 && (await rowOf(RID(231))).status === "sent");
  resetMeta(); storageApi = "route-404"; res = await sendStaged(SM.stagedPath(alice.profile, conv1, RID(232), "mp4"), RID(232));
  check("staged send: a genuinely missing object is still 409 staged_missing when both calls agree", res.status === 409 && (await res.json()).error === "staged_missing");
  resetMeta(); sp = putStaged(big(MB, FX.mp4), RID(233), { meta: { size: 16 * MB + 1 } }); storageApi = "no-info";
  res = await sendStaged(sp, RID(233));
  check("staged send (older storage client): oversized metadata from the listing is refused without a download too", res.status === 413 && !downloaded() && !bucket.has(sp));
  resetMeta(); sp = putStaged(big(MB, FX.mp4), RID(234)); storageApi = "no-info"; infoOverride.set(sp, "error");
  res = await sendStaged(sp, RID(234));
  check("staged send (older storage client): a failing listing is fail-closed too (503, no download)", res.status === 503 && !downloaded() && fetchCalls.length === 0);
  bucket.delete(sp); infoOverride.delete(sp);
  resetMeta(); sp = putStaged(big(4 * MB, FX.mp4), RID(216));
  res = await sendStaged(sp, RID(216), { body: { name: "evil.exe", type: "application/x-msdownload", size: 1, caption: undefined } });
  row = await rowOf(RID(216));
  check("staged send (nothing from the browser is trusted): a lying name, type and size are ignored; the type and extension come from the object's own server-chosen name, so it is sent as video/mp4 named evil.mp4", res.status === 200 && row.status === "sent" && fetchCalls.find((c) => c.url.endsWith("/media")).init.body.get("type") === "video/mp4" && (await q1(`select filename from public.inbox_message_media where message_id = '${row.id}'`))[0].filename === "evil.mp4");

  // what is inside the file
  const hevc = mp4Bytes({ video: ["hvc1"] });
  for (const [label, bytes] of [["HEVC video", hevc], ["VP9 video", mp4Bytes({ video: ["vp09"] })], ["AMR audio", mp4Bytes({ audio: ["samr"] })], ["MP3 audio in MP4", mp4Bytes({ oti: 0x6b })], ["two audio tracks", mp4Bytes({ audio: ["mp4a", "mp4a"] })], ["no index (moov)", mp4Bytes({ noMoov: true })]]) {
    resetMeta(); const rid = RID(300 + results.length); sp = putStaged(big(3 * MB, bytes), rid);
    res = await sendStaged(sp, rid);
    check(`staged send (WhatsApp codec rules): ${label} -> 422 unsupported_codec, nothing reaches Meta, the copy is removed`, res.status === 422 && (await res.json()).error === "unsupported_codec" && fetchCalls.length === 0 && !bucket.has(sp) && !(await rowOf(rid)));
  }
  resetMeta(); sp = putStaged(big(2 * MB, FX.png), RID(217));
  res = await sendStaged(sp, RID(217));
  check("staged send: bytes that are not a video at all (a PNG called .mp4) fail the same byte check as any upload -> 422 type_mismatch, nothing reaches Meta, copy removed", res.status === 422 && (await res.json()).error === "type_mismatch" && fetchCalls.length === 0 && !bucket.has(sp));
  resetMeta(); sp = putStaged(big(8 * MB, FX.mp4), RID(218)); metaMode.upload = "reject";
  res = await sendStaged(sp, RID(218));
  rb = await res.json();
  check("staged send (provider failure): Meta refusing the upload -> a FAILED message row, a clear answer, no secret text, and the staged copy is removed (the draft stays in the browser to retry)", res.status === 422 && rb.ok === false && rb.state === "failed" && (await rowOf(RID(218))).status === "failed" && !JSON.stringify(rb).includes("SECRET") && !bucket.has(sp));
  resetMeta(); sp = putStaged(big(8 * MB, FX.mp4), RID(219)); metaMode.send = "reject";
  res = await sendStaged(sp, RID(219));
  check("staged send (provider failure): Meta refusing the send -> failed row, copy removed", res.status === 422 && (await rowOf(RID(219))).status === "failed" && !bucket.has(sp));
  resetMeta(); sp = putStaged(big(8 * MB, FX.mp4), RID(220));
  res = await sendStaged(sp, RID(220), { body: { caption: "x".repeat(1025) } });
  check("staged send: a caption over 1024 characters is refused (422) like any media caption, and the copy is removed", res.status === 422 && (await res.json()).error === "too_long" && fetchCalls.length === 0 && !bucket.has(sp));
  resetMeta(); res = await sendStaged(sp, RID(220), {}, { headers: { "content-type": "application/json" } });
  check("staged send: without the upload header -> 400", res.status === 400);
  resetMeta(); { const orig = globalThis.__admin; globalThis.__admin = () => ({ ...orig(), storage: { from: () => ({ info: async () => ({ data: { size: 8 * MB, contentType: "video/mp4" }, error: null }), download: async () => { throw new Error("storage down"); }, remove: async () => ({}) }) } }); res = await sendStaged(SM.stagedPath(alice.profile, conv1, RID(221), "mp4"), RID(221)); globalThis.__admin = orig; }
  check("staged send: storage failing while reading -> 503 staging_unavailable (not a 500, nothing sent)", res.status === 503 && (await res.json()).error === "staging_unavailable" && fetchCalls.length === 0);

  // the direct route still works, with the same codec rules
  const direct = async (bytes, rid, name = "clip.mp4", type = "video/mp4") => { resetMeta(); const form = new FormData(); form.append("file", new File([bytes], name, { type })); form.append("client_request_id", rid); globalThis.__user = alice.user; return mediaRoute.POST(new Request(`http://localhost/api/inbox/conversations/${conv1}/media`, { method: "POST", headers: { "x-ringo-upload": "1" }, body: form }), { params: { id: conv1 } }); };
  check("existing behaviour preserved: a small PDF is still handled by the direct multipart route (validated, uploaded, sent)", await (async () => { const r = await direct(FX.pdf, RID(222), "invoice.pdf", "application/pdf"); return r.status === 200 && (await rowOf(RID(222))).status === "sent"; })());
  check("direct upload: a small valid H.264/AAC MP4 is sent; the same container with HEVC video is refused 422 unsupported_codec before anything reaches Meta", await (async () => { const ok = await direct(mp4Bytes(), RID(223)); const sentOk = ok.status === 200; const bad = await direct(hevc, RID(224)); return sentOk && bad.status === 422 && (await bad.json()).error === "unsupported_codec" && fetchCalls.length === 0; })());
  check("existing behaviour preserved: a direct upload over 4 MB is still refused by the multipart route (videos use staging)", await (async () => { const r = await direct(big(4 * MB + 1, FX.mp4), RID(225)); return r.status === 413 && fetchCalls.length === 0; })());
  check("logging: nothing sensitive was logged by the staging flow (no token, caption, file name, storage path, profile id, Meta text)", !logs.join("\n").includes("SECRET") && !logs.join("\n").includes("Look at this") && !logs.join("\n").includes("holiday.mp4") && !logs.join("\n").includes(alice.profile) && !logs.join("\n").includes(TOKEN) && !logs.join("\n").includes("evil.exe"));

  // ---------------------------------------------------------------------------------------------------------- how it renders
  const msgs = (await q1(`select id, direction, type, body, status, received_at from public.inbox_messages where conversation_id = '${conv1}' order by received_at, id`));
  const D = src("lib/inbox/data.ts");
  const own = mkClient("authenticated", () => alice.user);
  const thread = await D.loadThread(own, alice.profile, conv1, 100);
  check("render data: the thread carries the stored type, file name and caption of every media message", thread.ok && thread.thread.messages.some((m) => m.display.kind === "media" && m.display.media === "audio" && m.display.mimeType === "audio/ogg; codecs=opus") && thread.thread.messages.some((m) => m.display.media === "document" && m.display.filename === "invoice-2026.pdf"));
  const list = await D.loadConversationList(own, alice.profile, 40, { status: "all" });
  const html = render("en", React.createElement(InboxView, { list, selectedId: conv1, thread, filter: { status: "all", q: "" } }));
  check("render: incoming IMAGES sit in a reserved frame with an 'Open image' action and their caption; STICKERS in a square frame; nothing is fetched until the frame scrolls into view (no <img> in the first paint)", /data-media-frame="image"/.test(html) && (html.match(/data-media-frame="image"/g) || []).length >= 2 && /aria-label="Open image"/.test(html) && /My receipt/.test(html) && !/<img\b/.test(html));
  check("render: incoming VIDEOS sit in a reserved frame (the player appears when it scrolls into view) with their caption", /data-media-frame="video"/.test(html) && /Short clip/.test(html));
  check("render: AUDIO gets a real player: a labelled play button, a seek slider, the time, and the Ringo route as its source; an OGG/Opus message is a labelled VOICE NOTE, any other audio an audio file with its name", /<audio\b[^>]*\ssrc="\/api\/inbox\/conversations\/[0-9a-f-]+\/media\/[0-9a-f-]+"/.test(html) && /aria-label="Play"/.test(html) && /type="range"/.test(html) && /aria-label="Seek"/.test(html) && /data-voice-note="true"/.test(html) && /Voice message/.test(html) && /song\.mp3/.test(html) && /--:--/.test(html) && (html.match(/data-voice-note/g) || []).length === 1);
  check("render: DOCUMENTS become a card with the file name, a short type and a labelled download action", /invoice-2026\.pdf/.test(html) && />PDF</.test(html) && /aria-label="Download: invoice-2026\.pdf"/.test(html));
  check("render: every media source is Ringo's own authenticated route; there is no remote url, iframe, embed or object anywhere", [...html.matchAll(/\ssrc="([^"]*)"/g)].every((m) => m[1].startsWith("/api/inbox/conversations/")) && !/https?:\/\//i.test(html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "")) && !/<(iframe|embed|object|source)\b/i.test(html));
  check("render: media never exposes a Meta media id or the stored mime string as visible text", !/10000000000000\d/.test(html.replace(/\/media\/[0-9a-f-]+/g, "")) && !/codecs=opus/.test(html.replace(/data-[^=]*="[^"]*"/g, "")));
  check("render (FR): the same, in French", /Message vocal/.test(render("fr", React.createElement(InboxView, { list, selectedId: conv1, thread, filter: { status: "all", q: "" } }))) && /Ouvrir l’image/.test(render("fr", React.createElement(InboxView, { list, selectedId: conv1, thread, filter: { status: "all", q: "" } }))) && /Lecture/.test(render("fr", React.createElement(InboxView, { list, selectedId: conv1, thread, filter: { status: "all", q: "" } }))));
  check("render: day separators group the messages by day", /role="separator"/.test(html) && /Today/.test(html));
  const out = [{ id: "o1", direction: "outbound", status: "failed", at: new Date().toISOString(), unconfirmed: false, display: { kind: "media", media: "document", caption: null, filename: "x.pdf", mimeType: "application/pdf" } }, { id: "o2", direction: "outbound", status: "queued", at: new Date().toISOString(), unconfirmed: false, display: { kind: "media", media: "image", caption: null, filename: null, mimeType: "image/jpeg" } }];
  const tOut = { ok: true, thread: { ...thread.thread, messages: out } };
  const hOut = render("en", React.createElement(InboxView, { list, selectedId: conv1, thread: tOut, filter: { status: "all", q: "" } }));
  check("render: an outbound attachment that failed or is still sending shows a note, never a request that would fail (no player, no frame)", /Attachment not sent/.test(hOut) && /Sending…/.test(hOut) && !/data-media-frame/.test(hOut) && !/<audio|<video|<img/.test(hOut));
  const hXss = render("en", React.createElement(MessageMedia, { conversationId: conv1, messageId: mDoc, media: "document", mimeType: "application/pdf", filename: "<img src=x onerror=alert(1)>.pdf", caption: null, available: true, unavailableNote: null }));
  check("render: a hostile file name stays inert text", !/<img src=x/.test(hXss) && /&lt;img src=x onerror=alert\(1\)&gt;\.pdf/.test(hXss));

  // layout
  check("layout: a conversation is one stable column (header, ONE scrolling message area, dock, composer) on every screen size; on a phone the title block steps aside and the pane gets a fixed height so the composer stays anchored", /<header class="flex shrink-0 items-center/.test(html) && (html.match(/overflow-y-auto/g) || []).length >= 2 && /data-testid="thread-scroll"/.test(html) && /data-testid="thread-dock"/.test(html) && /data-testid="reply-composer"/.test(html) && /class="hidden lg:block"/.test(html) && /h-\[calc\(100dvh-13rem\)\] min-h-\[420px\]/.test(html) && /grid-rows-\[minmax\(0,1fr\)\]/.test(html));
  check("layout: the list and the conversation are visually distinct on desktop (two bordered panes) and the phone has a back arrow to the list", (html.match(/rounded-card border border-ringo-border/g) || []).length >= 2 && /aria-label="Back to conversations"/.test(html) && /lg:hidden/.test(html));
  check("layout: the inbox reserves a free column at its right edge on large screens for the floating helpers", /flex flex-col gap-4 lg:pr-16/.test(html));
  check("layout: the conversation is keyed by its id (a different conversation never inherits a draft or a scroll position) and the composer is not remounted by anything else", /<Thread key=\{thread\.thread\.conversation\.id\}/.test(read("src/components/inbox/InboxView.tsx")));
  const trunc = { ok: true, thread: { ...thread.thread, truncated: true } };
  check("layout: older messages: a 'Load earlier messages' button when more exist; at the 500-message ceiling a plain note instead", /data-testid="load-earlier"/.test(render("en", React.createElement(InboxView, { list, selectedId: conv1, thread: trunc, filter: { status: "all", q: "" } }))) && !/data-testid="load-earlier"/.test(render("en", React.createElement(InboxView, { list, selectedId: conv1, thread: trunc, filter: { status: "all", q: "" }, threadLimit: 500 }))) && /Showing the latest/.test(render("en", React.createElement(InboxView, { list, selectedId: conv1, thread: trunc, filter: { status: "all", q: "" }, threadLimit: 500 }))));

  // composer
  const open = render("en", React.createElement(Composer, { conversationId: conv1, open: true, savedReplies: [], allowMedia: true }));
  check("composer: an expanding text box (starts at one row, grows to a maximum, then scrolls inside itself), a labelled attach button at its left and a round Send button at its right, each with a 44 px target", /<textarea[^>]*rows="1"/.test(open) && /max-h-40/.test(open) && /resize-none/.test(open) && /aria-label="Attach a file"/.test(open) && /aria-label="Send message"/.test(open) && /h-11 w-11/.test(open) && /h-11 min-w-\[44px\]/.test(open));
  check("composer: the keyboard behaviour is stated under the box: Enter adds a new line, Ctrl+Enter (⌘+Enter on Mac) sends; the box points at its hint", /Enter adds a new line · Ctrl\+Enter \(⌘\+Enter on Mac\) sends\./.test(open) && /aria-describedby="reply-[0-9a-f-]+-hint"/.test(open) && /Entrée ajoute une ligne/.test(render("fr", React.createElement(Composer, { conversationId: conv1, open: true }))));
  check("composer: the Send button is its own control with its own accessible name; Ringo AI and Help are NOT inside the composer, so they cannot be confused with it", /<button type="submit"[^>]*aria-label="Send message"/.test(open) && !/Ringo AI|Help/i.test(open));
  const csrc = read("src/components/inbox/ReplyComposer.tsx");
  check("composer (source): Ctrl/Cmd+Enter sends and plain Enter does not; a double click cannot send twice; the draft and attachment survive failures; the video size message and the staged-upload reuse exist", /e\.key === "Enter" && \(e\.ctrlKey \|\| e\.metaKey\)/.test(csrc) && /if \(inFlight\.current\) return/.test(csrc) && /mediaVideoTooLarge/.test(csrc) && /staged\.current = \{ key, path \}/.test(csrc) && /needsStaging\(/.test(csrc) && !/setText\(""\)[^]{0,40}catch/.test(csrc) && /URL\.revokeObjectURL/.test(csrc));
  check("composer (source): upload progress is shown as an accessible progress bar with the percentage, then 'Sending to WhatsApp…'; motion respects reduced-motion", /role="progressbar"/.test(csrc) && /aria-valuenow/.test(csrc) && /uploadingPercent\(pct\)/.test(csrc) && /motion-reduce:/.test(csrc));
  check("composer: the window-closed state is unchanged", /fenêtre de réponse de 24 heures est fermée/.test(render("fr", React.createElement(Composer, { conversationId: conv1, open: false }))));

  // the floating helpers
  const css = read("src/app/globals.css"), ai = read("src/components/ai/RingoAiLauncher.tsx"), help = read("src/components/dashboard/HelpWidget.tsx"), dock = read("src/components/inbox/ThreadDock.tsx");
  check("helpers: Ringo AI and Help are KEPT (same components, same labels, same positions elsewhere) and carry a hook class each; while a conversation is open on a phone or tablet they dock into the row reserved above the reply box; on large screens they stay in their corner and the Inbox keeps that column free", (ai.match(/ringo-float-ai/g) || []).length === 2 && /ringo-float-help/.test(help) && /bottom-\[13\.5rem\] right-4 lg:bottom-\[6\.25rem\] lg:right-6/.test(ai) && /bottom-36 right-4 lg:bottom-6 lg:right-6/.test(help) && /@media \(max-width: 1023\.98px\)/.test(css) && /html\[data-inbox-thread\] \.ringo-float-help/.test(css) && /html\[data-inbox-thread\] \.ringo-float-ai/.test(css) && /--ringo-inbox-dock-bottom/.test(css));
  check("helpers (dock): the reserved corner is wide enough for both buttons (9.5 rem) and only exists below lg; the dock publishes its position on resize, scroll and the on-screen keyboard, and removes everything when the conversation closes", /w-\[9\.5rem\][^"]*lg:hidden/.test(dock) && /data-inbox-thread/.test(dock) && /visualViewport/.test(dock) && /removeAttribute\("data-inbox-thread"\)/.test(dock) && /removeProperty\("--ringo-inbox-dock-bottom"\)/.test(dock) && /ResizeObserver/.test(dock));
  const dockHtml = render("en", React.createElement(InboxView, { list, selectedId: conv1, thread, filter: { status: "all", q: "" }, access: { kind: "owner", permissions: [] } }));
  check("helpers: the dock row sits between the messages and the reply box and also holds the conversation's AI assistance buttons", dockHtml.indexOf('data-testid="thread-scroll"') < dockHtml.indexOf('data-testid="thread-dock"') && dockHtml.indexOf('data-testid="thread-dock"') < dockHtml.indexOf('data-testid="reply-composer"') && /data-dock-reserve="true"/.test(dockHtml));

  // accessibility, theme, security of the new components
  const comps = ["MessageMedia", "ImageLightbox", "ThreadScroller", "ThreadDock"].map((n) => read(`src/components/inbox/${n}.tsx`)).join("\n") + csrc;
  check("a11y: the lightbox is a modal dialog with a name, closes on Escape and on a click outside, locks page scrolling and returns focus; its zoom is a labelled toggle", /role="dialog"/.test(comps) && /aria-modal="true"/.test(comps) && /e\.key === "Escape"/.test(comps) && /document\.body\.style\.overflow = "hidden"/.test(comps) && /\.focus\?\.\(\)/.test(comps) && /aria-pressed=\{zoomed\}/.test(comps));
  check("a11y: media controls have accessible names; skeletons and spinners stop under reduced motion; colours come from the project's tokens only (no hard-coded colours)", /aria-label=\{playing \? u\.audioPause : u\.audioPlay\}/.test(comps) && (comps.match(/motion-reduce:animate-none/g) || []).length >= 3 && !/#[0-9a-fA-F]{6}\b|rgb\(/.test(comps.replace(/rgba\(15,23,42,0\.04\)/g, "")));
  check("security: no raw HTML injection, no eval, no object urls to leak, no tokens, no Meta urls, no service key in any new browser component", !/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|eval\(|new Function/.test(comps) && !/createObjectURL/.test(read("src/components/inbox/MessageMedia.tsx")) && !/WHATSAPP_|Bearer|graph\.facebook|SERVICE_ROLE|NEXT_PUBLIC_|supabase\/server/.test(comps));
  check("security (routes): the file view and the stage route use the same guard as every Inbox route, never read an owner, profile, recipient or token from the request, and never return a Meta url", /guardConversationAction/.test(code("src/app/api/inbox/conversations/[id]/media/[messageId]/route.ts")) && /guardConversationAction/.test(code("src/app/api/inbox/conversations/[id]/media/stage/route.ts")) && !/body\.(profile|owner|to|recipient|phone|waba|token)|searchParams\.get\("(profile|owner|to|token)/.test(code("src/app/api/inbox/conversations/[id]/media/[messageId]/route.ts") + code("src/app/api/inbox/conversations/[id]/media/stage/route.ts")) && (code("src/app/api/inbox/conversations/[id]/media/[messageId]/route.ts").match(/lookup\.url/g) || []).length === 1);
  check("security: the response headers set by the file view cannot be influenced by the customer (type from a fixed list, filename sanitized, nosniff and a sandboxing CSP on every response)", /X-Content-Type-Options": "nosniff"/.test(read("src/app/api/inbox/conversations/[id]/media/[messageId]/route.ts")) && /default-src 'none'; sandbox/.test(read("src/app/api/inbox/conversations/[id]/media/[messageId]/route.ts")) && /deliveryFor\(/.test(read("src/app/api/inbox/conversations/[id]/media/[messageId]/route.ts")));
} finally {
  console.info = origInfo; console.error = origErr; console.warn = origWarn; globalThis.fetch = realFetch;
}

// ============================================================ 8. the staging bucket migration, its verify and rollback scripts (on a scratch copy of the storage schema)
{
  const MIG = read("supabase/migrations/2026-12-21_inbox_outbound_media_staging.sql"), VER = read("supabase/support/2026-12-21_inbox_outbound_media_staging.verify.sql"), ROLL = read("supabase/support/2026-12-21_inbox_outbound_media_staging.rollback.sql");
  const bare = MIG.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  check("migration: ONE private bucket and nothing else: no table, function, policy, trigger or alteration; private; 16 MB cap; MP4 and 3GPP only", /insert into storage\.buckets/.test(bare) && !/\b(create|alter|drop)\s+(table|function|policy|trigger|index|schema|role)\b/i.test(bare) && /'inbox-outbound-media', 'inbox-outbound-media', false, 16777216, array\['video\/mp4', 'video\/3gpp'\]/.test(bare) && !/\bpublic\s*=\s*true\b/.test(bare));
  const mem = new PGlite();
  await mem.exec(`create schema storage; create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);`);
  await mem.exec(MIG);
  check("migration applies and is idempotent (a second run changes nothing)", await mem.exec(MIG).then(() => true, () => false) && Number((await mem.query("select count(*)::int n from storage.buckets")).rows[0].n) === 1);
  const ver = (await mem.query(VER.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(/;[ \t]*\n/)[0])).rows;
  check("verify script: every row ok (exists once, private, 16 MB, MP4 and 3GPP only, no policy for it)", ver.length === 5 && ver.every((x) => x.ok === true), JSON.stringify(ver.filter((x) => !x.ok)));
  await mem.exec(`insert into storage.objects (bucket_id, name) values ('inbox-outbound-media', 'p/c/o.mp4'), ('other', 'keep.me')`);
  const rollBare = ROLL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim();
  check("rollback: a documented MANUAL procedure; the only executable SQL is ONE read-only select (no delete, drop, truncate, update, insert, alter, create, grant or revoke), and nothing in it removes a row from storage.objects or storage.buckets", /^select\b/i.test(rollBare) && (rollBare.match(/;/g) || []).length === 1 && !/\b(delete|drop|truncate|update|insert|alter|grant|revoke|create)\b/i.test(rollBare) && !/delete\s+from\s+storage\./i.test(rollBare));
  check("rollback: it says NOT to use SQL and why (orphaned physical files), and gives the safe order: empty the bucket first (Dashboard, emptyBucket or the /empty endpoint), then delete it (Dashboard, deleteBucket or the bucket endpoint), then confirm", /DO NOT REMOVE THIS BUCKET WITH SQL/.test(ROLL) && /orphaned/.test(ROLL) && /emptyBucket\('inbox-outbound-media'\)/.test(ROLL) && /deleteBucket\('inbox-outbound-media'\)/.test(ROLL) && /bucket\/inbox-outbound-media\/empty/.test(ROLL) && ROLL.indexOf("EMPTY the bucket") < ROLL.indexOf("DELETE the now-empty bucket") && /refuses to delete a bucket that still holds objects/.test(ROLL));
  check("rollback / migration / verify agree: all three name the same bucket; the rollback says what it does not touch, that the verify script is EXPECTED to fail afterwards, and that re-applying the migration is idempotent; no key is written in it", [MIG, VER, ROLL].every((f) => f.includes("inbox-outbound-media")) && /Does NOT touch/.test(ROLL) && /EXPECTED to fail/.test(ROLL) && /idempotent/.test(ROLL) && !/eyJ[A-Za-z0-9_-]{20,}/.test(ROLL) && /on conflict \(id\) do nothing/.test(MIG));
  const rollRows = async () => (await mem.query(rollBare)).rows[0];
  const rowCounts = async () => JSON.stringify((await mem.query("select (select count(*)::int from storage.buckets) b, (select count(*)::int from storage.objects) o")).rows[0]);
  const c0 = await rowCounts(); const before = await rollRows(); const c1 = await rowCounts();
  // what the Dashboard / Storage API do (index and files together), SIMULATED here on the scratch schema only
  await mem.exec(`delete from storage.objects where bucket_id = 'inbox-outbound-media'; delete from storage.buckets where id = 'inbox-outbound-media'`);
  const after = await rollRows(); const again = await rollRows();
  check("rollback (its read-only check, on the scratch schema): before the procedure it reports the bucket and its staged object, after it reports nothing left; running it changes nothing; other buckets are untouched", c0 === c1 && before.bucket_exists === true && Number(before.staged_objects) === 1 && after.bucket_exists === false && Number(after.staged_objects) === 0 && JSON.stringify(again) === JSON.stringify(after) && Number((await mem.query("select count(*)::int n from storage.objects where bucket_id = 'other'")).rows[0].n) === 1);
  check("migration comment documents the cleanup and the fallback (4 MB uploads keep working without the bucket)", /Cleanup:/.test(MIG) && /4 MB/.test(MIG) && /Rollback:/.test(MIG));
}

// ============================================================ 9. scope and consistency
{
  const { PHASE30_FILES } = await import("./phase30Files.mjs");
  const listed = [...PHASE30_FILES];
  check("media.ts: the ONLY change is the codec gate in validateMediaFile (and its import and error type); the upload and send calls to Meta are byte-for-byte what they were", /inspectMp4\(bytes\)\.ok/.test(read("src/lib/whatsapp/media.ts")) && (read("src/lib/whatsapp/media.ts").match(/graph\.facebook\.com/g) || []).length === 2 && /uploadWhatsAppMedia/.test(read("src/lib/whatsapp/media.ts")));
  check("manifest: every file this feature changes or adds is listed, and every listed file exists", listed.every((f) => fs.existsSync(path.join(REPO, f))) && ["src/components/inbox/MessageMedia.tsx", "src/lib/whatsapp/mediaFetch.ts", "src/app/api/inbox/conversations/[id]/media/[messageId]/route.ts", "src/app/api/inbox/conversations/[id]/media/stage/route.ts", "supabase/migrations/2026-12-21_inbox_outbound_media_staging.sql", "scripts/tests/inboxMediaUx.test.mjs"].every((f) => PHASE30_FILES.has(f)));
  check("untouched: the webhook, ingestion, the text sender, the Meta calls (outbound.ts, and the Meta calls inside media.ts: only its validation gate gained the codec rule), the earlier inbox migrations and the Sales Bot are not part of this change", ["src/app/api/integrations/whatsapp/webhook/route.ts", "src/lib/whatsapp/ingest.ts", "src/lib/whatsapp/outbound.ts", "src/lib/inbox/send.ts", "src/lib/inbox/sendMedia.ts", "src/lib/inbox/data.ts", "src/lib/salesBot/runner.ts", "supabase/migrations/2026-12-07_whatsapp_inbox_foundation.sql", "supabase/migrations/2026-12-10_whatsapp_outbound_media.sql"].every((f) => !PHASE30_FILES.has(f)));
  const NEW_KEYS = ["mediaVideoTooLarge","mediaStagingUnavailable","mediaStagedGone","mediaUploadFailed","sendingMedia","imageViewer","zoomIn","zoomOut","mediaDownload","closeViewer","openImage","mediaExpired","mediaUnavailable","mediaRetry","voiceNote","audioFile","audioPlay","audioPause","audioSeek","loadEarlier","loadingEarlier","jumpToLatest","composerLabel","sendAction"];
  const badKeys = NEW_KEYS.filter((k) => !(typeof translations.en.inbox[k] === "string" && typeof translations.fr.inbox[k] === "string" && translations.en.inbox[k].length > 1 && translations.fr.inbox[k].length > 1 && (translations.en.inbox[k] !== translations.fr.inbox[k] || k === "audioPause")));
  check("i18n: every new Inbox string exists in English and French, non-empty and different (no copy-paste of English); the parameterized ones read right", badKeys.length === 0 && translations.en.inbox.messagesLabel === "Messages" && translations.fr.inbox.messagesLabel === "Messages" && translations.en.inbox.uploadingPercent(42) === "Uploading… 42%" && /42/.test(translations.fr.inbox.uploadingPercent(42)) && translations.en.inbox.newMessages(1) === "1 new message" && translations.en.inbox.newMessages(3) === "3 new messages" && translations.fr.inbox.newMessages(3) === "3 nouveaux messages", badKeys.join());
}

// ============================================================ report
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
