// Church stores can track stock: the 2027-01-15_church_inventory migration, attacked OFFLINE (PGlite, synthetic data, no Supabase, no network).
// It uses the REAL inv_start_tracking() text taken from 2026-12-04_inventory_stock_control.sql, with minimal stand-ins for the tables it touches, and proves:
//   * before the migration only Business & E-commerce can start tracking; after it a church can too; every other category is still refused (category_not_enabled);
//   * the migration changes only that category test (the rest of the function text is identical), is re-runnable, and the rollback restores the ORIGINAL text exactly;
//   * the function stays callable by no API role; the verify file is all true and read-only.
//   Run:  node scripts/tests/churchInventoryDb.test.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const INV = read("supabase/migrations/2026-12-04_inventory_stock_control.sql");
const start = INV.indexOf("create or replace function inv_start_tracking(");
const end = INV.indexOf("end $$;", start) + "end $$;".length;
check("the real function text was found", start > 0 && end > start);
const FN = INV.slice(start, end);
const MIG = read("supabase/migrations/2027-01-15_church_inventory.sql");
const VER = read("supabase/support/2027-01-15_church_inventory.verify.sql");
const ROLL = read("supabase/support/2027-01-15_church_inventory.rollback.sql");

const STUBS = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create table profiles (id uuid primary key, category text, categories text[] not null default '{}');
  create table products (id uuid primary key, profile_id uuid not null, name text, inventory_count int, product_type text);
  create table bk_stock_movements (id uuid primary key default gen_random_uuid(), profile_id uuid, product_id uuid, product_name_snapshot text, kind text, qty_delta int, balance_before int, balance_after int, client_request_id uuid, created_by uuid);
  create table bk_stock_settings (product_id uuid primary key, profile_id uuid, active boolean, low_stock_threshold int, tracking_started_at timestamptz, stopped_at timestamptz, created_by uuid, updated_by uuid);
  create function bk_doc_gate(p uuid, a uuid) returns void language sql as $$ select $$;
`;
const P = { biz: "a0000000-0000-4000-8000-000000000001", church: "a0000000-0000-4000-8000-000000000002", beauty: "a0000000-0000-4000-8000-000000000003", multi: "a0000000-0000-4000-8000-000000000004", biz2: "a0000000-0000-4000-8000-000000000005" };
const U = "c0000000-0000-4000-8000-000000000001";
const prod = (n) => `d0000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

async function fresh() {
  const db = new PGlite();
  await db.exec(STUBS);
  await db.exec(FN);
  await db.exec(`revoke all on function inv_start_tracking(uuid,uuid,uuid,int,int,uuid) from public;
    insert into profiles values ('${P.biz}','business_ecommerce','{}'), ('${P.church}','church_ministries','{}'), ('${P.beauty}','beauty_wellness','{}'), ('${P.multi}','other','{business_ecommerce,church_ministries}'), ('${P.biz2}','business_ecommerce','{}')`);
  let n = 0;
  for (const p of Object.values(P)) await db.exec(`insert into products values ('${prod(++n)}','${p}','Item',5,'physical')`);
  return db;
}
const start1 = async (db, profile, n) => {
  try {
    const r = await db.query(`select inv_start_tracking('${profile}','${U}','${prod(n)}',null,5,gen_random_uuid()) r`);
    return { ok: true, r: r.rows[0].r };
  } catch (e) { return { ok: false, msg: String(e.message) }; }
};
const def = async (db) => (await db.query("select pg_get_functiondef('inv_start_tracking(uuid,uuid,uuid,int,int,uuid)'::regprocedure) d")).rows[0].d;
const allOk = (r) => r.length > 0 && r.every((x) => x.ok === true);

{
  const db = await fresh();
  const original = await def(db);
  check("before: Business & E-commerce can start tracking", (await start1(db, P.biz, 1)).ok);
  const before = await start1(db, P.church, 2);
  check("before: a church is refused with category_not_enabled", !before.ok && /category_not_enabled/.test(before.msg), JSON.stringify(before));

  await db.exec(MIG);
  const widened = await def(db);
  check("the migration applies and the function now names church_ministries", widened.includes("church_ministries") && widened !== original);
  const stripped = (s) => s.replace(/select \(p\.category[^\n]*into v_cat/, "LINE");
  eq("ONLY the category line changed: the rest of the function is identical", stripped(widened), stripped(original));
  check("after: a church can start tracking, with its opening movement", (await start1(db, P.church, 2)).ok && (await db.query(`select count(*)::int n from bk_stock_movements where profile_id='${P.church}'`)).rows[0].n === 1);
  check("after: Business & E-commerce still can", (await start1(db, P.biz2, 5)).ok);
  check("after: a profile that merely lists church_ministries among several categories can", (await start1(db, P.multi, 4)).ok);
  const beauty = await start1(db, P.beauty, 3);
  check("after: any other category is STILL refused with category_not_enabled", !beauty.ok && /category_not_enabled/.test(beauty.msg), JSON.stringify(beauty));
  eq("a refused call changed nothing", (await db.query(`select count(*)::int n from bk_stock_movements where profile_id='${P.beauty}'`)).rows[0].n, 0);

  await db.exec(MIG);
  eq("the migration is re-runnable and changes nothing the second time", await def(db), widened);
  const priv = (await db.query("select has_function_privilege('anon','inv_start_tracking(uuid,uuid,uuid,int,int,uuid)','execute') a, has_function_privilege('authenticated','inv_start_tracking(uuid,uuid,uuid,int,int,uuid)','execute') b")).rows[0];
  check("the function is callable by no API role", priv.a === false && priv.b === false, JSON.stringify(priv));
  const ver = (await db.query(VER)).rows;
  check("the verify file is all true", allOk(ver), JSON.stringify(ver.filter((x) => !x.ok)));
  check("the verify file is READ-ONLY", /^with\b/m.test(VER.replace(/^--.*$/gm, "").trim()) && !/^\s*(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/im.test(VER.replace(/^--.*$/gm, "")));

  await db.exec(ROLL);
  eq("the rollback restores the ORIGINAL function text exactly", await def(db), original);
  await db.exec(ROLL);
  eq("the rollback is re-runnable", await def(db), original);
  await db.exec(MIG);
  eq("and the migration applies again after a rollback", await def(db), widened);
}
{
  const db = new PGlite();
  await db.exec(STUBS);
  let err = null;
  try { await db.exec(MIG); } catch (e) { err = String(e.message); await db.exec("rollback"); }
  check("without the original inventory migration it refuses with a clear precondition", err !== null && /inv_start_tracking is missing/.test(err), err);
  await db.exec(`create function inv_start_tracking(a uuid, b uuid, c uuid, d int, e int, f uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;`);
  err = null;
  try { await db.exec(MIG); } catch (e) { err = String(e.message); }
  check("if the expected line is not in the live definition it changes nothing and says so", err !== null && /expected category line was not found/.test(err), err);
}
{
  const code = MIG.replace(/^--.*$/gm, "");
  check("the migration touches no table and no data (static)", !/\b(insert into|update|delete from|alter table|drop|create table)\b/i.test(code));
  check("the migration mentions no other function", (code.match(/inv_\w+/g) || []).every((x) => x === "inv_start_tracking"));
}

console.log(`\nchurchInventoryDb: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
