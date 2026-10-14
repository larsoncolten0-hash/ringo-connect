// Loads a generated batch of Smart Card token HASHES into the database. DRY RUN BY DEFAULT: it only reads the private hash file and verifies it.
//
//   node scripts/smartcards/importBatch.mjs --file <PRIVATE_DO_NOT_SHARE/import_batch-001.json>                                         (dry run: no network, no database)
//   node scripts/smartcards/importBatch.mjs --file <...> --execute --confirm-count 500 --confirm-batch batch-001                          (writes; see docs/smart-cards-production-plan.md)
//
// To write it needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (never in a file the script reads, never printed). The write is ONE call to
// the all-or-nothing database function smartcard_import_batch: it inserts only missing rows, skips identical ones, and refuses (importing nothing) if any serial or hash
// already exists with different data. Raw tokens are never in the input file and never leave the generator. Do NOT run --execute without the owner's explicit approval.
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const flag = (name) => process.argv.includes(`--${name}`);
const file = arg("file");
if (!file) throw new Error("--file <import_batch-001.json> is required");

const data = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const { batch, rows } = data;
const problems = [];
if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(batch || "")) problems.push("bad batch name");
if (!Array.isArray(rows)) problems.push("rows missing");
const list = Array.isArray(rows) ? rows : [];
if (list.some((r) => typeof r.serial !== "string" || !/^RINGO-[0-9]{4}$/.test(r.serial))) problems.push("a serial is malformed");
if (list.some((r) => typeof r.token_hash !== "string" || !/^[0-9a-f]{64}$/.test(r.token_hash))) problems.push("a hash is malformed");
if (new Set(list.map((r) => r.serial)).size !== list.length) problems.push("duplicate serials");
if (new Set(list.map((r) => r.token_hash)).size !== list.length) problems.push("duplicate hashes");
if (list.some((r, i) => r.serial !== `RINGO-${String(i + 1).padStart(4, "0")}`)) problems.push("serials are not RINGO-0001.. in order");
if (list.some((r) => Object.keys(r).sort().join() !== "serial,token_hash")) problems.push("rows must contain only serial and token_hash");
console.log(`file: ${list.length} rows for ${batch}; ${problems.length ? "PROBLEMS: " + problems.join("; ") : "format, uniqueness and numbering OK"}`);
if (problems.length) process.exit(1);

if (!flag("execute")) {
  console.log("DRY RUN: nothing was sent anywhere. Add --execute --confirm-count <n> --confirm-batch <name> to write (owner approval required).");
  process.exit(0);
}
if (Number(arg("confirm-count")) !== list.length || arg("confirm-batch") !== batch) {
  console.error(`refusing: --confirm-count must equal ${list.length} and --confirm-batch must equal ${batch}`);
  process.exit(2);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("refusing: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment"); process.exit(2); }
console.log(`target project host: ${new URL(url).host}`); // the host only; never the key
const { createClient } = require("@supabase/supabase-js");
const admin = createClient(url, key, { auth: { persistSession: false } });
const { data: result, error } = await admin.rpc("smartcard_import_batch", { p_batch: batch, p_rows: list });
if (error) { console.error("import refused (nothing was imported):", error.message); process.exit(3); }
console.log("import result:", JSON.stringify(result));
// the function reports the batch total itself (the service role has no direct table access by design)
const ok = result && result.batch_total === list.length && result.inserted + result.skipped === list.length;
console.log(`verification: ${result?.batch_total} rows in ${batch} (expected ${list.length}) ${ok ? "OK" : "MISMATCH"}`);
process.exit(ok ? 0 : 4);
