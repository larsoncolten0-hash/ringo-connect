// Adversarial test for supabase/migrations/2026-10-07b_private_file_path_ownership_guard.sql (Phase 3 security).
//
// Scratch in-memory PostgreSQL (PGlite) only; never connects to Supabase. It builds tracks / products with the repository's own owner-write and
// public-read RLS shapes and the ORIGINAL is_admin(), proves the cross-creator file theft works BEFORE the guard (control), then applies the REAL
// migration, rollback and verify files and attacks it.
//   Setup:  npm install --no-save @electric-sql/pglite      Run:  node supabase/support/tests/private_file_path.adversarial.mjs
import fs from "fs";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const sql = (rel) => fs.readFileSync(REPO + rel, "utf8").replace(/\r\n/g, "\n");
const MIGRATION = sql("supabase/migrations/2026-10-07b_private_file_path_ownership_guard.sql");
const ROLLBACK = sql("supabase/support/2026-10-07b_private_file_path_ownership_guard.rollback.sql");
const VERIFY = sql("supabase/support/2026-10-07b_private_file_path_ownership_guard.verify.sql");
const IS_ADMIN = (() => { const m = sql("supabase/schema.sql").replace(/--[^\n]*/g, "").match(/create or replace function is_admin\(\)[\s\S]*?\$\$ language sql security definer;/i); if (!m) throw new Error("is_admin not found"); return m[0]; })();

const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", detail); };
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const refused = async (fn) => ((await errOf(fn))?.message || "").includes("private_file_path_ownership");
const ok = async (fn) => (await errOf(fn)) === null;

const ID = (k, n) => `${k}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { attacker: ID("a", 1), victim: ID("a", 2), staff: ID("a", 3), admin: ID("a", 4) };
const P = { attacker: ID("b", 1), victim: ID("b", 2) };
const VICTIM_AUDIO = `${U.victim}/tracks-protected/${ID("f", 1)}.mp3`;
const VICTIM_PDF = `${U.victim}/digital/${ID("f", 2)}.pdf`;
const OWN_AUDIO = `${U.attacker}/tracks-protected/${ID("f", 3)}.mp3`;
const OWN_PDF = `${U.attacker}/digital/${ID("f", 4)}.pdf`;

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.users (id uuid primary key, role text not null default 'creator');
  create table public.profiles (id uuid primary key, user_id uuid not null);
  create table public.tracks (id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id), title text not null default 't', price numeric default 0, protected_audio_path text);
  create table public.products (id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id), name text not null default 'p', price numeric default 0, product_type text default 'digital', digital_file_path text);
  create table public.org_members (profile_id uuid, user_id uuid);
  grant all on all tables in schema public to anon, authenticated, service_role;
  ${IS_ADMIN}
  grant execute on all functions in schema public to anon, authenticated, service_role;
  alter table public.tracks enable row level security; alter table public.products enable row level security; alter table public.users enable row level security; alter table public.profiles enable row level security;
  create policy "u" on public.users for select using (true); create policy "p" on public.profiles for select using (true);
  -- the repository's policies: public read, owner write (FOR ALL), plus a staff write policy standing in for the team 'products.manage' policy
  create policy "tracks public read" on public.tracks for select using (true);
  create policy "tracks owner write" on public.tracks for all using (exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin())));
  create policy "products public read" on public.products for select using (true);
  create policy "products owner write" on public.products for all using (exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin())));
  create policy "products staff write" on public.products for all using (exists (select 1 from org_members m where m.profile_id = products.profile_id and m.user_id = auth.uid()));
  insert into users values ('${U.attacker}','creator'), ('${U.victim}','creator'), ('${U.staff}','creator'), ('${U.admin}','admin');
  insert into profiles values ('${P.attacker}','${U.attacker}'), ('${P.victim}','${U.victim}');
  insert into org_members values ('${P.victim}','${U.staff}');
  insert into tracks (id, profile_id, title, protected_audio_path) values ('${ID("c", 1)}','${P.victim}','Victim song','${VICTIM_AUDIO}'), ('${ID("c", 2)}','${P.attacker}','Mine',null);
  insert into products (id, profile_id, name, digital_file_path) values ('${ID("d", 1)}','${P.victim}','Victim ebook','${VICTIM_PDF}'), ('${ID("d", 2)}','${P.attacker}','Mine',null);
`);
const as = async (role, sub, q) => { await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`); try { return await db.query(q); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false)`); } };
const val = async (q) => (await db.query(q)).rows[0];
const setTrack = (sub, path, id = ID("c", 2)) => as("authenticated", sub, `update public.tracks set protected_audio_path = ${path === null ? "null" : `'${path}'`} where id = '${id}'`);
const setProd = (sub, path, id = ID("d", 2)) => as("authenticated", sub, `update public.products set digital_file_path = ${path === null ? "null" : `'${path}'`} where id = '${id}'`);

console.log("### 0. CONTROL: before the guard, the public path + owner-write RLS let any creator aim their item at a victim's private file");
check("the victim's private paths are readable by anonymous visitors (public read policy)", (await as("anon", null, `select protected_audio_path p from public.tracks where id='${ID("c", 1)}'`)).rows[0].p === VICTIM_AUDIO && (await as("anon", null, `select digital_file_path p from public.products where id='${ID("d", 1)}'`)).rows[0].p === VICTIM_PDF);
await setTrack(U.attacker, VICTIM_AUDIO);
await setProd(U.attacker, VICTIM_PDF);
check("control: the attacker's track now carries the victim's protected_audio_path (the download route would sign it)", (await val(`select protected_audio_path p from public.tracks where id='${ID("c", 2)}'`)).p === VICTIM_AUDIO);
check("control: the attacker's product now carries the victim's digital_file_path", (await val(`select digital_file_path p from public.products where id='${ID("d", 2)}'`)).p === VICTIM_PDF);
await db.exec(`update public.tracks set protected_audio_path = null where id='${ID("c", 2)}'; update public.products set digital_file_path = null where id='${ID("d", 2)}'`);

console.log("### 1. apply the REAL migration");
check("the migration applies and commits", (await errOf(() => db.exec(MIGRATION))) === null);
check("the guard function is not executable by any API role", !(await val(`select bool_or(has_function_privilege(r, 'public.private_file_path_guard()', 'EXECUTE')) x from (values ('anon'),('authenticated'),('service_role')) v(r)`)).x);

console.log("### 2. the theft is refused, every way it can be spelled");
check("UPDATE track -> victim's audio path refused", await refused(() => setTrack(U.attacker, VICTIM_AUDIO)));
check("UPDATE product -> victim's digital path refused", await refused(() => setProd(U.attacker, VICTIM_PDF)));
check("INSERT a new track with the victim's path refused", await refused(() => as("authenticated", U.attacker, `insert into public.tracks (profile_id, protected_audio_path) values ('${P.attacker}', '${VICTIM_AUDIO}')`)));
check("INSERT a new product with the victim's path refused", await refused(() => as("authenticated", U.attacker, `insert into public.products (profile_id, digital_file_path) values ('${P.attacker}', '${VICTIM_PDF}')`)));
for (const [label, p] of [["path traversal into the victim's folder", `${U.attacker}/../${U.victim}/tracks-protected/x.mp3`], ["a leading slash", `/${U.victim}/x.mp3`], ["the victim's id as a later segment", `x/${U.victim}/x.mp3`], ["a backslash", `${U.attacker}\\\\..\\\\${U.victim}`], ["a bare folder with no file", `${U.attacker}/`], ["no folder at all", "song.mp3"], ["a traversal that stays inside my own folder name", `${U.attacker}/a/../b`]]) {
  check(`refused: ${label}`, await refused(() => setTrack(U.attacker, p)) && await refused(() => setProd(U.attacker, p)));
}
check("a mixed update (price + the victim's path) is refused as a whole and changes nothing", await refused(() => as("authenticated", U.attacker, `update public.tracks set price = 999, protected_audio_path = '${VICTIM_AUDIO}' where id='${ID("c", 2)}'`)) && Number((await val(`select price p from public.tracks where id='${ID("c", 2)}'`)).p) === 0);
check("the victim's own rows are untouched", (await val(`select protected_audio_path p from public.tracks where id='${ID("c", 1)}'`)).p === VICTIM_AUDIO && (await val(`select digital_file_path p from public.products where id='${ID("d", 1)}'`)).p === VICTIM_PDF);

console.log("### 3. legitimate use is unaffected");
check("a creator can attach a file in their OWN folder (what the editor uploads)", await ok(() => setTrack(U.attacker, OWN_AUDIO)) && await ok(() => setProd(U.attacker, OWN_PDF)));
check("a creator can insert a track / product that carries their own path", await ok(() => as("authenticated", U.attacker, `insert into public.tracks (profile_id, protected_audio_path) values ('${P.attacker}', '${OWN_AUDIO}')`)) && await ok(() => as("authenticated", U.attacker, `insert into public.products (profile_id, digital_file_path) values ('${P.attacker}', '${OWN_PDF}')`)));
check("a creator can clear the file", await ok(() => setTrack(U.attacker, null)) && await ok(() => setProd(U.attacker, null)));
check("a STAFF member of the victim's business can attach a file in their own folder", await ok(() => setProd(U.staff, `${U.staff}/digital/${ID("f", 5)}.pdf`, ID("d", 1))));
check("a STAFF member can attach a file in the business OWNER's folder (e.g. duplicating the owner's product)", await ok(() => setProd(U.staff, VICTIM_PDF, ID("d", 1))));
check("a STAFF member cannot aim the victim's product at a THIRD party's folder", await refused(() => setProd(U.staff, `${U.attacker}/digital/${ID("f", 4)}.pdf`, ID("d", 1))));
await db.exec(`update public.products set digital_file_path = '${VICTIM_PDF}' where id='${ID("d", 1)}'`);
await db.exec(`update public.tracks set protected_audio_path = '${VICTIM_AUDIO}' where id='${ID("c", 2)}'`); // simulate a row that ALREADY points elsewhere (pre-existing data)
check("editing OTHER columns of a row whose path is unchanged is never blocked (existing data is not retro-judged)", await ok(() => as("authenticated", U.attacker, `update public.tracks set price = 5, title = 'new' where id='${ID("c", 2)}'`)) && await ok(() => as("authenticated", U.attacker, `update public.tracks set protected_audio_path = '${VICTIM_AUDIO}' where id='${ID("c", 2)}'`)));
await db.exec(`update public.tracks set protected_audio_path = null where id='${ID("c", 2)}'`);
check("a platform ADMIN is exempt, as for every other write", await ok(() => as("authenticated", U.admin, `update public.tracks set protected_audio_path = '${VICTIM_AUDIO}' where id='${ID("c", 2)}'`)));
await db.exec(`update public.tracks set protected_audio_path = null where id='${ID("c", 2)}'`);
check("the SERVICE ROLE is unaffected", await ok(() => as("service_role", null, `update public.tracks set protected_audio_path = '${VICTIM_AUDIO}' where id='${ID("c", 2)}'`)));
await db.exec(`update public.tracks set protected_audio_path = null where id='${ID("c", 2)}'`);
check("a non-owner still cannot write at all (RLS unchanged)", (await as("authenticated", U.attacker, `update public.tracks set price = 1 where id='${ID("c", 1)}' returning id`)).rows.length === 0);

console.log("### 4. verify script, rollback, re-apply");
const ver = (await db.query(VERIFY)).rows;
check("verification: P1-P3 all pass", ver.filter((r) => ["P1", "P2", "P3"].includes(r.grp)).length === 4 && ver.filter((r) => ["P1", "P2", "P3"].includes(r.grp)).every((r) => r.status === "PASS"), JSON.stringify(ver));
check("verification: D1 / D2 count existing out-of-folder rows (none in this scratch DB after cleanup)", ver.find((r) => r.grp === "D1") && ver.find((r) => r.grp === "D2"));
check("the verification script is a single read-only SELECT", !/\b(insert|update|delete|drop|create|alter|truncate)\b/i.test(VERIFY.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "")));
await db.exec(ROLLBACK);
check("rollback removes only this guard", (await val(`select count(*)::int c from pg_trigger where tgname like '%path_guard_trg'`)).c === 0 && (await val(`select count(*)::int c from pg_proc where proname = 'private_file_path_guard'`)).c === 0);
await setTrack(U.attacker, VICTIM_AUDIO);
check("after rollback the weakness is back (so the guard is what closed it)", (await val(`select protected_audio_path p from public.tracks where id='${ID("c", 2)}'`)).p === VICTIM_AUDIO);
await db.exec(`update public.tracks set protected_audio_path = null where id='${ID("c", 2)}'`);
check("the migration re-applies cleanly after a rollback, and is idempotent", (await errOf(() => db.exec(MIGRATION))) === null && (await errOf(() => db.exec(MIGRATION))) === null && await refused(() => setTrack(U.attacker, VICTIM_AUDIO)));

const failed = results.filter((r) => !r.pass);
console.log(`\nprivate_file_path.adversarial: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("FAILED:\n - " + failed.map((f) => f.name).join("\n - ")); process.exit(1); }
