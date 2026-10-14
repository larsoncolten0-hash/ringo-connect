// STAGING-ONLY concurrency check for smartcard_claim: fires many claims for ONE trial card at the same moment, from separate HTTP connections, as two different users.
// Exactly one claim may win; everything else must be refused; nothing may throw. It uses the real function on the real database engine (unlike the in-memory test).
//
//   node scripts/smartcards/concurrencyCheck.mjs --manifest <TRIAL SUPPLIER_PACKAGE/manifest.csv> --serial RINGO-0001 \
//        --user-a <uuid> --profile-a <uuid> --user-b <uuid> --profile-b <uuid> --confirm-staging-host <host>  [--attempts 20] [--execute]
//
// Without --execute it only validates its arguments (no network). With --execute it needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY of the STAGING project
// in the environment, and refuses unless --confirm-staging-host equals that project's host. NEVER point it at production, and never use a card from the real batch:
// use a throwaway trial batch (generateBatch.mjs --count 30 --batch trial-001). It consumes the trial card (it ends up claimed by one of the two users). Prints no token.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const need = ["manifest", "serial", "user-a", "profile-a", "user-b", "profile-b", "confirm-staging-host"];
const missing = need.filter((n) => !arg(n));
if (missing.length) throw new Error(`missing: ${missing.map((m) => "--" + m).join(" ")}`);
for (const n of ["user-a", "profile-a", "user-b", "profile-b"]) if (!UUID.test(arg(n))) throw new Error(`--${n} must be a uuid`);
if (arg("user-a") === arg("user-b")) throw new Error("user A and user B must be different accounts");
if (!/^RINGO-[0-9]{4}$/.test(arg("serial"))) throw new Error("--serial must look like RINGO-0001");
const attempts = Number(arg("attempts") || 20);
if (!Number.isInteger(attempts) || attempts < 4 || attempts > 100) throw new Error("--attempts must be 4..100");

const row = fs.readFileSync(path.resolve(arg("manifest")), "utf8").split(/\r?\n/).map((l) => l.split(",")).find((c) => c[0] === arg("serial"));
const url = row && row.slice(3).join(",");
const token = url && /\/c\/([A-Za-z0-9_-]{27})$/.exec(url)?.[1];
if (!token) throw new Error("that serial is not in the manifest (or its URL is malformed)");
const hash = crypto.createHash("sha256").update(token, "utf8").digest("hex");

if (!process.argv.includes("--execute")) {
  console.log(`arguments OK for ${arg("serial")} with ${attempts} concurrent attempts. DRY RUN: nothing was sent. Add --execute (staging only).`);
  process.exit(0);
}
const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!sbUrl || !key) { console.error("refusing: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (STAGING) must be in the environment"); process.exit(2); }
const host = new URL(sbUrl).host;
if (host !== arg("confirm-staging-host")) { console.error(`refusing: --confirm-staging-host must equal the target host (${host})`); process.exit(2); }
console.log(`target project host: ${host}`);

const { createClient } = require("@supabase/supabase-js");
// one client per attempt so each claim travels on its own connection
const attemptsList = Array.from({ length: attempts }, (_, i) => (i % 2 === 0 ? { who: "A", u: arg("user-a"), p: arg("profile-a") } : { who: "B", u: arg("user-b"), p: arg("profile-b") }));
const results = await Promise.all(attemptsList.map(async (a) => {
  const admin = createClient(sbUrl, key, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("smartcard_claim", { p_token_hash: hash, p_user_id: a.u, p_profile_id: a.p });
  return { who: a.who, error: error?.message ?? null, result: data?.result ?? null, already: data?.already ?? null };
}));
const winners = results.filter((r) => r.result === "claimed" && r.already === false);
const winnerWho = new Set(winners.map((w) => w.who));
const sameOwnerRepeats = results.filter((r) => r.result === "claimed" && r.already === true);
const refused = results.filter((r) => r.result === "already_claimed");
const errors = results.filter((r) => r.error || !r.result);
const unexpected = results.filter((r) => !["claimed", "already_claimed"].includes(r.result));
const losingOwner = winnerWho.has("A") ? "B" : "A";
const checks = [
  [`exactly ONE first-time claim succeeded (got ${winners.length})`, winners.length === 1],
  [`no attempt raised an error (${errors.length})`, errors.length === 0],
  [`no unexpected result (${unexpected.length})`, unexpected.length === 0],
  ["every attempt by the OTHER user was refused as already_claimed", results.filter((r) => r.who === losingOwner).every((r) => r.result === "already_claimed")],
  [`${attempts} attempts accounted for: 1 winner + ${sameOwnerRepeats.length} same-owner repeats + ${refused.length} refused`, 1 + sameOwnerRepeats.length + refused.length === attempts],
];
const { data: after } = await createClient(sbUrl, key, { auth: { persistSession: false } }).rpc("smartcard_resolve", { p_token_hash: hash });
checks.push(["the card now resolves as claimed", after?.status === "claimed"]);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
const ok = checks.every(([, v]) => v);
console.log(ok ? "RESULT: CONCURRENCY CHECK PASSED" : "RESULT: FAILED. DO NOT PROCEED TO PRODUCTION");
process.exit(ok ? 0 : 1);
