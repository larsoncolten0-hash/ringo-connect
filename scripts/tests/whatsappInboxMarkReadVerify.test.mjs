// Executes the REAL read-only verify script for the mark-read migration (supabase/support/2026-12-12_whatsapp_inbox_mark_read.verify.sql) against a
// scratch in-memory PostgreSQL (PGlite) that has the Phase 4 foundation and the mark-read migration applied. It guards against the verify script
// itself being broken (a SQL error, a wrong row count, or a check that reports false on a correct deployment). No Supabase, no network, no credentials.
//   Run:  node scripts/tests/whatsappInboxMarkReadVerify.test.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 600)); };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");

const db = new PGlite();
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
`);
await db.exec(read("supabase/migrations/2026-12-07_whatsapp_inbox_foundation.sql"));
await db.exec(read("supabase/migrations/2026-12-12_whatsapp_inbox_mark_read.sql"));

const verifySql = read("supabase/support/2026-12-12_whatsapp_inbox_mark_read.verify.sql");
let rows = null, error = "";
try { rows = (await db.query(verifySql)).rows; } catch (e) { error = String(e.message); }

check("verify script: executes without a SQL error", rows !== null, error);
check("verify script: returns all 7 verification rows", Array.isArray(rows) && rows.length === 7, rows ? String(rows.length) : "no rows");
check("verify script: every row has ok = true", Array.isArray(rows) && rows.length > 0 && rows.every((r) => r.ok === true), (rows || []).filter((r) => r.ok !== true).map((r) => `${r.label} expect=${r.expect} actual=${r.actual}`).join(" ; "));
check("verify script: the 7 labels are 01..07 in order", Array.isArray(rows) && rows.map((r) => r.label.slice(0, 2)).join() === "01,02,03,04,05,06,07", (rows || []).map((r) => r.label.slice(0, 2)).join());

// Negative control: once the function is dropped (as the rollback does) the same script must report failures, so the checks are not vacuous.
await db.exec(read("supabase/support/2026-12-12_whatsapp_inbox_mark_read.rollback.sql"));
let after = null;
try { after = (await db.query(verifySql)).rows; } catch { after = null; }
check("verify script: after the rollback it reports not-ok (the checks are not vacuous)", Array.isArray(after) && after.some((r) => r.ok !== true));

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
