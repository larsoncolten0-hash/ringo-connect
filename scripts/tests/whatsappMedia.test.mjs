// Phase 9 outbound MEDIA, end to end: real validation (magic-byte sniffing), the real Meta upload/send calls (mocked fetch, no network), the REAL route
// handler and orchestrator, and the REAL database functions (Phase 4 + 7 + 8 + 9 migrations) on scratch in-memory PostgreSQL (PGlite), plus the UI.
// No Supabase, no network, no credentials, no production ids, no real WhatsApp message (every id, number and the "token" below are synthetic).
//   Run:  node scripts/tests/whatsappMedia.test.mjs
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { makeClientFactory } from "./pgliteShim.mjs";

const nodeRequire = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const ts = nodeRequire("typescript");
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 500)); };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");

// ---- TS/TSX loader with stand-ins for the framework modules --------------------------------------------------------------------------
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const STUBS = {
  "next/link": { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) },
  "next/navigation": { redirect: () => { throw new Error("redirect"); }, notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ refresh() {} }) },
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
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const req = (spec) => { if (STUBS[spec]) return STUBS[spec]; const local = resolveLocal(spec, path.dirname(file)); return local ? loadTs(local) : nodeRequire(spec); };
  new Function("exports", "require", "module", "__filename", out)(mod.exports, req, mod, file);
  return mod.exports;
}
const src = (p) => loadTs(path.join(SRC, p));
const M = src("lib/whatsapp/media.ts");
const R = src("lib/whatsapp/mediaRules.ts");
const C = src("lib/inbox/client.ts");
const D = src("lib/inbox/data.ts");
const F = src("lib/inbox/format.ts");
const route = src("app/api/inbox/conversations/[id]/media/route.ts");
const { LanguageProvider } = src("components/LanguageProvider.tsx");
const InboxView = src("components/inbox/InboxView.tsx").default;
const Composer = src("components/inbox/ReplyComposer.tsx").default;
const { translations } = src("lib/i18n/translations.ts");
const render = (locale, el) => renderToStaticMarkup(React.createElement(LanguageProvider, { initialLocale: locale }, el));

// ---- byte fixtures: REAL file headers, so the sniffer is exercised on what browsers actually send --------------------------------------
const pad = (arr, n = 64) => Uint8Array.from([...arr, ...Array(Math.max(0, n - arr.length)).fill(0x41)]);
const str = (s) => [...s].map((c) => c.charCodeAt(0));
const FX = {
  jpeg: pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...str("JFIF")]),
  png: pad([0x89, ...str("PNG"), 0x0d, 0x0a, 0x1a, 0x0a]),
  pdf: pad(str("%PDF-1.7\n")),
  zip: pad([0x50, 0x4b, 0x03, 0x04, ...str("[Content_Types].xml")]),
  ole: pad([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  mp4: pad([0, 0, 0, 0x18, ...str("ftypisom")]),
  gp3: pad([0, 0, 0, 0x14, ...str("ftyp3gp4")]),
  m4a: pad([0, 0, 0, 0x18, ...str("ftypM4A ")]),
  qt: pad([0, 0, 0, 0x14, ...str("ftypqt  ")]),
  oggOpus: pad([...str("OggS"), 0, 2, ...Array(20).fill(0), ...str("OpusHead")], 96),
  oggVorbis: pad([...str("OggS"), 0, 2, ...Array(20).fill(0), 1, ...str("vorbis")], 96),
  mp3: pad(str("ID3")),
  mp3frame: pad([0xff, 0xfb, 0x90, 0x00]),
  aac: pad([0xff, 0xf1, 0x50, 0x80]),
  amr: pad(str("#!AMR\n")),
  txt: Uint8Array.from(Buffer.from("Hello, café — plain text.\n", "utf8")),
  exe: pad([0x4d, 0x5a, 0x90, 0x00]),
  html: Uint8Array.from(Buffer.from("<html><script>alert(1)</script></html>")),
  svg: Uint8Array.from(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")),
  binary: pad([0, 1, 2, 3, 0, 0, 0, 0]),
};
const v = (name, type, bytes) => M.validateMediaFile({ name, type, bytes });

// ============================================================ validation: every supported type passes, nothing else does
const GOOD = [
  ["image", "image/jpeg", "photo.jpg", FX.jpeg], ["image", "image/jpeg", "photo.JPEG", FX.jpeg], ["image", "image/png", "shot.png", FX.png],
  ["video", "video/mp4", "clip.mp4", FX.mp4], ["video", "video/3gpp", "clip.3gp", FX.gp3],
  ["audio", "audio/aac", "voice.aac", FX.aac], ["audio", "audio/mp4", "voice.m4a", FX.m4a], ["audio", "audio/mpeg", "song.mp3", FX.mp3], ["audio", "audio/mpeg", "song2.mp3", FX.mp3frame],
  ["audio", "audio/amr", "note.amr", FX.amr], ["audio", "audio/ogg", "note.ogg", FX.oggOpus], ["audio", "audio/ogg; codecs=opus", "note.opus", FX.oggOpus],
  ["document", "application/pdf", "invoice.pdf", FX.pdf], ["document", "application/msword", "letter.doc", FX.ole], ["document", "application/vnd.ms-excel", "sheet.xls", FX.ole],
  ["document", "application/vnd.ms-powerpoint", "deck.ppt", FX.ole],
  ["document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "letter.docx", FX.zip],
  ["document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "sheet.xlsx", FX.zip],
  ["document", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "deck.pptx", FX.zip],
  ["document", "text/plain", "notes.txt", FX.txt],
];
for (const [kind, type, name, bytes] of GOOD) {
  const r = v(name, type, bytes);
  check(`validate OK: ${name} (${type})`, r.ok && r.kind === kind && r.size === bytes.length && r.sha256.length === 64 && R.MEDIA_TYPES[r.mime]?.kind === kind, JSON.stringify(r));
}
check("validate: the sha256 is the real digest of the bytes", v("a.png", "image/png", FX.png).sha256 === crypto.createHash("sha256").update(FX.png).digest("hex"));
const BAD = [
  ["empty file", v("a.jpg", "image/jpeg", new Uint8Array(0)), "empty_file"],
  ["unsupported type image/gif", v("a.gif", "image/gif", pad(str("GIF89a"))), "unsupported_type"],
  ["unsupported type text/html", v("a.html", "text/html", FX.html), "unsupported_type"],
  ["unsupported type image/svg+xml", v("a.svg", "image/svg+xml", FX.svg), "unsupported_type"],
  ["unsupported type application/x-msdownload", v("a.exe", "application/x-msdownload", FX.exe), "unsupported_type"],
  ["unsupported type application/octet-stream with no usable extension", v("a.bin", "application/octet-stream", FX.binary), "unsupported_type"],
  ["sticker (webp) is not an outbound type", v("a.webp", "image/webp", pad(str("RIFF"))), "unsupported_type"],
  ["PNG bytes declared as JPEG", v("a.jpg", "image/jpeg", FX.png), "type_mismatch"],
  ["an EXE declared as a PDF", v("invoice.pdf", "application/pdf", FX.exe), "type_mismatch"],
  ["HTML declared as a PNG", v("a.png", "image/png", FX.html), "type_mismatch"],
  ["a script declared as plain text is refused only if it is not text (HTML IS valid UTF-8 text: it passes as text, never rendered)", v("a.txt", "text/plain", FX.html), null],
  ["binary declared as text", v("a.txt", "text/plain", FX.binary), "type_mismatch"],
  ["QuickTime declared as MP4", v("a.mp4", "video/mp4", FX.qt), "type_mismatch"],
  ["OGG/Vorbis (not Opus) declared as audio/ogg", v("a.ogg", "audio/ogg", FX.oggVorbis), "type_mismatch"],
  ["a ZIP declared as a PDF", v("a.pdf", "application/pdf", FX.zip), "type_mismatch"],
  ["extension of another type (a.pdf declared as video/mp4)", v("a.pdf", "video/mp4", FX.mp4), "type_mismatch"],
  ["double extension 'invoice.pdf.exe'", v("invoice.pdf.exe", "application/pdf", FX.pdf), "type_mismatch"],
  ["no extension at all", v("invoice", "application/pdf", FX.pdf), "bad_filename"],
  ["a name of only dots and symbols", v("...", "application/pdf", FX.pdf), "bad_filename"],
  ["non-string name", v(null, "application/pdf", FX.pdf), "bad_filename"],
];
for (const [name, r, expected] of BAD) check(`validate refuses: ${name}`, expected === null ? r.ok : !r.ok && r.error === expected, JSON.stringify(r));
check("validate: the effective size limit is min(Meta, 4 MB) for every type; exactly at the limit passes, one byte over is too_large", ["image/jpeg", "image/png", "video/mp4", "audio/mpeg", "application/pdf", "text/plain"].every((t) => R.maxBytesFor(t) === R.MEDIA_MAX_BYTES) && R.MEDIA_MAX_BYTES === 4 * 1024 * 1024
  && (() => { const edge = new Uint8Array(R.MEDIA_MAX_BYTES); edge.set(FX.pdf); const over = new Uint8Array(R.MEDIA_MAX_BYTES + 1); over.set(FX.pdf); return v("a.pdf", "application/pdf", edge).ok && v("a.pdf", "application/pdf", over).error === "too_large"; })());
check("validate: Meta's own limits are recorded (image 5 MB, video/audio 16 MB, document 100 MB) and never exceeded by Ringo's cap", R.MEDIA_TYPES["image/jpeg"].metaMaxBytes === 5 * 1024 * 1024 && R.MEDIA_TYPES["video/mp4"].metaMaxBytes === 16 * 1024 * 1024 && R.MEDIA_TYPES["audio/mpeg"].metaMaxBytes === 16 * 1024 * 1024 && R.MEDIA_TYPES["application/pdf"].metaMaxBytes === 100 * 1024 * 1024 && Object.keys(R.MEDIA_TYPES).every((t) => R.maxBytesFor(t) <= R.MEDIA_TYPES[t].metaMaxBytes));
check("validate: a missing/octet-stream browser type falls back to the extension, still checked against the real bytes", v("note.amr", "", FX.amr).ok && v("note.amr", "application/octet-stream", FX.amr).ok && !v("note.amr", "", FX.png).ok && !v("photo.jpg", "", FX.png).ok);
check("filename: directories and traversal are stripped; unsafe characters replaced; control characters removed", M.sanitizeFilename("../../etc/passwd.pdf") === "passwd.pdf" && M.sanitizeFilename("C:\\Users\\x\\inv.pdf") === "inv.pdf" && M.sanitizeFilename("a<b>|c\u0000d.pdf") === "a_b_c_d.pdf" && M.sanitizeFilename("  .hidden.pdf") === "hidden.pdf" && M.sanitizeFilename("été 2026 (final).pdf") === "été 2026 (final).pdf");
check("filename: long names are truncated to 100 characters and keep their extension; unusable names give null", (() => { const n = M.sanitizeFilename("x".repeat(300) + ".pdf"); return n.length <= 100 && n.endsWith(".pdf"); })() && M.sanitizeFilename("") === null && M.sanitizeFilename("///") === null && M.sanitizeFilename(42) === null);
check("filename: markup in a name stays inert text (escaped on display, never used as HTML)", M.sanitizeFilename("<script>alert(1)</script>.pdf") === "script_.pdf");
check("browser early check (checkAttachmentMeta) agrees: ok / too_large / unsupported / mismatch / empty", R.checkAttachmentMeta({ name: "a.jpg", type: "image/jpeg", size: 1000 }) === "ok" && R.checkAttachmentMeta({ name: "a.jpg", type: "image/jpeg", size: R.MEDIA_MAX_BYTES + 1 }) === "too_large" && R.checkAttachmentMeta({ name: "a.gif", type: "image/gif", size: 10 }) === "unsupported_type" && R.checkAttachmentMeta({ name: "a.pdf", type: "video/mp4", size: 10 }) === "type_mismatch" && R.checkAttachmentMeta({ name: "a.jpg", type: "image/jpeg", size: 0 }) === "empty_file" && R.checkAttachmentMeta({ name: "n.amr", type: "", size: 10 }) === "ok");
check("mediaRules.ts is browser-safe: no Node module, no process, no network, no token", !/require\(|from "crypto"|from "fs"|process\.|fetch\(|WHATSAPP_|Bearer/.test(read("src/lib/whatsapp/mediaRules.ts").replace(/\/\/.*$/gm, "")));

// ============================================================ Meta calls (mocked fetch)
{
  const calls = [];
  const mk = (res) => async (url, init) => { calls.push({ url: String(url), init }); return typeof res === "function" ? res(url, init) : res; };
  const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const up = (fetchImpl) => M.uploadWhatsAppMedia({ phoneNumberId: "1110000000001", token: "tok-synthetic", bytes: FX.pdf, mime: "application/pdf", filename: "invoice.pdf" }, fetchImpl);
  const o = await up(mk(J(200, { id: "META_MEDIA_1" })));
  check("upload: multipart to /<phone_number_id>/media with messaging_product, type and the named file; Bearer token; no redirects; timeout signal", o.kind === "ok" && o.mediaId === "META_MEDIA_1" && calls[0].url === "https://graph.facebook.com/v21.0/1110000000001/media" && calls[0].init.method === "POST" && calls[0].init.body instanceof FormData && calls[0].init.body.get("messaging_product") === "whatsapp" && calls[0].init.body.get("type") === "application/pdf" && calls[0].init.body.get("file").name === "invoice.pdf" && calls[0].init.body.get("file").type === "application/pdf" && calls[0].init.headers.Authorization === "Bearer tok-synthetic" && calls[0].init.redirect === "error" && calls[0].init.signal instanceof AbortSignal);
  check("upload: no explicit Content-Type header (the multipart boundary is set by fetch)", !("Content-Type" in calls[0].init.headers));
  check("upload outcomes: 4xx -> rejected (numeric code only); 5xx, 408, timeout, network, unreadable answer, answer without an id -> unavailable", (await up(mk(J(400, { error: { code: 131053, message: "SECRET META TEXT" } })))).code === 131053 && (await up(mk(J(500, {})))).kind === "unavailable" && (await up(mk(J(408, {})))).kind === "unavailable"
    && (await up(mk(() => { const e = new Error("t"); e.name = "TimeoutError"; throw e; }))).kind === "unavailable" && (await up(mk(() => { throw new TypeError("fetch failed"); }))).kind === "unavailable" && (await up(mk(new Response("<html>", { status: 200 })))).kind === "unavailable" && (await up(mk(J(200, {})))).kind === "unavailable" && (await up(mk(J(200, { id: "x".repeat(300) })))).kind === "unavailable");
  check("upload: a hostile phone_number_id, an unknown type or empty bytes never reach the network", await (async () => { calls.length = 0; const a = await M.uploadWhatsAppMedia({ phoneNumberId: "1/../x", token: "t", bytes: FX.pdf, mime: "application/pdf", filename: "a.pdf" }, mk(J(200, { id: "x" }))); const b = await M.uploadWhatsAppMedia({ phoneNumberId: "1110000000001", token: "t", bytes: FX.pdf, mime: "text/html", filename: "a.html" }, mk(J(200, { id: "x" }))); const c = await M.uploadWhatsAppMedia({ phoneNumberId: "1110000000001", token: "t", bytes: new Uint8Array(0), mime: "application/pdf", filename: "a.pdf" }, mk(J(200, { id: "x" }))); return a.kind === "rejected" && b.kind === "rejected" && c.kind === "rejected" && calls.length === 0; })());
  const sendBody = async (args) => { calls.length = 0; const r = await M.sendWhatsAppMedia({ phoneNumberId: "1110000000001", to: "237600000001", token: "tok-synthetic", ...args }, mk(J(200, { messages: [{ id: "wamid.X" }] }))); return { r, url: calls[0]?.url, body: calls[0] ? JSON.parse(calls[0].init.body) : null, headers: calls[0]?.init.headers }; };
  const si = await sendBody({ kind: "image", mediaId: "MID", caption: "Hello", filename: "p.jpg" });
  check("send image: type image, media id, caption; no filename; to = the given recipient; no link/url anywhere", si.r.kind === "accepted" && si.url === "https://graph.facebook.com/v21.0/1110000000001/messages" && si.body.type === "image" && si.body.image.id === "MID" && si.body.image.caption === "Hello" && !("filename" in si.body.image) && si.body.to === "237600000001" && si.body.messaging_product === "whatsapp" && !/"link"|http/.test(JSON.stringify(si.body)) && si.headers.Authorization === "Bearer tok-synthetic");
  const sd = await sendBody({ kind: "document", mediaId: "MID", caption: "Invoice", filename: "inv.pdf" });
  check("send document: media id + caption + filename", sd.body.type === "document" && sd.body.document.id === "MID" && sd.body.document.caption === "Invoice" && sd.body.document.filename === "inv.pdf");
  const sa = await sendBody({ kind: "audio", mediaId: "MID", caption: "ignored", filename: "ignored.mp3" });
  check("send audio: ONLY the media id (caption and filename are dropped: WhatsApp audio has neither)", sa.body.type === "audio" && JSON.stringify(sa.body.audio) === JSON.stringify({ id: "MID" }));
  const sv = await sendBody({ kind: "video", mediaId: "MID", caption: "Clip", filename: "c.mp4" });
  check("send video: media id + caption, no filename", sv.body.type === "video" && sv.body.video.id === "MID" && sv.body.video.caption === "Clip" && !("filename" in sv.body.video));
  check("send: no caption -> no caption key", !("caption" in (await sendBody({ kind: "image", mediaId: "MID", caption: null, filename: null })).body.image));
  const sx = (res) => M.sendWhatsAppMedia({ phoneNumberId: "1110000000001", to: "237600000001", kind: "image", mediaId: "MID", caption: null, filename: null, token: "t" }, mk(res));
  check("send outcomes: window 131047 -> rejected/window_closed, 429 -> rate_limited, 400 -> rejected, 5xx/timeout/network/no id -> UNKNOWN (never resent)", (await sx(J(400, { error: { code: 131047 } }))).error === "window_closed" && (await sx(J(429, {}))).error === "rate_limited" && (await sx(J(400, { error: { code: 100 } }))).error === "rejected" && (await sx(J(503, {}))).kind === "unknown" && (await sx(() => { throw new TypeError("x"); })).kind === "unknown" && (await sx(J(200, { messages: [] }))).kind === "unknown");
  check("send: hostile recipient / phone number id / kind never reach the network", await (async () => { calls.length = 0; const a = await M.sendWhatsAppMedia({ phoneNumberId: "1110000000001", to: "237;drop", kind: "image", mediaId: "M", caption: null, filename: null, token: "t" }, mk(J(200, {}))); const b = await M.sendWhatsAppMedia({ phoneNumberId: "1110000000001", to: "237600000001", kind: "sticker", mediaId: "M", caption: null, filename: null, token: "t" }, mk(J(200, {}))); return a.kind === "rejected" && b.kind === "rejected" && calls.length === 0; })());
}

// ============================================================ the route, end to end on the real database functions
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
await ingest({ phone: PH_A, id: "wamid.IN2", from: "237600000002", ts: hoursAgo(30), name: "Customer Two" });
await ingest({ phone: PH_B, id: "wamid.INB", from: "237611111111", ts: hoursAgo(1), name: "Bob Customer" });
const q1 = async (sql) => (await db.query(sql)).rows;
const count = async (t, w = "true") => Number((await q1(`select count(*)::int n from public.${t} where ${w}`))[0].n);
const convOf = async (wa) => (await q1(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0].id;
const conv1 = await convOf("237600000001"), conv2 = await convOf("237600000002"), convB = await convOf("237611111111");
const outRows = async (cond = "true") => q1(`select * from public.inbox_messages where direction = 'outbound' and ${cond} order by created_at, id`);

const mkClient = makeClientFactory(db);
let chain = Promise.resolve();
const asService = (sql) => { const run = async () => { await db.exec("set role service_role"); try { return await db.query(sql); } finally { await db.exec("reset role"); } }; const p = chain.then(run, run); chain = p.then(() => undefined, () => undefined); return p; };
globalThis.__user = null;
globalThis.__sb = () => { const c = mkClient(globalThis.__user ? "authenticated" : "anon", () => globalThis.__user); return { auth: { getUser: async () => ({ data: { user: globalThis.__user ? { id: globalThis.__user } : null } }) }, from: (t) => c.from(t) }; };
let rpcMode = "ok"; let rpcCalls = [];
globalThis.__admin = () => {
  if (rpcMode === "no_client") throw new Error("supabaseUrl is required");
  return { rpc: async (fn, args) => {
    rpcCalls.push({ fn, args });
    if (rpcMode === "prepare_error" && fn === "inbox_prepare_outbound_media") return { data: null, error: { code: "XX000", message: "row contains SECRET CAPTION" } };
    if (rpcMode === "complete_error" && fn === "inbox_complete_outbound_media") return { data: null, error: { code: "XX000", message: "boom" } };
    const named = Object.entries(args).map(([k, val]) => `${k} => ${sq(val)}`).join(", ");
    try { return { data: (await asService(`select public.${fn}(${named}) as r`)).rows[0].r, error: null }; } catch (e) { return { data: null, error: { code: e.code || "XX000", message: e.message } }; }
  } };
};
let uploadMode = "ok", sendMode = "accept"; let fetchCalls = []; let seq = 0;
const realFetch = globalThis.fetch;
const JR = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url, init) => {
  const u = String(url); const isUpload = u.endsWith("/media");
  fetchCalls.push({ url: u, init, isUpload });
  if (isUpload) {
    switch (uploadMode) {
      case "ok": return JR(200, { id: `META_MEDIA_${++seq}` });
      case "reject": return JR(400, { error: { code: 131053, message: "SECRET META TEXT unsupported" } });
      case "server": return JR(500, { error: { message: "SECRET META TEXT" } });
      case "timeout": { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; }
      case "network": throw new TypeError("fetch failed");
      case "noid": return JR(200, {});
    }
  }
  switch (sendMode) {
    case "accept": return JR(200, { messaging_product: "whatsapp", messages: [{ id: `wamid.SENTMEDIA${++seq}` }] });
    case "window": return JR(400, { error: { code: 131047, message: "SECRET META TEXT re-engagement" } });
    case "reject": return JR(400, { error: { code: 100, message: "SECRET META TEXT" } });
    case "rate": return JR(429, { error: { code: 130429, message: "SECRET META TEXT" } });
    case "server": return JR(500, { error: { message: "SECRET META TEXT" } });
    case "noid": return JR(200, { messages: [] });
    case "timeout": { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; }
  }
  throw new Error("unknown mode");
};
const reset = () => { uploadMode = "ok"; sendMode = "accept"; rpcMode = "ok"; fetchCalls = []; rpcCalls = []; };
process.env.WHATSAPP_ACCESS_TOKEN = TOKEN;
const logs = []; const origInfo = console.info, origErr = console.error, origWarn = console.warn;
console.info = (...a) => logs.push(a.join(" ")); console.error = (...a) => logs.push(a.join(" ")); console.warn = (...a) => logs.push(a.join(" "));

const file = (bytes, name, type) => new File([bytes], name, { type });
const post = (convId, fields, { user = alice.user, headers = { "x-ringo-upload": "1" }, raw } = {}) => {
  globalThis.__user = user;
  const form = new FormData();
  for (const [k, val] of Object.entries(fields)) if (val !== undefined) form.append(k, val);
  return route.POST(new Request(`http://localhost/api/inbox/conversations/${convId}/media`, { method: "POST", headers, body: raw ?? form }), { params: { id: convId } });
};
const send = async (convId, f, req, opts) => { const r = await post(convId, { client_request_id: req, ...f }, opts); return { status: r.status, body: await r.json() }; };
const pdf = () => ({ file: file(FX.pdf, "invoice.pdf", "application/pdf") });
const countFetch = (kind) => fetchCalls.filter((c) => (kind === "upload" ? c.isUpload : !c.isUpload)).length;

try {
  // ---------- refusals: nothing is uploaded, sent or stored
  reset();
  let r = await send(conv1, pdf(), RID(1), { user: null });
  check("unauthenticated -> 401, nothing contacted or stored", r.status === 401 && fetchCalls.length === 0 && (await outRows()).length === 0, JSON.stringify(r));
  r = await send(conv1, pdf(), RID(1), { user: carol.user });
  check("a user with no profile / no WhatsApp account (e.g. staff) -> 403, nothing contacted", r.status === 403 && fetchCalls.length === 0 && rpcCalls.length === 0);
  r = await send(conv1, pdf(), RID(1), { user: bob.user });
  check("another profile's owner cannot send media through a guessed conversation id -> 404, nothing uploaded or sent", r.status === 404 && fetchCalls.length === 0 && (await outRows()).length === 0, JSON.stringify(r));
  reset();
  r = await post(conv1, { client_request_id: RID(2), ...pdf() }, { headers: {} });
  check("a request without the upload header -> 400 (a cross-site form post cannot set it), nothing happens", r.status === 400 && fetchCalls.length === 0 && rpcCalls.length === 0);
  globalThis.__user = alice.user;
  r = await route.POST(new Request(`http://localhost/api/inbox/conversations/${conv1}/media`, { method: "POST", headers: { "x-ringo-upload": "1", "content-type": "application/json" }, body: "{}" }), { params: { id: conv1 } });
  check("a non-multipart body -> 415", r.status === 415 && fetchCalls.length === 0);
  r = await route.POST(new Request(`http://localhost/api/inbox/conversations/${conv1}/media`, { method: "POST", headers: { "x-ringo-upload": "1", "content-type": "multipart/form-data; boundary=x" }, body: "not a real multipart body" }), { params: { id: conv1 } });
  check("a malformed multipart body -> 400", r.status === 400 && fetchCalls.length === 0);
  const big = new Uint8Array(R.MEDIA_MAX_BYTES + 1); big.set(FX.pdf);
  r = await send(conv1, { file: file(big, "big.pdf", "application/pdf") }, RID(3));
  check("a file over 4 MB -> 413, nothing stored or sent", r.status === 413 && r.body.error === "too_large" && fetchCalls.length === 0 && (await outRows()).length === 0);
  r = await send(conv1, {}, RID(4));
  check("no file field -> 422 empty_file", r.status === 422 && r.body.error === "empty_file" && fetchCalls.length === 0);
  r = await send(conv1, { file: "just a string, not a file" }, RID(4));
  check("a text field named 'file' is not accepted as a file", r.status === 422 && r.body.error === "empty_file");
  r = await send(conv1, { file: file(new Uint8Array(0), "a.pdf", "application/pdf") }, RID(5));
  check("an empty file -> 422 empty_file", r.status === 422 && r.body.error === "empty_file" && fetchCalls.length === 0);
  const refusals = [["image/gif", "a.gif", pad(str("GIF89a")), "unsupported_type"], ["application/pdf", "inv.pdf", FX.exe, "type_mismatch"], ["application/pdf", "inv.pdf.exe", FX.pdf, "type_mismatch"], ["application/pdf", "inv", FX.pdf, "bad_filename"], ["text/html", "a.html", FX.html, "unsupported_type"]];
  for (const [t, n, b, err] of refusals) { r = await send(conv1, { file: file(b, n, t) }, RID(6)); check(`refused before anything is stored or sent: ${n} (${t}) -> ${err}`, r.status === 422 && r.body.error === err && fetchCalls.length === 0 && (await outRows()).length === 0, JSON.stringify(r)); }
  r = await send(conv1, { ...pdf(), client_request_id: "not-a-uuid" }, "not-a-uuid");
  check("a malformed client_request_id -> 422 invalid", r.status === 422 && r.body.error === "invalid");
  r = await send("../x", pdf(), RID(7));
  check("a malformed conversation id -> 422 invalid", r.status === 422 && r.body.error === "invalid" && fetchCalls.length === 0);
  r = await send(conv1, { file: file(FX.mp3, "a.mp3", "audio/mpeg"), caption: "not allowed on audio" }, RID(8));
  check("a caption on an audio file -> 422 caption_not_allowed, nothing stored or sent", r.status === 422 && r.body.error === "caption_not_allowed" && fetchCalls.length === 0 && (await outRows()).length === 0);
  r = await send(conv1, { ...pdf(), caption: "c".repeat(1025) }, RID(9));
  check("a caption over 1024 characters -> 422 too_long", r.status === 422 && r.body.error === "too_long" && fetchCalls.length === 0);
  reset();
  process.env.WHATSAPP_ACCESS_TOKEN = "  ";
  r = await send(conv1, pdf(), RID(10));
  check("no access token configured -> 503 not_configured BEFORE anything is stored, uploaded or sent", r.status === 503 && r.body.error === "not_configured" && fetchCalls.length === 0 && rpcCalls.length === 0 && (await outRows()).length === 0);
  process.env.WHATSAPP_ACCESS_TOKEN = TOKEN;
  r = await send(conv2, pdf(), RID(11));
  check("24-hour window closed -> 409 window_closed, nothing uploaded, sent or stored", r.status === 409 && r.body.error === "window_closed" && fetchCalls.length === 0 && (await outRows(`client_request_id = '${RID(11)}'`)).length === 0);
  await db.exec(`update public.wa_accounts set status = 'disabled' where phone_number_id = '${PH_A}'`);
  r = await send(conv1, pdf(), RID(12));
  check("disabled WhatsApp account -> 409 account_disabled, nothing uploaded or sent", r.status === 409 && r.body.error === "account_disabled" && fetchCalls.length === 0);
  await db.exec(`update public.wa_accounts set status = 'active' where phone_number_id = '${PH_A}'`);

  // ---------- success for every kind
  reset();
  r = await send(conv1, { file: file(FX.pdf, "invoice.pdf", "application/pdf"), caption: "  Your invoice  " }, RID(20));
  check("document: 200 state sent; the response carries only ok/state/message_id (no Meta media id, no URL, no recipient)", r.status === 200 && r.body.ok === true && r.body.state === "sent" && Object.keys(r.body).sort().join() === "message_id,ok,state" && !/META_MEDIA|wamid|graph|http|237600000001/.test(JSON.stringify(r.body)), JSON.stringify(r));
  check("exactly ONE upload and ONE send to Meta, in that order, to the owner's own business number", countFetch("upload") === 1 && countFetch("send") === 1 && fetchCalls[0].isUpload && !fetchCalls[1].isUpload && fetchCalls.every((c) => c.url.includes(`/${PH_A}/`)) && fetchCalls.every((c) => c.init.headers.Authorization === `Bearer ${TOKEN}`));
  const sentPayload = JSON.parse(fetchCalls[1].init.body);
  check("the send references the uploaded media id (never a Ringo URL), goes to the CONVERSATION's contact, and carries caption + filename", sentPayload.type === "document" && sentPayload.document.id === "META_MEDIA_1" && sentPayload.to === "237600000001" && sentPayload.document.caption === "Your invoice" && sentPayload.document.filename === "invoice.pdf" && !/link|http/.test(fetchCalls[1].init.body));
  const upForm = fetchCalls[0].init.body;
  check("the upload form carries the verified bytes, name and type (the browser's other fields never go to Meta)", upForm.get("file").size === FX.pdf.length && upForm.get("file").name === "invoice.pdf" && upForm.get("type") === "application/pdf" && [...upForm.keys()].sort().join() === "file,messaging_product,type");
  const row = (await outRows(`client_request_id = '${RID(20)}'`))[0];
  check("persisted: ONE outbound row, type document, caption in body, wamid, status 'sent', sender, owner profile", row && row.type === "document" && row.body === "Your invoice" && row.status === "sent" && /^wamid\.SENTMEDIA/.test(row.provider_message_id) && row.sent_by_user_id === alice.user && row.profile_id === alice.profile && row.direction === "outbound");
  const media = (await q1(`select * from public.inbox_message_media where message_id = '${row.id}'`))[0];
  check("persisted: ONE metadata row (kind, Meta media id, mime, filename, sha256, caption), storage_status not_downloaded, no stored copy", media && media.kind === "document" && media.media_id === "META_MEDIA_1" && media.mime_type === "application/pdf" && media.filename === "invoice.pdf" && media.sha256 === crypto.createHash("sha256").update(FX.pdf).digest("hex") && media.caption === "Your invoice" && media.storage_status === "not_downloaded" && media.storage_ref === null);
  check("conversation: last_outbound_at / last_message_at updated, still open, unread untouched", await (async () => { const c = (await q1(`select * from public.inbox_conversations where id = '${conv1}'`))[0]; return c.last_outbound_at !== null && c.status === "open" && c.unread_count === 1; })());
  for (const [i, [kind, type, name, bytes, caption]] of [["image", "image/jpeg", "p.jpg", FX.jpeg, "A photo"], ["video", "video/mp4", "c.mp4", FX.mp4, "A clip"], ["audio", "audio/ogg", "v.ogg", FX.oggOpus, undefined], ["image", "image/png", "s.png", FX.png, undefined]].entries()) {
    reset();
    r = await send(conv1, { file: file(bytes, name, type), ...(caption ? { caption } : {}) }, RID(30 + i));
    const rw = (await outRows(`client_request_id = '${RID(30 + i)}'`))[0];
    check(`${kind} (${type}): sent, persisted with its metadata row, one upload + one send`, r.status === 200 && r.body.state === "sent" && rw.type === kind && rw.status === "sent" && (await q1(`select kind, mime_type, filename from public.inbox_message_media where message_id = '${rw.id}'`))[0].kind === kind && countFetch("upload") === 1 && countFetch("send") === 1);
  }
  reset();
  r = await send(conv1, { file: file(FX.oggOpus, "v.ogg", "audio/ogg") }, RID(40));
  check("an audio message is sent with no caption and its media row has none", Object.keys(JSON.parse(fetchCalls[1].init.body).audio).join() === "id" && (await q1(`select caption from public.inbox_message_media where message_id = '${r.body.message_id}'`))[0].caption === null);

  // ---------- recipient / sender / profile can never come from the browser
  reset();
  r = await send(conv1, { ...pdf(), to: "237699999999", recipient: "237699999999", phone_number_id: "5550000", waba_id: "5550001", profile_id: bob.profile, actor_user_id: bob.user, kind: "image", type: "image/jpeg", media_id: "FORGED", link: "https://evil.example/x.pdf", account_id: "x" }, RID(50));
  const fp = JSON.parse(fetchCalls[1].init.body);
  check("forged recipient / phone_number_id / WABA / profile / kind / media id / link fields are IGNORED: the conversation decides everything", r.status === 200 && fp.to === "237600000001" && fetchCalls.every((c) => c.url.includes(`/${PH_A}/`)) && fp.type === "document" && fp.document.id !== "FORGED" && !JSON.stringify(fp).includes("evil.example") && (await outRows(`client_request_id = '${RID(50)}'`))[0].profile_id === alice.profile);
  check("the prepare RPC carried only the session user, the conversation, the request id, the VERIFIED kind and the caption", (() => { const a = rpcCalls.find((c) => c.fn === "inbox_prepare_outbound_media").args; return Object.keys(a).sort().join() === "p_actor_user_id,p_caption,p_client_request_id,p_conversation_id,p_kind" && a.p_actor_user_id === alice.user && a.p_kind === "document"; })());
  reset();
  r = await send(convB, { file: file(FX.png, "b.png", "image/png") }, RID(51), { user: bob.user });
  check("bob sends media in his own conversation using HIS business number and HIS contact", r.status === 200 && fetchCalls.every((c) => c.url.includes(`/${PH_B}/`)) && JSON.parse(fetchCalls[1].init.body).to === "237611111111");

  // ---------- idempotency: one user action, one media message
  reset();
  const a1 = await send(conv1, pdf(), RID(60));
  const a2 = await send(conv1, pdf(), RID(60));
  check("the same request twice (double click / browser retry): ONE upload, ONE send, ONE row, ONE metadata row, same message id", a1.status === 200 && a2.status === 200 && a2.body.state === "sent" && a1.body.message_id === a2.body.message_id && countFetch("upload") === 1 && countFetch("send") === 1 && (await outRows(`client_request_id = '${RID(60)}'`)).length === 1 && (await count("inbox_message_media", `message_id = '${a1.body.message_id}'`)) === 1);
  reset();
  const burst = await Promise.all(Array.from({ length: 10 }, () => send(conv1, pdf(), RID(61))));
  check("10 simultaneous identical requests: exactly ONE upload and ONE send, one row, one metadata row", countFetch("upload") === 1 && countFetch("send") === 1 && (await outRows(`client_request_id = '${RID(61)}'`)).length === 1 && burst.every((x) => x.body.ok === true) && (await count("inbox_message_media", `message_id = '${(await outRows(`client_request_id = '${RID(61)}'`))[0].id}'`)) === 1, JSON.stringify(burst.map((x) => x.status + x.body.state)));
  check("the losing duplicates reported 'pending' (or the finished result), never a second send", burst.every((x) => (x.status === 202 && x.body.state === "pending") || (x.status === 200 && x.body.state === "sent")));
  reset();
  r = await send(conv1, { ...pdf(), caption: "Different caption" }, RID(60));
  check("the same request id with another caption is a conflict (409), nothing uploaded or sent", r.status === 409 && r.body.error === "conflict" && fetchCalls.length === 0);
  r = await send(conv1, { file: file(FX.png, "x.png", "image/png") }, RID(60));
  check("the same request id with another KIND is a conflict (409)", r.status === 409 && r.body.error === "conflict" && fetchCalls.length === 0);

  // ---------- upload failures: nothing was sent, so the row is FAILED (never left 'sent' or 'queued'), no metadata row
  for (const [mode, label] of [["reject", "Meta rejects the upload"], ["server", "Meta answers 500 to the upload"], ["timeout", "the upload times out"], ["network", "a network error during the upload"], ["noid", "Meta answers the upload without a media id"]]) {
    reset(); uploadMode = mode;
    const id = RID(100 + results.length);
    r = await send(conv1, pdf(), id);
    const rw = (await outRows(`client_request_id = '${id}'`))[0];
    check(`${label}: 422 upload_failed, state failed; the row is 'failed' with no wamid and NO metadata row; the message was never sent`, r.status === 422 && r.body.error === "upload_failed" && r.body.state === "failed" && rw.status === "failed" && rw.provider_message_id === null && (await count("inbox_message_media", `message_id = '${rw.id}'`)) === 0 && countFetch("send") === 0, JSON.stringify(r));
    if (mode === "reject") check("upload rejected: Meta's numeric code is kept, its text is not", JSON.stringify(rw.error_codes) === "[131053]");
    uploadMode = "ok"; fetchCalls = [];
    const again = await send(conv1, pdf(), id);
    check(`${label}: replaying the failed request returns the failure WITHOUT uploading again`, again.status === 422 && again.body.state === "failed" && fetchCalls.length === 0);
    const retry = await send(conv1, pdf(), RID(200 + results.length));
    check(`${label}: a deliberate retry (new request id) succeeds and leaves the failed row as history`, retry.status === 200 && retry.body.state === "sent" && (await outRows(`client_request_id = '${id}' and status = 'failed'`)).length === 1);
  }

  // ---------- send failures
  reset(); sendMode = "window";
  r = await send(conv1, pdf(), RID(300));
  let rw = (await outRows(`client_request_id = '${RID(300)}'`))[0];
  check("Meta rejects the send (131047): 422 window_closed, state failed; row failed with the code; NO metadata row (the upload is simply unused)", r.status === 422 && r.body.error === "window_closed" && r.body.state === "failed" && rw.status === "failed" && JSON.stringify(rw.error_codes) === "[131047]" && (await count("inbox_message_media", `message_id = '${rw.id}'`)) === 0 && countFetch("upload") === 1);
  reset(); sendMode = "reject";
  r = await send(conv1, pdf(), RID(301));
  check("Meta rejects the send (code 100): generic send_failed, row failed", r.status === 422 && r.body.error === "send_failed" && r.body.state === "failed" && (await outRows(`client_request_id = '${RID(301)}'`))[0].status === "failed");
  reset(); sendMode = "rate";
  r = await send(conv1, pdf(), RID(302));
  check("Meta rate limit (429): 422 rate_limited, row failed", r.status === 422 && r.body.error === "rate_limited" && (await outRows(`client_request_id = '${RID(302)}'`))[0].status === "failed");
  for (const mode of ["server", "timeout", "noid"]) {
    reset(); sendMode = mode;
    const id = RID(310 + results.length);
    r = await send(conv1, pdf(), id);
    rw = (await outRows(`client_request_id = '${id}'`))[0];
    check(`send outcome UNKNOWN (${mode}): 202 'unconfirmed' (never a false 'sent'); the row stays 'queued' with no wamid and no metadata row`, r.status === 202 && r.body.state === "unconfirmed" && rw.status === "queued" && rw.provider_message_id === null && (await count("inbox_message_media", `message_id = '${rw.id}'`)) === 0, JSON.stringify(r));
    sendMode = "accept"; fetchCalls = [];
    const again = await send(conv1, pdf(), id);
    check(`send outcome UNKNOWN (${mode}): replaying the same request does NOT upload or send again (no automatic resend, no duplicate)`, again.status === 202 && again.body.state === "pending" && fetchCalls.length === 0 && (await outRows(`client_request_id = '${id}'`)).length === 1);
  }
  reset(); rpcMode = "complete_error";
  r = await send(conv1, pdf(), RID(330));
  check("Meta ACCEPTED but the database could not record it: 202 'unconfirmed' (not a false 'sent'); the accepted wamid is logged for reconciliation", r.status === 202 && r.body.state === "unconfirmed" && (await outRows(`client_request_id = '${RID(330)}'`))[0].status === "queued" && logs.some((l) => l.includes("complete_failed") && l.includes("wamid.SENTMEDIA")));
  reset(); rpcMode = "prepare_error";
  r = await send(conv1, pdf(), RID(331));
  check("database failure before anything is sent -> 500 server_error, Meta never contacted", r.status === 500 && r.body.error === "server_error" && fetchCalls.length === 0);
  reset(); rpcMode = "no_client";
  r = await send(conv1, pdf(), RID(332));
  check("service client unavailable -> 503, Meta never contacted", r.status === 503 && fetchCalls.length === 0);
  reset();

  // ---------- statuses after a media send: the Phase 4 ranking, unchanged
  r = await send(conv1, { file: file(FX.jpeg, "s.jpg", "image/jpeg") }, RID(340));
  const stRow = (await outRows(`client_request_id = '${RID(340)}'`))[0];
  const stat = (st, codes) => asService(`select public.inbox_ingest_whatsapp_status('${PH_A}', null, '${stRow.provider_message_id}', '${st}', now(), ${codes ? `'{${codes.join(",")}}'::integer[]` : "null"}) as r`).then((x) => x.rows[0].r);
  const cur = async () => (await outRows(`id = '${stRow.id}'`))[0].status;
  check("media message: sent -> delivered -> read advance the current status", (await cur()) === "sent" && (await stat("delivered")) === "created" && (await cur()) === "delivered" && (await stat("read")) === "created" && (await cur()) === "read");
  check("a late 'sent' and a late 'failed' never downgrade 'read' (history keeps them); a duplicate changes nothing", (await stat("sent")) === "created" && (await stat("failed", [131026])) === "created" && (await cur()) === "read" && (await stat("read")) === "duplicate" && (await count("inbox_status_events", `provider_message_id = '${stRow.provider_message_id}'`)) === 4);
  const failedMedia = (await outRows(`client_request_id = '${RID(300)}'`))[0];
  check("a failed media message is never overwritten to 'sent' by a late 'sent' event (it has no wamid)", failedMedia.status === "failed" && failedMedia.provider_message_id === null);
} finally { console.info = origInfo; console.error = origErr; console.warn = origWarn; globalThis.fetch = realFetch; }

// ============================================================ logs and secrets
const all = logs.join("\n");
check("logs: never the token, an Authorization header, a file name, a caption, the recipient number, a business number id, Meta's error text or database error text", !/test-token-not-real|Bearer|Authorization|invoice\.pdf|Your invoice|237600000001|237611111111|SECRET META TEXT|SECRET CAPTION|row contains/i.test(all), all.slice(0, 400));
check("logs: every line is a structured whatsapp_media entry (ids, categories and numeric codes only)", logs.length > 10 && logs.every((l) => { try { return JSON.parse(l).scope === "whatsapp_media"; } catch { return false; } }), logs.filter((l) => { try { return JSON.parse(l).scope !== "whatsapp_media"; } catch { return true; } }).slice(0, 2).join("|"));

// ============================================================ display: outbound media in the thread (EN / FR)
{
  const own = mkClient("authenticated", () => alice.user);
  const t = await D.loadThread(own, alice.profile, conv1, 100);
  const media = t.thread.messages.filter((m) => m.display.kind === "media" && m.direction === "outbound");
  check("data: outbound media messages come back as media displays (sent with metadata, failed/queued from the message row)", media.length > 5 && media.some((m) => m.display.media === "document" && m.display.filename === "invoice.pdf" && m.display.mimeType === "application/pdf" && m.display.caption === "Your invoice") && media.some((m) => m.status === "failed") && media.some((m) => m.status === "queued"));
  check("data: a failed or queued outbound media message still shows its caption (it lives in the message row until Meta accepts)", media.some((m) => (m.status === "failed" || m.status === "queued") && m.display.caption !== undefined) && F.messageDisplay({ type: "image", body: "A caption" }, null).caption === "A caption" && F.messageDisplay({ type: "image", body: null }, null).caption === null);
  const list = await D.loadConversationList(own, alice.profile, 40, { status: "all" });
  const html = render("en", React.createElement(InboxView, { list, selectedId: conv1, thread: t, filter: { status: "all", q: "" } }));
  check("UI: outbound media renders as a distinct metadata card with kind, filename, mime and caption, and the outbound note (Ringo keeps no copy)", /data-media-kind="document"/.test(html) && /invoice\.pdf/.test(html) && /application\/pdf/i.test(html) && /Your invoice/.test(html) && /Attachment sent\. Ringo does not keep a copy\./.test(html));
  check("UI: a FAILED outbound attachment says it was not sent and asks to attach the file again; it has no Retry button (the bytes are not kept)", /Attachment not sent\. Attach the file again to retry\./.test(html) && !/>Retry<\/button>[^]{0,120}Attachment not sent/.test(html));
  check("UI: status labels on outbound media (Sent / Delivered / Read / Failed) and the unconfirmed label", /· Sent|· Delivered|· Read/.test(html) && /· Failed/.test(html));
  check("UI: no <img>, <video>, <audio>, <iframe>, <source>, download link or remote URL is ever rendered for a message (thread view)", !/<(img|video|audio|iframe|source|embed|object)\b/i.test(html) && !/download=/.test(html) && !/https?:\/\//i.test(html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "")));
  const fr = render("fr", React.createElement(InboxView, { list, selectedId: conv1, thread: t, filter: { status: "all", q: "" } }));
  check("UI (FR): outbound note and failed note", /Pièce jointe envoyée\. Ringo n’en conserve pas de copie\./.test(fr) && /Pièce jointe non envoyée\./.test(fr));
  const xss = F.messageDisplay({ type: "document", body: "<img src=x onerror=alert(1)>" }, { kind: "document", caption: null, filename: "<b>x</b>.pdf", mimeType: "application/pdf" });
  const tx = JSON.parse(JSON.stringify(t)); tx.thread.messages = [{ id: "m1", direction: "outbound", status: "sent", at: new Date().toISOString(), display: xss, unconfirmed: false }];
  const xh = render("en", React.createElement(InboxView, { list, selectedId: conv1, thread: tx, filter: { status: "all", q: "" } }));
  check("UI: a hostile caption or filename is escaped text, never markup", !/<img src=x|<b>x<\/b>/.test(xh) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(xh) && /&lt;b&gt;x&lt;\/b&gt;\.pdf/.test(xh));
}

// ============================================================ composer + client helpers
{
  const comp = render("en", React.createElement(Composer, { conversationId: conv1, open: true, savedReplies: null }));
  check("composer: an attach button (labelled, with the supported-media hint) and a hidden file input restricted to the supported types; nothing attached at rest", /aria-label="Attach a file"/.test(comp) && /title="Images \(JPEG, PNG\), videos \(MP4\), audio, PDF, Office and text files, up to 4 MB\."/.test(comp) && /<input type="file" hidden=""[^>]*accept="[^"]*image\/jpeg[^"]*application\/pdf[^"]*\.docx/.test(comp) && !/data-attachment-kind/.test(comp) && !/<img/.test(comp));
  check("composer: the attach button is enabled at rest; Send is still the text Send", !/<button[^>]*aria-label="Attach a file"[^>]* disabled=""/.test(comp) && />Send<\/button>/.test(comp));
  const frc = render("fr", React.createElement(Composer, { conversationId: conv1, open: true, savedReplies: null }));
  check("composer (FR): attach label and hint", /aria-label="Joindre un fichier"/.test(frc) && /jusqu’à 4 Mo/.test(frc));
  check("composer: when the 24-hour window is closed there is no attach button either", !/Attach a file/.test(render("en", React.createElement(Composer, { conversationId: conv1, open: false, savedReplies: null }))));
  const csrc = read("src/components/inbox/ReplyComposer.tsx");
  check("composer source: one attachment at a time, shows name + kind + size, a Remove button, locked while sending", /setAttachment\(\{ file, kind:/.test(csrc) && /formatBytes\(attachment\.file\.size\)/.test(csrc) && /aria-label=\{u\.attachmentRemove\}/.test(csrc) && /disabled=\{sending\}/.test(csrc) && /if \(!attachment \|\| inFlight\.current\) return;/.test(csrc));
  check("composer source: the image preview is a local blob: URL of the person's own file, revoked on removal and unmount; no remote URL anywhere", /URL\.createObjectURL\(attachment\.file\)/.test(csrc) && /URL\.revokeObjectURL\(url\)/.test(csrc) && !/https?:\/\//.test(csrc.replace(/\/\/.*$/gm, "")) && (csrc.match(/<img /g) || []).length === 1 && /attachment\.kind !== "image"/.test(csrc));
  check("composer source: audio has no caption box; a caption is capped at 1024; the media request id is kept across an unknown outcome and reset when the file or caption changes", /attachment\?\.kind === "audio"/.test(csrc) && /MEDIA_CAPTION_MAX\) return setError\("messageTooLong"\)/.test(csrc) && /key !== mediaRequestKey\.current\) mediaRequestId\.current = null/.test(csrc) && /if \(!effect\.keepRequestId\) mediaRequestId\.current = null/.test(csrc));
  check("composer source: the text path is unchanged (Enter does not send, the same validation and request-id rules)", /e\.key === "Enter" && \(e\.ctrlKey \|\| e\.metaKey\) && !e\.nativeEvent\.isComposing/.test(csrc) && /trimmed === ""\) return setError\("emptyMessage"\)/.test(csrc) && /if \(!requestId\.current\) requestId\.current = newRequestId\(\)/.test(csrc));
  let captured = null;
  const fake = async (url, init) => { captured = { url, init }; return new Response(JSON.stringify({ ok: true, state: "sent" }), { status: 200 }); };
  const pm = await C.postMedia(conv1, new File([FX.pdf], "invoice.pdf", { type: "application/pdf" }), "  cap  ", RID(400), fake);
  check("client: postMedia goes to OUR route with the upload header, same-origin, and ONLY file + client_request_id + caption (no recipient, profile, phone, token)", pm.kind === "response" && captured.url === `/api/inbox/conversations/${conv1}/media` && captured.init.headers["x-ringo-upload"] === "1" && captured.init.credentials === "same-origin" && captured.init.method === "POST" && [...captured.init.body.keys()].sort().join() === "caption,client_request_id,file" && captured.init.body.get("caption") === "cap" && !/graph|Bearer|Authorization/i.test(JSON.stringify(captured.init.headers)));
  await C.postMedia(conv1, new File([FX.pdf], "a.pdf", { type: "application/pdf" }), "   ", RID(401), fake);
  check("client: a blank caption is not sent", ![...captured.init.body.keys()].includes("caption"));
  check("client: a thrown fetch or a non-JSON answer is a 'network' result", (await C.postMedia(conv1, new File([FX.pdf], "a.pdf"), "", RID(402), async () => { throw new Error("offline"); })).kind === "network" && (await C.postMedia(conv1, new File([FX.pdf], "a.pdf"), "", RID(402), async () => new Response("<html>", { status: 502 }))).kind === "network");
  const resp = (status, body) => ({ kind: "response", status, body });
  const e = (x) => C.interpretMedia(x);
  check("interpretMedia: success clears the attachment and refreshes; the request id is dropped", (() => { const x = e(resp(200, { ok: true, state: "sent" })); return x.clearAttachment && !x.keepRequestId && x.error === null && x.refresh; })() && e(resp(202, { ok: true, state: "unconfirmed" })).clearAttachment === true && e(resp(202, { ok: true, state: "pending" })).clearAttachment === true);
  check("interpretMedia: a DEFINITE failure keeps the attachment (press Send again = a new deliberate send), drops the request id, shows the right message, and refreshes to show the failed row", (() => { const x = e(resp(422, { ok: false, error: "upload_failed", state: "failed" })); return !x.clearAttachment && !x.keepRequestId && x.error === "mediaFailed" && x.refresh; })() && e(resp(422, { ok: false, error: "window_closed", state: "failed" })).error === "windowClosed" && e(resp(422, { ok: false, error: "rate_limited", state: "failed" })).error === "rateLimited");
  check("interpretMedia: a network or server error keeps the attachment AND the request id (a retry replays the same request: no duplicate)", (() => { const a = e({ kind: "network" }); const b = e(resp(500, { ok: false, error: "server_error" })); return !a.clearAttachment && a.keepRequestId && a.error === "sendFailedMessage" && !a.refresh && !b.clearAttachment && b.keepRequestId; })());
  check("interpretMedia: validation errors map to their own messages and never refresh or clear", e(resp(413, { ok: false, error: "too_large" })).error === "mediaTooLarge" && e(resp(422, { ok: false, error: "unsupported_type" })).error === "mediaUnsupported" && e(resp(422, { ok: false, error: "type_mismatch" })).error === "mediaMismatch" && e(resp(422, { ok: false, error: "bad_filename" })).error === "mediaMismatch" && e(resp(422, { ok: false, error: "empty_file" })).error === "mediaEmpty" && e(resp(422, { ok: false, error: "caption_not_allowed" })).error === "captionNone" && e(resp(409, { ok: false, error: "conflict" })).error === "sendFailedMessage" && e(resp(503, { ok: false, error: "not_configured" })).error === "notConfigured");
  check("formatBytes", C.formatBytes(512) === "512 B" && C.formatBytes(2048) === "2 KB" && C.formatBytes(1.5 * 1024 * 1024) === "1.5 MB" && C.formatBytes(-1) === "" && C.formatBytes(NaN) === "");
}

// ============================================================ translations
{
  const en = translations.en.inbox, fr = translations.fr.inbox;
  const shape = (o) => Object.keys(o).sort().join() + "|" + Object.values(o).map((x) => (typeof x === "object" ? shape(x) : typeof x)).join();
  check("i18n: EN and FR inbox sections still have identical keys and shapes", shape(en) === shape(fr));
  check("i18n: the media strings exist in both languages and are not empty", ["attach", "attachmentRemove", "captionPlaceholder", "captionNone", "mediaHint", "mediaTooLarge", "mediaUnsupported", "mediaMismatch", "mediaEmpty", "mediaFailed", "mediaOutboundNote", "mediaOutboundFailed"].every((k) => typeof en[k] === "string" && en[k] && typeof fr[k] === "string" && fr[k] && en[k] !== fr[k]));
}

// ============================================================ static security / scope
{
  const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const clientFiles = ["src/components/inbox/ReplyComposer.tsx", "src/components/inbox/InboxView.tsx", "src/lib/inbox/client.ts", "src/lib/whatsapp/mediaRules.ts"];
  const cc = clientFiles.map(code).join("\n");
  check("security: the browser code never mentions Meta, the token, Authorization, or the server-only modules", !/graph\.facebook|WHATSAPP_|ACCESS_TOKEN|Bearer|Authorization|whatsapp\/media"|whatsapp\/outbound|inbox\/sendMedia|supabase\/server/.test(cc));
  check("security: no NEXT_PUBLIC variable and no token reference in any Phase 9 media file", !/NEXT_PUBLIC_/.test(["src/lib/whatsapp/media.ts", "src/lib/whatsapp/mediaRules.ts", "src/lib/inbox/sendMedia.ts", "src/app/api/inbox/conversations/[id]/media/route.ts", ...clientFiles].map(code).join("\n")) && !/process\.env/.test(["src/lib/whatsapp/media.ts", "src/lib/whatsapp/mediaRules.ts", "src/lib/inbox/sendMedia.ts"].map(code).join("\n")));
  const route2 = code("src/app/api/inbox/conversations/[id]/media/route.ts");
  check("security: the media route requires the upload header, multipart, a Content-Length pre-check, the session owner, and reads ONLY file / client_request_id / caption from the form", /x-ringo-upload/.test(route2) && /multipart\/form-data/.test(route2) && /content-length/.test(route2) && /guardConversationAction/.test(route2) && /form\.get\("file"\)/.test(route2) && /form\.get\("client_request_id"\)/.test(route2) && /form\.get\("caption"\)/.test(route2) && (route2.match(/form\.get\(/g) || []).length === 3 && !/export async function (GET|PUT|PATCH|DELETE)/.test(route2));
  check("privacy: Ringo never keeps the file: no fs write, no storage bucket, no signed or public URL, no database column for bytes in the media code", !/writeFile|createWriteStream|appendFile|storage\.from|createSignedUrl|getPublicUrl|\.upload\(/.test(["src/lib/whatsapp/media.ts", "src/lib/inbox/sendMedia.ts", "src/app/api/inbox/conversations/[id]/media/route.ts"].map(code).join("\n")));
  check("privacy: Meta's media URL endpoints are never called (no GET of a media id), and no 'link' payload is ever built", !/\/media\/|method: "GET"|"link"|\blink:/.test(["src/lib/whatsapp/media.ts", "src/lib/inbox/sendMedia.ts"].map(code).join("\n")));
  check("scope: no calling, no templates, no AI, no sticker sending in the media code", !/call|template|openai|anthropic|sticker/i.test(["src/lib/inbox/sendMedia.ts", "src/app/api/inbox/conversations/[id]/media/route.ts"].map(code).join("\n").replace(/callers?|called|recall/gi, "")) && !/"sticker"/.test(code("src/lib/whatsapp/mediaRules.ts")));
  check("the Phase 7 text sender is unchanged apart from exporting its error classifier (one-line diff)", /export function classify\(httpStatus: number, code: number \| null\): SendErrorKind/.test(read("src/lib/whatsapp/outbound.ts")) && !/uploadWhatsAppMedia|FormData/.test(read("src/lib/whatsapp/outbound.ts")));
  check("the webhook route, parser and ingestion code are untouched by Phase 9 (no media-sending import)", !/media|sendMedia/.test(code("src/app/api/integrations/whatsapp/webhook/route.ts").replace(/media: /g, "")) && !/sendMedia|uploadWhatsAppMedia/.test(code("src/lib/whatsapp/parseWebhook.ts") + code("src/lib/whatsapp/ingest.ts")));
}

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
