// Fapshi configuration safety guard (src/lib/fapshiSafety.ts) and its wiring into src/lib/fapshi.ts.
// No database, no network: getPlatformSettings is replaced by a stub and global fetch by a recorder,
// so the tests can also prove that a refused configuration sends NO request at all.
//   Run:  node scripts/tests/fapshiSafety.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

// ---- pure guard
const jitiPlain = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const S = jitiPlain(path.join(REPO, "src/lib/fapshiSafety.ts"));
const SANDBOX = S.SANDBOX_BASE_URL, LIVE = S.LIVE_BASE_URL;
const code = (o) => S.checkFapshiConfigSafety({ credentialSource: "database", env: {}, ...o });
const PROD = { NODE_ENV: "production" };
const VPROD = { VERCEL_ENV: "production", NODE_ENV: "production" };

check("URLs are the documented sandbox and live hosts", SANDBOX === "https://sandbox.fapshi.com" && LIVE === "https://live.fapshi.com");

// valid configurations keep working
check("valid: production + live mode + live host + database credentials", code({ testMode: false, baseUrl: LIVE, env: VPROD }) === null);
check("valid: self-hosted production (NODE_ENV only) + live mode", code({ testMode: false, baseUrl: LIVE, env: PROD }) === null);
check("valid: production + live mode + undeclared env credentials (the pre-guard behaviour)", code({ testMode: false, baseUrl: LIVE, credentialSource: "environment", env: VPROD }) === null);
check("valid: production + live mode + env credentials declared live", code({ testMode: false, baseUrl: LIVE, credentialSource: "environment", env: { ...VPROD, FAPSHI_ENV_CREDENTIALS_MODE: "live" } }) === null);
check("valid: sandbox mode in local dev with database credentials", code({ testMode: true, baseUrl: SANDBOX, env: { NODE_ENV: "development" } }) === null);
check("valid: sandbox mode in a Vercel preview / staging", code({ testMode: true, baseUrl: SANDBOX, env: { VERCEL_ENV: "preview", NODE_ENV: "production" } }) === null);
check("valid: sandbox mode inside production (an admin testing)", code({ testMode: true, baseUrl: SANDBOX, env: VPROD }) === null);
check("valid: sandbox mode + env credentials declared sandbox", code({ testMode: true, baseUrl: SANDBOX, credentialSource: "environment", env: { NODE_ENV: "development", FAPSHI_ENV_CREDENTIALS_MODE: " Sandbox " } }) === null);

// invalid combinations are refused
check("refused: live mode in local development", code({ testMode: false, baseUrl: LIVE, env: { NODE_ENV: "development" } }) === "fapshi_live_outside_production");
check("refused: live mode with no environment set at all", code({ testMode: false, baseUrl: LIVE, env: {} }) === "fapshi_live_outside_production");
check("refused: live mode in a Vercel preview even though NODE_ENV is production", code({ testMode: false, baseUrl: LIVE, env: { VERCEL_ENV: "preview", NODE_ENV: "production" } }) === "fapshi_live_outside_production");
check("refused: live mode in a Vercel development deployment", code({ testMode: false, baseUrl: LIVE, env: { VERCEL_ENV: "development" } }) === "fapshi_live_outside_production");
check("refused: sandbox host while in live mode", code({ testMode: false, baseUrl: SANDBOX, env: VPROD }) === "fapshi_mode_url_mismatch");
check("refused: live host while in test mode", code({ testMode: true, baseUrl: LIVE, env: VPROD }) === "fapshi_mode_url_mismatch");
check("refused: an unknown host", code({ testMode: true, baseUrl: "https://example.com", env: {} }) === "fapshi_mode_url_mismatch");
check("refused: sandbox mode with env credentials declared live (live credentials against sandbox)", code({ testMode: true, baseUrl: SANDBOX, credentialSource: "environment", env: { FAPSHI_ENV_CREDENTIALS_MODE: "live" } }) === "fapshi_env_credentials_mode_mismatch");
check("refused: live mode with env credentials declared sandbox (sandbox credentials against live)", code({ testMode: false, baseUrl: LIVE, credentialSource: "environment", env: { ...VPROD, FAPSHI_ENV_CREDENTIALS_MODE: "sandbox" } }) === "fapshi_env_credentials_mode_mismatch");
check("refused: sandbox mode with undeclared env credentials (cannot be proven sandbox)", code({ testMode: true, baseUrl: SANDBOX, credentialSource: "environment", env: { NODE_ENV: "development" } }) === "fapshi_env_credentials_mode_undeclared");
check("refused: an unrecognised declaration is a mismatch, not a pass", code({ testMode: true, baseUrl: SANDBOX, credentialSource: "environment", env: { FAPSHI_ENV_CREDENTIALS_MODE: "test" } }) === "fapshi_env_credentials_mode_mismatch");
check("the env declaration is ignored when credentials come from the database", code({ testMode: true, baseUrl: SANDBOX, credentialSource: "database", env: { FAPSHI_ENV_CREDENTIALS_MODE: "live" } }) === null);

// the error carries a fixed message and code — never a credential
{
  let err; try { S.assertFapshiConfigSafe({ testMode: false, baseUrl: LIVE, credentialSource: "environment", env: { NODE_ENV: "development", FAPSHI_API_KEY: "SECRET-KEY-VALUE", FAPSHI_API_USER: "SECRET-USER-VALUE" } }); } catch (e) { err = e; }
  check("assert throws FapshiConfigSafetyError with a code", err instanceof S.FapshiConfigSafetyError && err.code === "fapshi_live_outside_production");
  check("the error never contains a credential or the env values", !/SECRET/.test(err.message + JSON.stringify(err)));
  let none = true; try { S.assertFapshiConfigSafe({ testMode: true, baseUrl: SANDBOX, credentialSource: "database", env: {} }); } catch { none = false; }
  check("assert returns quietly for a safe configuration", none);
}

// ---- wiring: the real fapshi.ts with a stubbed platformSettings and a recording fetch
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fapshi-safety-"));
const stubPath = path.join(tmp, "platformSettings.stub.cjs");
fs.writeFileSync(stubPath, "module.exports = { getPlatformSettings: async () => globalThis.__settings };");
const jitiWired = require("jiti")(import.meta.url, { alias: { "@/lib/platformSettings": stubPath, "@": path.join(REPO, "src") }, interopDefault: true, cache: false, requireCache: false });
const F = jitiWired(path.join(REPO, "src/lib/fapshi.ts"));

const realFetch = globalThis.fetch;
let requests = [];
globalThis.fetch = async (url, init) => { requests.push({ url: String(url), init }); return { ok: true, status: 200, json: async () => ({ transId: "T1", status: "CREATED", amount: 500, message: "ok" }) }; };
const baseEnv = { NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV, FAPSHI_ENV_CREDENTIALS_MODE: process.env.FAPSHI_ENV_CREDENTIALS_MODE };
const setEnv = (e) => { for (const k of Object.keys(baseEnv)) delete process.env[k]; Object.assign(process.env, e); };
const settings = (o = {}) => ({
  fapshiEnabled: true, fapshiTestMode: false, fapshiApiUser: "user-x", fapshiApiKey: "key-x", fapshiPayoutApiUser: null, fapshiPayoutApiKey: null,
  fapshiBaseUrl: LIVE, fapshiCredentialSource: { collection: "database", payout: "none" }, ...o,
});
const pay = () => F.fapshiDirectPay({ amount: 500, phone: "677123456", medium: "mobile money", userId: "u-1", externalId: "e-1" });
const rejects = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

try {
  // valid production live configuration still works, and hits the live host
  setEnv({ VERCEL_ENV: "production", NODE_ENV: "production" }); globalThis.__settings = settings(); requests = [];
  let r = await pay();
  check("wiring: production + live still works, request goes to the live host", r.transId === "T1" && requests.length === 1 && requests[0].url === `${LIVE}/direct-pay`);
  requests = []; const st = await F.fapshiGetStatus("T1");
  check("wiring: production status check still works", st.status === "CREATED" && requests[0].url === `${LIVE}/payment-status/T1`);

  // valid sandbox configuration works outside production
  setEnv({ NODE_ENV: "development" }); globalThis.__settings = settings({ fapshiTestMode: true, fapshiBaseUrl: SANDBOX }); requests = [];
  r = await pay();
  check("wiring: development + sandbox works, request goes to the sandbox host", r.transId === "T1" && requests[0].url === `${SANDBOX}/direct-pay`);

  // live outside production: refused BEFORE any request
  setEnv({ NODE_ENV: "development" }); globalThis.__settings = settings(); requests = [];
  let e = await rejects(pay);
  check("wiring: live mode in development is refused and NO request is sent", e?.code === "fapshi_live_outside_production" && requests.length === 0);
  requests = []; e = await rejects(() => F.fapshiGetStatus("T1"));
  check("wiring: the status check is guarded too (no request)", e?.code === "fapshi_live_outside_production" && requests.length === 0);
  setEnv({ VERCEL_ENV: "preview", NODE_ENV: "production" }); requests = []; e = await rejects(pay);
  check("wiring: live mode in a preview deployment is refused (no request)", e?.code === "fapshi_live_outside_production" && requests.length === 0);

  // mode / host mismatch and env-credential mismatch: refused before any request
  setEnv(VPROD); globalThis.__settings = settings({ fapshiBaseUrl: SANDBOX }); requests = []; e = await rejects(pay);
  check("wiring: live mode pointed at the sandbox host is refused (no request)", e?.code === "fapshi_mode_url_mismatch" && requests.length === 0);
  setEnv({ NODE_ENV: "development", FAPSHI_ENV_CREDENTIALS_MODE: "live" }); globalThis.__settings = settings({ fapshiTestMode: true, fapshiBaseUrl: SANDBOX, fapshiCredentialSource: { collection: "environment", payout: "none" } }); requests = []; e = await rejects(pay);
  check("wiring: live env credentials with sandbox mode are refused (no request)", e?.code === "fapshi_env_credentials_mode_mismatch" && requests.length === 0);
  setEnv({ NODE_ENV: "development" }); requests = []; e = await rejects(pay);
  check("wiring: undeclared env credentials with sandbox mode are refused (no request)", e?.code === "fapshi_env_credentials_mode_undeclared" && requests.length === 0);
  setEnv({ NODE_ENV: "development", FAPSHI_ENV_CREDENTIALS_MODE: "sandbox" }); requests = []; r = await pay();
  check("wiring: env credentials declared sandbox work in sandbox mode", r.transId === "T1" && requests[0].url === `${SANDBOX}/direct-pay`);

  // payout path is guarded and uses the payout pair's source
  setEnv({ NODE_ENV: "development" }); globalThis.__settings = settings({ fapshiPayoutApiUser: "pu", fapshiPayoutApiKey: "pk", fapshiCredentialSource: { collection: "database", payout: "database" } }); requests = [];
  e = await rejects(() => F.fapshiGetStatus("T1", { disbursement: true }));
  check("wiring: payout lookups are guarded (live mode in development refused, no request)", e?.code === "fapshi_live_outside_production" && requests.length === 0);
  setEnv(VPROD); requests = []; await F.fapshiGetStatus("T1", { disbursement: true });
  check("wiring: payout lookups still work in production", requests.length === 1 && requests[0].url === `${LIVE}/payment-status/T1`);
  setEnv({ NODE_ENV: "development" }); globalThis.__settings = settings({ fapshiTestMode: true, fapshiBaseUrl: SANDBOX, fapshiPayoutApiUser: "pu", fapshiPayoutApiKey: "pk", fapshiCredentialSource: { collection: "database", payout: "environment" } }); requests = [];
  e = await rejects(() => F.fapshiGetStatus("T1", { disbursement: true }));
  check("wiring: payout env credentials in sandbox mode must be declared", e?.code === "fapshi_env_credentials_mode_undeclared" && requests.length === 0);
  globalThis.__settings = settings({ fapshiTestMode: true, fapshiBaseUrl: SANDBOX, fapshiCredentialSource: { collection: "database", payout: "environment" } }); requests = [];
  r = await F.fapshiGetStatus("T1", { disbursement: true });
  check("wiring: payout falling back to the (database) collection pair uses the collection source", r.status === "CREATED" && requests.length === 1);

  // existing gates are unchanged and still come first
  setEnv(VPROD); globalThis.__settings = settings({ fapshiEnabled: false }); e = await rejects(pay);
  check("existing behaviour: the admin kill switch still refuses with its own message", /disabled by the platform admin/.test(e?.message || "") && !e.code);
  globalThis.__settings = settings({ fapshiApiKey: null }); e = await rejects(pay);
  check("existing behaviour: missing credentials still say 'not configured'", /not configured/.test(e?.message || ""));
} finally {
  globalThis.fetch = realFetch;
  setEnv(Object.fromEntries(Object.entries(baseEnv).filter(([, v]) => v !== undefined)));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- source-level facts
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const safetySrc = strip(fs.readFileSync(path.join(REPO, "src/lib/fapshiSafety.ts"), "utf8"));
check("guard: dependency-free and never reads process.env itself", !/^import /m.test(safetySrc) && !/process\.env/.test(safetySrc));
check("guard: never logs", !/console\./.test(safetySrc));
const settingsSrc = fs.readFileSync(path.join(REPO, "src/lib/platformSettings.ts"), "utf8");
check("platformSettings: credential resolution order and base URLs are unchanged", /fapshiApiUser: fapshiApiUser \|\| process\.env\.FAPSHI_API_USER \|\| null/.test(settingsSrc) && /fapshiTestMode \? "https:\/\/sandbox\.fapshi\.com" : "https:\/\/live\.fapshi\.com"/.test(settingsSrc));
const consts = jitiPlain(path.join(REPO, "src/lib/productCheckout/constants.ts"));
check("VERIFY_PROVIDER_AMOUNT is still enabled", consts.VERIFY_PROVIDER_AMOUNT === true);
const settle = fs.readFileSync(path.join(REPO, "src/lib/productCheckout/settlement.ts"), "utf8");
check("the provider amount check is still wired into settlement", /VERIFY_PROVIDER_AMOUNT/.test(settle));

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
