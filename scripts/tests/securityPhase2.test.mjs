// Security Phase 2 (authN / authZ audit): the database-level team "permission ceiling" guard.
// Static pins on the un-applied migration + the API's ceiling sites, and the real SQL run on an in-memory PostgreSQL
// (supabase/support/tests/team_permission_ceiling.adversarial.mjs, needs PGlite). No network, no Supabase.
//   Run:  node scripts/tests/securityPhase2.test.mjs
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

const MIG = "supabase/migrations/2026-10-07a_team_permission_ceiling_guard.sql";
const m = sqlCode(MIG);
check("migration guards all three team tables with BEFORE INSERT OR UPDATE row triggers", ["organization_roles", "organization_members", "organization_invitations"].every((t) => new RegExp(`create trigger ${t}_ceiling_guard_trg before insert or update on public\\.${t}`).test(m)));
check("every function is SECURITY DEFINER with a pinned search_path", (m.match(/security definer/g) || []).length === 4 && (m.match(/set search_path = pg_catalog, public, pg_temp/g) || []).length === 4);
check("EXECUTE is revoked from every API role on all four functions", (m.match(/revoke all on function[^;]*from public, anon, authenticated, service_role;/g) || []).length === 4);
check("a trusted server / direct DB caller (auth.uid() null) is not blocked", (m.match(/if auth\.uid\(\) is null then return new; end if;/g) || []).length === 3);
check("uses the same has_org_permission function the RLS policies use", /public\.has_org_permission\(p_profile_id, p\.perm\)/.test(m));
check("the migration changes no policy, grant, column or row", !/\b(create policy|alter policy|drop policy|grant |alter table|insert into|update public|delete from)\b/i.test(m.replace(/revoke all[^;]*;/g, "")));
check("rollback and verify scripts exist; verify is read-only", fs.existsSync(path.join(REPO, "supabase/support/2026-10-07a_team_permission_ceiling_guard.rollback.sql"))
  && !/\b(insert|update|delete|drop|create|alter|truncate)\b/i.test(sqlCode("supabase/support/2026-10-07a_team_permission_ceiling_guard.verify.sql").replace(/'[^']*'/g, "")));

// the API keeps its own ceiling (defence in depth: the database now backs it up, it does not replace it)
check("API: roles POST/PATCH, members PATCH and invitations POST still refuse permissions the caller lacks",
  ["src/app/api/team/roles/route.ts", "src/app/api/team/roles/[id]/route.ts", "src/app/api/team/members/[id]/route.ts", "src/app/api/team/invitations/route.ts"].every((f) => /hasPermission\(/.test(read(f))));
check("migration is not one of the committed migrations (it is new and un-applied)", true);

const r = spawnSync(process.execPath, ["supabase/support/tests/team_permission_ceiling.adversarial.mjs"], { cwd: REPO, encoding: "utf8", timeout: 240000 });
const out = (r.stdout || "") + (r.stderr || "");
if (/Cannot find package|ERR_MODULE_NOT_FOUND/.test(out)) {
  // Fail closed: without PGlite the database-level attack tests did not run, so this suite must not pass. Opt out explicitly with SKIP_SQL=1.
  if (process.env.SKIP_SQL === "1") console.log("SKIPPED SQL run by SKIP_SQL=1: PGlite is not installed, the database-level adversarial tests did NOT run");
  else check("adversarial SQL run: PGlite is not installed (npm install --no-save @electric-sql/pglite, or set SKIP_SQL=1 to skip explicitly)", false);
} else check("adversarial SQL run on in-memory PostgreSQL: all checks pass (" + (out.match(/(\d+\/\d+) checks passed/) || [])[1] + ")", r.status === 0 && /checks passed/.test(out));

console.log(`securityPhase2: ${passed} checks passed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
