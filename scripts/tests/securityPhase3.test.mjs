// Security Phase 3 (database / data audit): the private-file-path ownership guard.
// Static pins on the un-applied migration and on the two server routes it protects, plus the real SQL run on an in-memory PostgreSQL
// (supabase/support/tests/private_file_path.adversarial.mjs, needs PGlite). No network, no Supabase.
//   Run:  node scripts/tests/securityPhase3.test.mjs
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const sqlCode = (rel) => read(rel).replace(/--[^\n]*/g, "");
let passed = 0;
const failures = [];
const check = (name, cond) => { if (cond) passed++; else failures.push(name); };

const MIG = "supabase/migrations/2026-10-07b_private_file_path_ownership_guard.sql";
const m = sqlCode(MIG);
check("guards tracks.protected_audio_path and products.digital_file_path with BEFORE INSERT / UPDATE OF triggers", /create trigger tracks_protected_audio_path_guard_trg before insert or update of protected_audio_path on public\.tracks/.test(m) && /create trigger products_digital_file_path_guard_trg before insert or update of digital_file_path on public\.products/.test(m));
check("the function pins its search_path and no API role may execute it", /set search_path = pg_catalog, public, pg_temp/.test(m) && /revoke all on function public\.private_file_path_guard\(\) from public, anon, authenticated, service_role;/.test(m));
check("a trusted server caller (auth.uid() null) and admins are not blocked; clearing and unchanged values are allowed", /if auth\.uid\(\) is null then return new; end if;/.test(m) && /public\.is_admin\(\)/.test(m) && /is not distinct from v_old/.test(m));
check("only the caller's own folder or the row owner's folder is accepted; traversal, leading slash and backslash are refused", /v_prefix = auth\.uid\(\)::text/.test(m) && /p\.user_id::text = v_prefix/.test(m) && /\\\.\\\./.test(m) && /like '\/%'/.test(m) && /position\('\\' in v_new\) > 0/.test(m));
check("the migration changes no policy, grant, column or row", !/\b(create policy|alter policy|drop policy|grant |alter table|insert into|update public|delete from)\b/i.test(m.replace(/revoke all[^;]*;/g, "")));
check("rollback and verify scripts exist; verify is read-only", fs.existsSync(path.join(REPO, "supabase/support/2026-10-07b_private_file_path_ownership_guard.rollback.sql"))
  && !/\b(insert|update|delete|drop|create|alter|truncate)\b/i.test(sqlCode("supabase/support/2026-10-07b_private_file_path_ownership_guard.verify.sql").replace(/'(?:[^']|'')*'/g, "")));

// the two signing routes are the reason this guard exists: they must keep signing ONLY after the purchase check, with the service role
const audio = read("src/app/api/music/tracks/[id]/audio/route.ts");
const download = read("src/app/api/products/download/route.ts");
check("music audio route still verifies a paid order before it signs", /payment_status !== "paid"/.test(audio) && audio.indexOf('payment_status !== "paid"') < audio.indexOf("createSignedUrl"));
check("product download route still decides on the order snapshot before it signs", download.indexOf("decideDigitalDownload(") < download.indexOf("createSignedUrl"));
check("the protected buckets are still private with no public read policy", /values \('protected-audio', 'protected-audio', false\)/.test(read("supabase/migrations/2026-09-16_music_commerce.sql")) && /values \('digital-products', 'digital-products', false\)/.test(read("supabase/migrations/2026-11-14_digital_products_foundation.sql")));

const r = spawnSync(process.execPath, ["supabase/support/tests/private_file_path.adversarial.mjs"], { cwd: REPO, encoding: "utf8", timeout: 240000 });
const out = (r.stdout || "") + (r.stderr || "");
if (/Cannot find package|ERR_MODULE_NOT_FOUND/.test(out)) console.log("SKIPPED SQL run: PGlite not installed (npm install --no-save @electric-sql/pglite)");
else check("adversarial SQL run on in-memory PostgreSQL: all checks pass (" + (out.match(/(\d+\/\d+) checks passed/) || [])[1] + ")", r.status === 0 && /checks passed/.test(out));

console.log(`securityPhase3: ${passed} checks passed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
