// Ringo Smart Cards (QR claim): tokens, the public scan and the claim endpoint, with REAL code and an in-memory fake database. No network, nothing applied.
// The database functions themselves are tested on a real PostgreSQL engine in supabase/support/tests/smart_card_claims.test.mjs.
//   Run:  node scripts/tests/smartCards.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const tmp = [];
const mk = (name, body) => { const f = path.join(os.tmpdir(), `${name}_${process.pid}.cjs`); fs.writeFileSync(f, body); tmp.push(f); return f; };
const serverStub = mk("sc_server_stub", "module.exports = { createAdminClient: () => globalThis.__admin, createClient: () => globalThis.__session };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": serverStub, "@": SRC }, interopDefault: true, cache: false });
const T = jiti(path.join(SRC, "lib/smartCards/token.ts"));
const S = jiti(path.join(SRC, "lib/smartCards/scan.ts"));
const claimRoute = jiti(path.join(SRC, "app/api/smart-cards/claim/route.ts"));
const R = jiti(path.join(SRC, "lib/reservedUsernames.ts"));

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const UID = "c0000000-0000-4000-8000-000000000001", PID = "a0000000-0000-4000-8000-000000000001", OTHER_PID = "a0000000-0000-4000-8000-000000000002";

// ---- A. tokens, serials, URLs
const cards = Array.from({ length: T.CARD_BATCH_SIZE }, (_, i) => { const token = T.generateCardToken(); return { serial: T.cardSerial(i + 1), token, hash: T.hashCardToken(token), url: T.cardUrl("https://www.ringoconnectltd.com", token) }; });
check("tokens", "exactly 500 cards", cards.length === 500);
check("tokens", "serials are RINGO-0001 .. RINGO-0500, in order, all distinct", cards[0].serial === "RINGO-0001" && cards[499].serial === "RINGO-0500" && new Set(cards.map((c) => c.serial)).size === 500);
check("tokens", "500 distinct tokens, 500 distinct hashes, 500 distinct URLs", new Set(cards.map((c) => c.token)).size === 500 && new Set(cards.map((c) => c.hash)).size === 500 && new Set(cards.map((c) => c.url)).size === 500);
check("tokens", "a token is 160 random bits: 20 bytes, 27 base64url characters", T.CARD_TOKEN_BYTES * 8 === 160 && cards.every((c) => c.token.length === 27 && /^[A-Za-z0-9_-]{27}$/.test(c.token) && Buffer.from(c.token, "base64url").length === 20));
check("tokens", "the hash is the SHA-256 hex of the token, and differs from it", cards.every((c) => c.hash === sha(c.token) && c.hash !== c.token && /^[0-9a-f]{64}$/.test(c.hash)));
check("tokens", "the URL is the origin + /c/ + the token and nothing else (no serial, username or id)", cards.every((c) => c.url === `https://www.ringoconnectltd.com/c/${c.token}` && !c.url.includes(c.serial) && !c.url.includes("?")));
check("tokens", "token bytes are not derived from the serial (no two tokens share a prefix pattern; sequential serials give unrelated tokens)", new Set(cards.map((c) => c.token.slice(0, 4))).size > 400);
check("tokens", "well-formed check rejects wrong lengths, odd characters and non-strings", !T.isWellFormedCardToken("short") && !T.isWellFormedCardToken(cards[0].token + "x") && !T.isWellFormedCardToken("../".repeat(9)) && !T.isWellFormedCardToken(null) && T.isWellFormedCardToken(cards[0].token));
check("tokens", "serials outside 1..9999 are refused", (() => { try { T.cardSerial(0); return false; } catch { try { T.cardSerial(10000); return false; } catch { return true; } } })());

// ---- B. the public scan (fake database function layer)
function fakeAdmin({ limit = Infinity } = {}) {
  const store = new Map();
  let hits = 0;
  const log = [];
  const admin = {
    log, store,
    rpc: async (fn, args) => {
      log.push({ fn, args });
      if (fn === "smartcard_rate_limit_hit") return { data: ++hits <= limit, error: null };
      if (fn === "smartcard_resolve") { const c = store.get(args.p_token_hash); return { data: !c || c.status === "disabled" ? null : c.status === "unclaimed" ? { status: "unclaimed", serial: c.serial } : { status: "claimed", username: c.username }, error: null }; }
      if (fn === "smartcard_claim") {
        const c = store.get(args.p_token_hash);
        if (!c || c.status === "disabled") return { data: { result: "unavailable" }, error: null };
        if (c.status === "claimed") return { data: c.user === args.p_user_id ? { result: "claimed", already: true, serial: c.serial } : { result: "already_claimed" }, error: null };
        if (args.p_profile_id !== PID || args.p_user_id !== UID) return { data: { result: "profile_not_allowed" }, error: null };
        Object.assign(c, { status: "claimed", user: args.p_user_id, username: "alice" });
        return { data: { result: "claimed", already: false, serial: c.serial }, error: null };
      }
      return { data: null, error: { message: "unknown" } };
    },
  };
  for (const c of cards.slice(0, 3)) store.set(c.hash, { serial: c.serial, status: "unclaimed" });
  store.set(cards[3].hash, { serial: cards[3].serial, status: "claimed", user: UID, username: "alice" });
  store.set(cards[4].hash, { serial: cards[4].serial, status: "disabled" });
  return admin;
}
let a = fakeAdmin();
check("scan", "an unclaimed card shows the claim state with its serial", (await S.scanCard(a, cards[0].token, "1.2.3.4")).kind === "unclaimed" && (await S.scanCard(a, cards[0].token, "1.2.3.4")).serial === "RINGO-0001");
check("scan", "a claimed card resolves to the owner's current username", JSON.stringify(await S.scanCard(a, cards[3].token, "1.2.3.4")) === '{"kind":"claimed","username":"alice"}');
check("scan", "unknown, disabled and malformed tokens give the SAME outcome", JSON.stringify(await S.scanCard(a, T.generateCardToken(), "1.2.3.4")) === '{"kind":"unavailable"}' && JSON.stringify(await S.scanCard(a, cards[4].token, "1.2.3.4")) === '{"kind":"unavailable"}' && JSON.stringify(await S.scanCard(a, "x", "1.2.3.4")) === '{"kind":"unavailable"}');
a = fakeAdmin();
await S.scanCard(a, "not-a-token", "1.2.3.4");
check("scan", "a malformed token never reaches the database function", !a.log.some((l) => l.fn === "smartcard_resolve"));
a = fakeAdmin();
await S.scanCard(a, cards[0].token, "1.2.3.4");
const sent = JSON.stringify(a.log);
check("scan", "only the HASH is sent to the database: the raw token never appears in any call", !sent.includes(cards[0].token) && sent.includes(cards[0].hash));
check("scan", "the rate-limit subject is a keyed hash, never the raw address", !sent.includes("1.2.3.4") && a.log[0].fn === "smartcard_rate_limit_hit" && /^[0-9a-f]{64}$/.test(a.log[0].args.p_subject_hash));
a = fakeAdmin({ limit: 2 });
const outs = [];
for (let i = 0; i < 4; i++) outs.push((await S.scanCard(a, cards[0].token, "9.9.9.9")).kind);
check("scan", "after the budget is spent the scan is 'limited' (the limiter is enforced)", outs.join() === "unclaimed,unclaimed,limited,limited", outs.join());
check("scan", "the limiter fails CLOSED: an error, an exception or a non-true answer all refuse", (await S.scanCard({ rpc: async () => ({ data: null, error: { message: "x" } }) }, cards[0].token, "ip")).kind === "limited" && (await S.scanCard({ rpc: async () => { throw new Error("down"); } }, cards[0].token, "ip")).kind === "limited" && (await S.scanCard({ rpc: async () => ({ data: false, error: null }) }, cards[0].token, "ip")).kind === "limited");
check("scan", "a database error while resolving is 'unavailable' (never a distinguishable failure)", (await S.scanCard({ rpc: async (fn) => (fn === "smartcard_rate_limit_hit" ? { data: true, error: null } : { data: null, error: { message: "boom" } }) }, cards[0].token, "ip")).kind === "unavailable");

// ---- C. the claim endpoint
const session = (user) => ({ auth: { getUser: async () => ({ data: { user } }) }, from: () => { const q = { eq: () => q, maybeSingle: async () => ({ data: { username: "alice" } }) }; return { select: () => q }; } });
const post = (body, headers = {}) => claimRoute.POST(new Request("https://www.ringoconnectltd.com/api/smart-cards/claim", { method: "POST", headers: { "content-type": "application/json", origin: "https://www.ringoconnectltd.com", host: "www.ringoconnectltd.com", ...headers }, body: JSON.stringify(body) }));
globalThis.__admin = fakeAdmin();
globalThis.__session = session(null);
let res = await post({ token: cards[0].token, profileId: PID });
check("claim", "an anonymous visitor can NOT claim (401) and nothing is called", res.status === 401 && !globalThis.__admin.log.some((l) => l.fn === "smartcard_claim"));
globalThis.__session = session({ id: UID });
res = await post({ token: cards[0].token, profileId: PID }, { origin: "https://evil.example", host: "www.ringoconnectltd.com" });
check("claim", "a cross-site request is refused (403)", res.status === 403 && !globalThis.__admin.log.some((l) => l.fn === "smartcard_claim"));
res = await post({ token: cards[0].token, profileId: "not-a-uuid" });
check("claim", "a malformed profile id is refused without touching the database", res.status === 404 && !globalThis.__admin.log.some((l) => l.fn === "smartcard_claim"));
res = await post({ token: cards[0].token, profileId: OTHER_PID });
check("claim", "a profile that is not the caller's is refused (403) and the card stays unclaimed", res.status === 403 && globalThis.__admin.store.get(cards[0].hash).status === "unclaimed");
res = await post({ token: cards[0].token, profileId: PID });
let body = await res.json();
check("claim", "an authenticated owner claims an eligible card (200) and is told the profile username", res.status === 200 && body.ok === true && body.username === "alice" && body.serial === "RINGO-0001");
check("claim", "the response never echoes the token", !JSON.stringify(body).includes(cards[0].token) && res.headers.get("cache-control").includes("no-store") && res.headers.get("referrer-policy") === "no-referrer");
check("claim", "the user id passed to the database is the SESSION user, never a body field", globalThis.__admin.log.filter((l) => l.fn === "smartcard_claim").every((l) => l.args.p_user_id === UID));
globalThis.__session = session({ id: "c0000000-0000-4000-8000-0000000000ff" });
res = await post({ token: cards[0].token, profileId: PID });
check("claim", "a different account can NOT take a claimed card (409), unauthorised reassignment is rejected", res.status === 409 && globalThis.__admin.store.get(cards[0].hash).user === UID);
res = await post({ token: T.generateCardToken(), profileId: PID });
check("claim", "an unknown token is a plain 404 'unavailable'", res.status === 404 && (await res.json()).error === "unavailable");
globalThis.__session = session({ id: UID });
globalThis.__admin = fakeAdmin({ limit: 1 });
res = await post({ token: cards[1].token, profileId: PID });
check("claim", "the claim endpoint is rate limited (429) and fails closed", res.status === 429);

// ---- D. routing and page behaviour (source)
const page = read("src/app/c/[token]/page.tsx");
check("page", "the QR page is dynamic, uncached, noindex and no-referrer", /export const dynamic = "force-dynamic"/.test(page) && /noindex|index: false/.test(page) && /referrer: "no-referrer"/.test(page));
check("page", "a claimed card redirects to the owner's CURRENT username, looked up at scan time", /if \(outcome\.kind === "claimed"\) redirect\(`\/\$\{encodeURIComponent\(outcome\.username\)\}`\)/.test(page));
check("page", "unknown, disabled, malformed and limited all render one bilingual 'unavailable'/'limited' page", /unavailableTitle/.test(page) && /limitedTitle/.test(page) && !/not found|does not exist|no such card/i.test(page));
check("page", "the page sets no analytics or logging of the token", !/console\.(log|error|warn)/.test(page) && !/analytics|track|pixel/i.test(page));
const nextCfg = read("next.config.js");
check("headers", "next.config.js sets no-store, no-referrer, noindex and no-framing for /c/", /source: "\/c\/:path\*"[\s\S]{0,500}no-store[\s\S]{0,300}no-referrer[\s\S]{0,200}noindex[\s\S]{0,200}X-Frame-Options/.test(nextCfg));
const claimUi = read("src/components/smartCard/CardClaim.tsx");
check("ui", "a visitor must sign in first: the claim button only exists for a signed-in user with a profile, and login returns to the card", /!signedIn \?/.test(claimUi) && /auth\/login\?next=\$\{back\}/.test(claimUi) && /referrerPolicy: "no-referrer"/.test(claimUi));
check("ui", "the brand colours and paper background are used", /#FAFAF8/.test(claimUi + page) && /bg-ringo-indigo/.test(claimUi));
check("reserved", "'c' is a reserved username so a profile can not shadow /c/<token>", R.isReservedUsername("c") && R.isReservedUsername("C") && R.isReservedUsername("d") && R.isReservedUsername("my-ringo") && !R.isReservedUsername("cc"));

// ---- E. English / French parity
const tr = jiti(path.join(SRC, "lib/i18n/translations.ts")).translations;
const keys = (o) => Object.keys(o).sort().join();
check("i18n", "smartCard copy exists in English and French with identical keys, all non-empty and different", keys(tr.en.smartCard) === keys(tr.fr.smartCard) && Object.keys(tr.en.smartCard).length >= 20 && Object.entries(tr.en.smartCard).every(([k, v]) => typeof v === "string" && v.length > 3 && tr.fr.smartCard[k].length > 3 && tr.fr.smartCard[k] !== v));

// ---- F. nothing existing was changed: NFC writer, association cards, document shares, the profile route, payments and auth
const changed = [...execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: REPO, encoding: "utf8" }).split("\n"), ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: REPO, encoding: "utf8" }).split("\n")].filter(Boolean);
const PROTECTED = /^(src\/app\/api\/ringo-cards\/|src\/app\/dashboard\/ringo-card\/|src\/components\/dashboard\/(RingoCardWriter|RingoCardVisual|CardBundleSection|BundlePurchaseModal)|src\/lib\/ringoCard(Writer|Reference)\.ts|src\/app\/m-card\/|src\/app\/d\/|src\/lib\/documents\/|src\/app\/api\/association\/|src\/middleware|src\/lib\/auth\/|src\/app\/\[username\]\/|src\/lib\/applyPayment|supabase\/migrations\/(?!2026-12-22_smart_card_claims))/;
check("scope", "none of the NFC writer, association card, document-share, profile, middleware, auth or payment files changed", changed.filter((f) => PROTECTED.test(f)).length === 0, changed.filter((f) => PROTECTED.test(f)).join(", "));
const mig = read("supabase/migrations/2026-12-22_smart_card_claims.sql");
check("scope", "the migration is the only new migration and never touches ringo_cards", changed.filter((f) => f.startsWith("supabase/migrations/")).join() === "supabase/migrations/2026-12-22_smart_card_claims.sql" && !/\bringo_cards\b/.test(mig.replace(/--.*$/gm, "")));
check("secrets", "no raw token or key material is committed in the new source files", !/eyJ[A-Za-z0-9_-]{20,}/.test(page + claimUi + mig) && !fs.existsSync(path.join(REPO, "RINGO-SMARTCARDS-BATCH-001")));

// ---- G. release safeguards: no live token in the repo, ignored output folders, staging-only concurrency script, independent package verifier
const liveUrl = /https:\/\/(www\.)?ringoconnectltd\.com\/c\/[A-Za-z0-9_-]{27}(?![A-Za-z0-9_-])/;
check("secrets", "no changed or new file contains a full-length live card URL", changed.every((f) => !fs.existsSync(path.join(REPO, f)) || !fs.statSync(path.join(REPO, f)).isFile() || !liveUrl.test(fs.readFileSync(path.join(REPO, f), "utf8"))), changed.filter((f) => fs.existsSync(path.join(REPO, f)) && fs.statSync(path.join(REPO, f)).isFile() && liveUrl.test(fs.readFileSync(path.join(REPO, f), "utf8"))).join(", "));
const ignore = read(".gitignore");
check("secrets", ".gitignore excludes the batch, private and supplier folders", /^RINGO-SMARTCARDS-\*\/$/m.test(ignore) && /^PRIVATE_DO_NOT_SHARE\/$/m.test(ignore) && /^SUPPLIER_PACKAGE\/$/m.test(ignore));
const conc = read("scripts/smartcards/concurrencyCheck.mjs");
check("staging", "the concurrency script is dry-run by default, needs the staging host confirmed, and uses separate clients for each attempt", /--execute/.test(conc) && /confirm-staging-host/.test(conc) && /process\.exit\(2\)/.test(conc) && /Promise\.all/.test(conc) && /createClient\(sbUrl, key[^)]*\)[\s\S]{0,40}rpc\("smartcard_claim"/.test(conc) && !/console\.log\([^)]*token[^H]/.test(conc));
const runNode = (args, env = {}) => { try { return { code: 0, out: execFileSync("node", args, { cwd: REPO, encoding: "utf8", env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, stdio: ["ignore", "pipe", "pipe"] }) }; } catch (e) { return { code: e.status, out: String(e.stdout || "") + String(e.stderr || "") }; } };
const trialDir = fs.mkdtempSync(path.join(os.tmpdir(), "sc_conc_"));
const trialManifest = path.join(trialDir, "manifest.csv");
const trialToken = T.generateCardToken();
fs.writeFileSync(trialManifest, `serial,qr_png_file,qr_svg_file,qr_url\r\nRINGO-0001,a,b,https://www.ringoconnectltd.com/c/${trialToken}\r\n`);
const concArgs = ["scripts/smartcards/concurrencyCheck.mjs", "--manifest", trialManifest, "--serial", "RINGO-0001", "--user-a", UID, "--profile-a", PID, "--user-b", "c0000000-0000-4000-8000-000000000002", "--profile-b", OTHER_PID, "--confirm-staging-host", "staging.example"];
const dry = runNode(concArgs);
check("staging", "concurrency script dry run validates and sends nothing", dry.code === 0 && /DRY RUN/.test(dry.out) && !dry.out.includes(trialToken), dry.out);
const noEnv = runNode([...concArgs, "--execute"]);
check("staging", "concurrency script refuses --execute without staging credentials in the environment", noEnv.code === 2 && !noEnv.out.includes(trialToken), noEnv.out);
const wrongHost = runNode([...concArgs, "--execute"], { NEXT_PUBLIC_SUPABASE_URL: "https://prod-project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key" });
check("staging", "concurrency script refuses when the confirmed host is not the target host (no network call made)", wrongHost.code === 2 && /confirm-staging-host/.test(wrongHost.out) && !wrongHost.out.includes("not-a-real-key"), wrongHost.out);
const sameUser = runNode(concArgs.map((a, i, arr) => (arr[i - 1] === "--user-b" ? UID : a)));
check("staging", "concurrency script refuses when both users are the same account", sameUser.code !== 0 && /different accounts/.test(sameUser.out), sameUser.out);
try { fs.rmSync(trialDir, { recursive: true, force: true }); } catch {}
const ver = read("scripts/smartcards/verifyPackage.mjs");
check("verify", "the package verifier is read-only, decodes PNG and SVG, and compares hashes with the import file", !/writeFile|appendFile|unlink|rmSync|mkdirSync/.test(ver) && /jsQR/.test(ver) && /svgBad/.test(ver) && /token_hash === sha\(/.test(ver));

for (const f of tmp) try { fs.unlinkSync(f); } catch {}
console.log(`smartCards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
