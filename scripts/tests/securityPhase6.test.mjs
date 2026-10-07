// Security Phase 6 (payments / financial): two simultaneous payout requests must not both pay out the same balance. Static pins on the un-applied migration and on the
// payout / earnings structure it relies on, plus the real SQL run on an in-memory PostgreSQL (supabase/support/tests/payout_concurrency.adversarial.mjs, needs PGlite).
// No network, no Supabase, no Fapshi, no money.
//   Run:  node scripts/tests/securityPhase6.test.mjs
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

const MIG = "supabase/migrations/2026-10-07c_payout_request_concurrency_guard.sql";
const m = sqlCode(MIG);
check("both payout tables get a BEFORE INSERT row trigger", /create trigger music_payout_concurrency_guard_trg before insert on public\.music_payouts/.test(m) && /create trigger affiliate_payout_concurrency_guard_trg before insert on public\.affiliate_payouts/.test(m));
check("both functions are SECURITY DEFINER with a pinned search_path and no API role may execute them", (m.match(/security definer/g) || []).length === 2 && (m.match(/set search_path = pg_catalog, public, pg_temp/g) || []).length === 2 && (m.match(/revoke all on function[^;]*from public, anon, authenticated, service_role;/g) || []).length === 2);
check("each takes the per-earner advisory lock BEFORE it reads the balance, and refuses an amount above it", [["music", "sum(e.artist_amount)"], ["affiliate", "sum(c.amount)"]].every(([k, s]) => { const body = m.slice(m.indexOf(`function public.${k}_payout_concurrency_guard`)); return body.indexOf("pg_advisory_xact_lock") > 0 && body.indexOf("pg_advisory_xact_lock") < body.indexOf(s) && /new\.amount > v_available/.test(body); }));
check("a trusted server caller (auth.uid() null) and non-'requested' rows are not blocked", (m.match(/if auth\.uid\(\) is null then return new; end if;/g) || []).length === 2 && (m.match(/new\.status is distinct from 'requested'/g) || []).length === 2);
check("the migration changes no function body, policy, grant, column or row", !/\b(create policy|alter policy|drop policy|grant |alter table|insert into|update public|delete from|request_music_payout|request_affiliate_payout)\b/i.test(m.replace(/revoke all[^;]*;/g, "")));
check("rollback and verify scripts exist; verify is read-only", fs.existsSync(path.join(REPO, "supabase/support/2026-10-07c_payout_request_concurrency_guard.rollback.sql"))
  && !/\b(insert|update|delete|drop|create|alter|truncate)\b/i.test(sqlCode("supabase/support/2026-10-07c_payout_request_concurrency_guard.verify.sql").replace(/'(?:[^']|'')*'/g, "")));

// the structure the guard relies on is unchanged: the RPCs insert the payout first, then link the earnings (so the re-check under the lock sees committed links)
const music = sqlCode("supabase/migrations/2026-09-20_music_payments.sql");
const aff = sqlCode("supabase/migrations/2026-09-06_affiliate_system.sql");
check("the payout RPCs still select the balance, insert the payout, then link the earnings (the sequence the lock protects)", [music, aff].every((s) => { const f = s.slice(s.search(/function request_(music|affiliate)_payout/)); return f.indexOf("sum(") < f.indexOf("insert into") && f.indexOf("insert into") < f.indexOf("update "); }));
check("the shop and ambassador payout requests already lock their rows first (for update), so only music and affiliate needed the guard", /for update/.test(sqlCode("supabase/migrations/2026-11-05_shop_payouts.sql")) && /for update/.test(sqlCode("supabase/migrations/2026-11-26_ambassador_financial_hardening.sql")));
check("earnings rows are one per order / payment (a payment cannot become several payable rows)", /order_id uuid not null unique references music_orders/.test(music) && /payment_transaction_id uuid not null unique references payment_transactions/.test(aff) && /order_id uuid not null unique references product_orders/.test(sqlCode("supabase/migrations/2026-11-02_product_checkout_foundation.sql")));
check("music_sale_earnings / affiliate_commissions / the payout tables have no user-writable policy (only the admin update policy)", [music, aff].every((s) => !/create policy[^;]*on (music_sale_earnings|music_payouts|affiliate_commissions|affiliate_payouts)\s+for (insert|all|delete)/i.test(s)));

const r = spawnSync(process.execPath, ["supabase/support/tests/payout_concurrency.adversarial.mjs"], { cwd: REPO, encoding: "utf8", timeout: 240000 });
const out = (r.stdout || "") + (r.stderr || "");
if (/Cannot find package|ERR_MODULE_NOT_FOUND/.test(out)) console.log("SKIPPED SQL run: PGlite not installed (npm install --no-save @electric-sql/pglite)");
else check("adversarial SQL run on in-memory PostgreSQL: all checks pass (" + (out.match(/(\d+\/\d+) checks passed/) || [])[1] + ")", r.status === 0 && /checks passed/.test(out));

console.log(`securityPhase6: ${passed} checks passed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
