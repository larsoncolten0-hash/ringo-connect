// One command for every security check built in security Phases 1-7:   npm run security:test      (or: node scripts/security-suite.mjs)
//
// It only RUNS the existing test files, each in its own process, and reads their exit codes; it contains no test logic of its own. Exit 0 only when every required suite
// ran and passed. Exit 1 when any suite fails, when a required suite file is missing (a deleted test is a failure, not a pass) or when PGlite is missing.
//
// FAIL CLOSED on PGlite: the database-level adversarial tests need PGlite (`npm install --no-save @electric-sql/pglite`, nothing is added to package.json). Without it this
// command FAILS up front instead of reporting green with those tests skipped. A developer who deliberately wants the non-SQL checks only sets SKIP_SQL=1: the SQL suites are
// then listed as SKIPPED (never as passed), and the run still exits 0 only if everything else passed.
//
//   node scripts/security-suite.mjs            run everything
//   node scripts/security-suite.mjs --list     print the suites and exit
//   node scripts/security-suite.mjs phase3     run only suites whose id or name contains "phase3"
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);

// sql: true = the suite itself runs database-level attacks on PGlite (or spawns a script that does)
const SUITES = [
  { id: "phase1", name: "Phase 1  security controls (+ 183 adversarial SQL checks)", file: "scripts/tests/securityPhase1.test.mjs", sql: true },
  { id: "phase1-sql", name: "Phase 1  adversarial SQL: privileged columns, URL guard, definer search_path", file: "supabase/support/tests/security_phase1.adversarial.mjs", sql: true },
  { id: "phase2", name: "Phase 2  team permission ceiling", file: "scripts/tests/securityPhase2.test.mjs", sql: true },
  { id: "phase2-sql", name: "Phase 2  adversarial SQL: team permission ceiling", file: "supabase/support/tests/team_permission_ceiling.adversarial.mjs", sql: true },
  { id: "phase3", name: "Phase 3  private file path ownership", file: "scripts/tests/securityPhase3.test.mjs", sql: true },
  { id: "phase3-sql", name: "Phase 3  adversarial SQL: private file path ownership", file: "supabase/support/tests/private_file_path.adversarial.mjs", sql: true },
  { id: "phase4", name: "Phase 4  music order <-> Fapshi transaction binding", file: "scripts/tests/securityPhase4.test.mjs", sql: false },
  { id: "phase5", name: "Phase 5  infrastructure / secrets hygiene", file: "scripts/tests/securityPhase5.test.mjs", sql: false },
  { id: "phase6", name: "Phase 6  payout request concurrency", file: "scripts/tests/securityPhase6.test.mjs", sql: true },
  { id: "phase6-sql", name: "Phase 6  adversarial SQL: payout concurrency", file: "supabase/support/tests/payout_concurrency.adversarial.mjs", sql: true },
  { id: "phase7", name: "Phase 7  audit trail, payout destination / failure events", file: "scripts/tests/securityPhase7.test.mjs", sql: false },
  { id: "demo-flag-sql", name: "Earlier  adversarial SQL: profiles demo flag guard", file: "supabase/support/tests/profiles_demo_flag_guard.adversarial.mjs", sql: true },
  { id: "partner-demo", name: "Earlier  partner / demo route security", file: "supabase/support/tests/partner_demo_security.mjs", sql: true },
  { id: "fapshi", name: "Earlier  Fapshi payment safety", file: "scripts/tests/fapshiSafety.test.mjs", sql: false },
  { id: "protection", name: "Earlier  Ringo Protection security audit", file: "scripts/tests/protectionSecurityAudit.test.mjs", sql: false },
  { id: "whatsapp", name: "Earlier  WhatsApp security audit", file: "scripts/tests/whatsappSecurityAudit.test.mjs", sql: false },
];

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const s of SUITES) console.log(`${s.id.padEnd(14)} ${s.sql ? "[sql] " : "      "}${s.file}  -  ${s.name}`);
  process.exit(0);
}
const filters = args.filter((a) => !a.startsWith("--")).map((a) => a.toLowerCase());
const selected = filters.length ? SUITES.filter((s) => filters.some((f) => s.id.includes(f) || s.name.toLowerCase().includes(f))) : SUITES;
if (selected.length === 0) { console.error(`No suite matches: ${filters.join(", ")}  (try --list)`); process.exit(2); }

const skipSql = process.env.SKIP_SQL === "1";
let hasPglite = true;
try { require.resolve(process.env.PGLITE_ENTRY || "@electric-sql/pglite"); } catch { hasPglite = false; }
const needSql = selected.filter((s) => s.sql);

console.log(`Ringo Connect security suite: ${selected.length} suites${skipSql ? "  (SKIP_SQL=1: database-level suites will be SKIPPED, not passed)" : ""}\n`);
if (!hasPglite && needSql.length > 0 && !skipSql) {
  console.error("FAIL: @electric-sql/pglite is not installed, so the database-level adversarial tests cannot run:");
  for (const s of needSql) console.error(`   - ${s.id}  (${s.file})`);
  console.error("\nInstall it (nothing is written to package.json):   npm install --no-save @electric-sql/pglite");
  console.error("Or, to run only the non-SQL checks on purpose:     SKIP_SQL=1 npm run security:test   (the SQL suites are reported SKIPPED, never passed)");
  process.exit(1);
}

const rows = [];
for (const s of selected) {
  const abs = path.join(REPO, s.file);
  if (!fs.existsSync(abs)) { rows.push({ ...s, status: "FAIL", note: "suite file is MISSING (a removed security test counts as a failure)", ms: 0 }); console.log(`FAIL  ${s.id}  ${s.file} is missing\n`); continue; }
  // A standalone SQL script (supabase/support/tests) cannot run at all without PGlite. The security*.test.mjs wrappers still run their non-SQL checks and skip only their SQL part.
  if (s.sql && s.file.startsWith("supabase/") && skipSql && !hasPglite) { rows.push({ ...s, status: "SKIPPED", note: "SKIP_SQL=1 and PGlite is not installed", ms: 0 }); console.log(`SKIP  ${s.id}  (SKIP_SQL=1, PGlite not installed)\n`); continue; }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [abs], { cwd: REPO, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024, env: process.env });
  const ms = Date.now() - t0;
  const clean = (t) => (t || "").replace(/^warning: .*\n/gm, "").trim().split("\n").filter(Boolean);
  const outLines = clean(r.stdout);
  const lines = [...outLines, ...clean(r.stderr)];
  // the summary comes from stdout (the suite's own result line); stderr is only a fallback, so a logged error line can never be mistaken for the result
  const pick = (ls) => [...ls].reverse().find((l) => /passed|checks passed|FAIL/i.test(l));
  const summary = pick(outLines) || pick(lines) || lines[lines.length - 1] || "(no output)";
  const failed = r.status !== 0 || r.error || r.signal;
  rows.push({ ...s, status: failed ? "FAIL" : "PASS", note: summary.trim().slice(0, 160), ms });
  console.log(`${failed ? "FAIL" : "PASS"}  ${s.id.padEnd(13)} ${(ms / 1000).toFixed(1).padStart(5)}s  ${summary.trim().slice(0, 130)}`);
  if (failed) {
    console.log(`      ${s.name}\n      file: ${s.file}${r.error ? `\n      error: ${r.error.message}` : ""}`);
    for (const l of lines.filter((x) => /FAIL|FAILURES|Error|\bnot ok\b/.test(x)).slice(0, 12)) console.log(`      | ${l.slice(0, 200)}`);
  }
}

const count = (st) => rows.filter((r) => r.status === st).length;
console.log("\n" + "=".repeat(78));
console.log(`PASS ${count("PASS")}   FAIL ${count("FAIL")}   SKIPPED ${count("SKIPPED")}   of ${rows.length}`);
if (count("SKIPPED") > 0) console.log("SKIPPED suites did NOT run: this result is not a full security pass.");
if (count("FAIL") > 0) {
  console.log("FAILED: " + rows.filter((r) => r.status === "FAIL").map((r) => r.id).join(", "));
  process.exit(1);
}
console.log(count("SKIPPED") > 0 ? "No failures, but incomplete (SKIP_SQL=1)." : "Security suite passed.");
process.exit(0);
