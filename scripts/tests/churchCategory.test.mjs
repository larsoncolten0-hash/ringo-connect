// Churches & Ministries, Phase 0: the category foundation only. Offline: no database, no network.
//   Run:  node scripts/tests/churchCategory.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true });
const CAT = jiti(path.join(SRC, "lib/categories.ts"));
const DEC = jiti(path.join(SRC, "lib/bookkeeping/decision.ts"));
const BIZ = jiti(path.join(SRC, "lib/ai/business/categories.ts"));
const KNOW = jiti(path.join(SRC, "lib/ai/knowledge/index.ts"));
const ORDER = jiti(path.join(SRC, "lib/sectionOrder.ts"));
const HEALTH = jiti(path.join(SRC, "lib/profileHealth/criteria.ts"));

const ID = "church_ministries";
const SUBS = ["local_church", "parish", "ministry", "fellowship", "choir", "other"];
const PREVIOUS_16 = [
  "music_entertainment", "business_ecommerce", "restaurant_food", "real_estate", "transport_logistics", "professional_services", "beauty_wellness", "health_medical",
  "education_training", "travel_hospitality", "events_experiences", "creative_media", "freelancers_creators", "construction_home_services", "agriculture_agribusiness", "other",
];

// ------------------------------------------------------------------ 1. registry
{
  const c = CAT.getCategory(ID);
  check("church_ministries is registered", !!c);
  check("English and French names are the approved ones", c?.label.en === "Churches & Ministries" && c?.label.fr === "Églises et ministères", JSON.stringify(c?.label));
  check("examples, WhatsApp message, About placeholder and catalog label are bilingual", [c?.examples, c?.defaults.whatsappMessage, c?.defaults.notePlaceholder, c?.defaults.catalogLabel].every((b) => b?.en && b?.fr));
  check("isCategoryId accepts it and sanitizeCategoryIds keeps it", CAT.isCategoryId(ID) && CAT.sanitizeCategoryIds([ID, "nope"]).join() === ID);
  check("it is purely additive: the other 16 ids are all still present", PREVIOUS_16.every((id) => CAT.CATEGORY_IDS.includes(id)) && CAT.CATEGORY_IDS.length === 17);
  check("it is placed before 'other' (the catch-all stays last)", CAT.CATEGORY_IDS[CAT.CATEGORY_IDS.length - 1] === "other" && CAT.CATEGORY_IDS[CAT.CATEGORY_IDS.length - 2] === ID);
  const subs = c?.defaults.subcategories || [];
  check("sub-types are exactly the approved six, ending with the shared 'other'", subs.map((s) => s.id).join() === SUBS.join(), subs.map((s) => s.id).join());
  check("every sub-type has an emoji and both labels", subs.every((s) => s.emoji && s.label.en && s.label.fr));
  check("sub-types are purely cosmetic (no booking override)", subs.every((s) => !s.booking));
  check("no booking config of its own (falls back to the generic form)", !c?.defaults.booking && CAT.getBookingConfig(ID).buttonLabel.en === CAT.GENERIC_BOOKING_CONFIG.buttonLabel.en);
  // Phase 1 added the church look (see churchPublicPage.test.mjs for its contrast checks); Phase 0 shipped without one.
  check("the recommended theme is a complete ThemeCard value set", !!c?.defaults.recommendedTheme && Object.keys(c.defaults.recommendedTheme).length === 7);
  check("isValidSubcategoryId accepts church sub-types only under the church category", CAT.isValidSubcategoryId(ID, "choir") && !CAT.isValidSubcategoryId("business_ecommerce", "choir") && !CAT.isValidSubcategoryId(ID, "retailer"));
  check("profileHasCategory sees it as primary or extra", CAT.profileHasCategory({ category: ID }, ID) && CAT.profileHasCategory({ category: "other", categories: ["other", ID] }, ID));
  check("it does NOT unlock ticketing (Phase 0 adds no church feature)", !CAT.profileHasTicketing({ category: ID, categories: [ID] }));
}

// ------------------------------------------------------------------ 2. keyed maps and gates
{
  check("Business Toolkit stays OFF for the church category", !DEC.BOOKKEEPING_CATEGORIES.includes(ID) && BIZ.CATEGORY_PROFILES[ID]?.toolkit === false && BIZ.CATEGORY_PROFILES[ID]?.inventory === false);
  check("the AI business registry still agrees with the gate", JSON.stringify(BIZ.registryProblems()) === "[]", JSON.stringify(BIZ.registryProblems()));
  check("inventory stays Business & E-commerce only", JSON.stringify(DEC.INVENTORY_CATEGORIES) === JSON.stringify(["business_ecommerce"]));
  check("public section order (Phase 1): events, catalog, links, about when all have content", ORDER.orderPublicSections({ category: ID, isMusic: false, isRestaurant: false }, { about: true, links: true, catalog: true, events: true }).join() === "events,catalog,links,about");
  check("profile health group is 'other' (no category-specific criteria were invented)", HEALTH.groupOf(ID) === "other");
  const seo = read("src/lib/seo.ts");
  check("SEO treats a church as an Organization", /ORGANIZATION_CATEGORIES = new Set\(\[[^\]]*"church_ministries"/.test(seo));
}

// ------------------------------------------------------------------ 3. Ringo AI knowledge
{
  const m = KNOW.getKnowledgeModule(ID);
  check("a knowledge module exists, loads for church pages, and is marked partial (not live)", !!m && m.status === "partial" && KNOW.getCategoryModules([ID]).some((x) => x.id === ID));
  check("it is not loaded for any other category", PREVIOUS_16.every((id) => !KNOW.getCategoryModules([id]).some((x) => x.id === ID)));
  // Phase 2B/3 supersede the old "no people directory / no daily word" wording: the module now describes People & Groups and Content Studio, and still names the features that do not exist yet.
  check("it describes People & Groups and Content Studio, and says the later-phase features do not exist yet", /does NOT exist yet/.test(m?.body || "") && /Bible programmes \(Dashboard/.test(m?.body || "") && /Content Studio/.test(m?.body || "") && /People: the church's own roster/.test(m?.body || "") && !/member or people directory, leaders and volunteers records/.test(m?.body || ""));
  check("it forbids reading giving, member or pastoral data", /never ask for, read or discuss member lists, individual giving/i.test(m?.body || ""));
  check("the categories module reflects 17 categories", /The 17 Ringo categories/.test(KNOW.getKnowledgeModule("categories").summary));
}

// ------------------------------------------------------------------ 4. the migration covers every constraint
{
  const files = fs.readdirSync(path.join(REPO, "supabase/migrations")).filter((f) => /church_category/.test(f));
  check("exactly one church category migration, named like its siblings (2026-12-26_…)", files.length === 1 && /^2026-12-26_church_category\.sql$/.test(files[0]), files.join());
  const sql = read("supabase/migrations/2026-12-26_church_category.sql");
  const lastBefore = fs.readdirSync(path.join(REPO, "supabase/migrations")).filter((f) => /^\d{4}-\d{2}-\d{2}_/.test(f)).sort().filter((f) => f < "2026-12-26");
  check("it sorts after every earlier migration", lastBefore.length > 100 && lastBefore[lastBefore.length - 1] === "2026-12-25_card_orders.sql");
  for (const [tbl, con] of [["profiles", "profiles_category_check"], ["profiles", "profiles_categories_check"], ["signup_requests", "signup_requests_category_check"], ["signup_requests", "signup_requests_categories_check"], ["profiles", "profiles_subcategory_check"]]) {
    check(`drops and re-adds ${con}`, new RegExp(`alter table public\\.${tbl} drop constraint ${con};`).test(sql) && new RegExp(`alter table public\\.${tbl} add constraint ${con} check`).test(sql));
  }
  check("runs in one transaction with preconditions and postconditions", /^begin;/m.test(sql) && /^commit;/m.test(sql) && /PRECONDITIONS/.test(sql) && /POSTCONDITIONS/.test(sql));
  check("touches nothing but those five constraints (no create/other alter/policy/grant/insert/update/delete)", !/\bcreate (table|function|policy|index|trigger)\b|\bgrant\b|\binsert into\b|\bupdate public\.|\bdelete from\b|\bdrop (table|column|function|policy)\b/i.test(sql.replace(/--[^\n]*/g, "")));
  const body = sql.replace(/--[^\n]*/g, "");
  const catBlock = (name) => {
    const m = body.match(new RegExp(`add constraint ${name} check \\(([\\s\\S]*?)\\n\\);`));
    return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
  };
  for (const name of ["profiles_category_check", "profiles_categories_check", "signup_requests_category_check", "signup_requests_categories_check"]) {
    const ids = catBlock(name);
    check(`${name} lists exactly CATEGORY_IDS from the registry`, ids.length === CAT.CATEGORY_IDS.length && CAT.CATEGORY_IDS.every((id) => ids.includes(id)), ids.join());
  }
  const subIds = new Set(catBlock("profiles_subcategory_check"));
  const registrySubs = new Set(CAT.CATEGORIES.flatMap((c) => (c.defaults.subcategories || []).map((s) => s.id)));
  check("profiles_subcategory_check allows every registry sub-type, and 69 values in all", [...registrySubs].every((s) => subIds.has(s)) && subIds.size === 69, `${subIds.size}`);
  const old = read("supabase/migrations/2026-09-27_category_subcategories.sql").replace(/--[^\n]*/g, "");
  const oldIds = [...old.slice(old.indexOf("subcategory in (")).matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).filter((x) => x !== "profiles_subcategory_check");
  check("the widened sub-type list keeps all 64 old sub-types (additive)", new Set(oldIds).size === 64 && oldIds.every((x) => subIds.has(x)), `${new Set(oldIds).size}`);
  check("support files exist: preflight, verify and rollback", ["preflight", "verify", "rollback"].every((k) => fs.existsSync(path.join(REPO, `supabase/support/2026-12-26_church_category.${k}.sql`))));
  const rb = read("supabase/support/2026-12-26_church_category.rollback.sql").replace(/--[^\n]*/g, "");
  const rbAdds = rb.slice(rb.indexOf("alter table"));
  check("rollback refuses while any row uses a church value", /rollback refused/.test(rb) && /raise exception/.test(rb));
  check("rollback restores the previous 16 category ids and no church id", !/church_ministries|local_church/.test(rbAdds) && PREVIOUS_16.every((id) => rbAdds.includes(`'${id}'`)));
  const vf = read("supabase/support/2026-12-26_church_category.verify.sql");
  check("verify and preflight are single read-only SELECTs (no DDL/DML)", ![vf, read("supabase/support/2026-12-26_church_category.preflight.sql")].some((s) => /\b(alter|drop|insert|update|delete|create|grant)\b/i.test(s.replace(/--[^\n]*/g, "").replace(/'[^']*'/g, "''"))));
}

// ------------------------------------------------------------------ 5. nothing from later phases
{
  const tracked = ["src/app", "src/components", "src/lib"];
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(REPO, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /church/i.test(e.name)) hits.push(p);
    }
  };
  tracked.forEach(walk);
  // Phase 1 added the public page shell (a card component and its pure helpers); there are still no pages, routes or dashboard screens.
  // (matched by file name; the pure helpers live in src/lib/church/publicPage.ts, which the next check lists explicitly)
  // Phase 2B (People & Groups) adds the files named here; anything else church-named is still a failure.
  const ALLOWED = ["src/lib/ai/knowledge/modules/churchMinistries.ts", "src/components/church/ChurchVisitCard.tsx", "src/components/church/people/ChurchShell.tsx", "src/lib/team/churchOwnerOnly.ts", "src/lib/church/publicPage.ts", "src/components/church/ChurchBibleCard.tsx", "src/components/church/ChurchEventsCards.tsx", "src/components/church/ChurchMusicCard.tsx", "src/components/church/store/ChurchStoreEntry.tsx", "src/lib/ai/tools/definitions/churchReport.ts", "src/components/church/ChurchCareCard.tsx", "src/components/church/ChurchTestimoniesCard.tsx"].filter((f) => f !== "src/lib/church/publicPage.ts" || hits.includes(f));
  check("the church folders hold only the files of Phases 1 to 10 (Phase 6 is a single entry screen)", fs.readdirSync(path.join(REPO, "src/lib/church")).sort().join() === "actor.ts,attendance,bible,care,content,errors.ts,handlers.ts,lifecycle,music,permissions.ts,public,publicPage.ts,reports,routeKit.ts,testimonies,validation.ts" && fs.readdirSync(path.join(REPO, "src/components/church")).sort().join() === "ChurchBibleCard.tsx,ChurchCareCard.tsx,ChurchEventsCards.tsx,ChurchMusicCard.tsx,ChurchTestimoniesCard.tsx,ChurchVisitCard.tsx,DailyWordCard.tsx,ShareTestimony.tsx,attendance,bible,care,content,events,lifecycle,music,people,reports,store,testimonies");
  check("the only church-named source files are the AI knowledge module, the public page shell and cards (Phases 1, 4, 5, 8, 9 and Testimonies), the workspace files (Phases 2B and 6) and the Ringo AI church report tool (Phase 10)", hits.length === ALLOWED.length && ALLOWED.every((a) => hits.includes(a)), hits.join());
  // Phase 0 itself creates no table; the only church_* tables are the four people/group tables of Phase 2A (2026-12-27_church_people_groups.sql), created by nothing else.
  const migFiles = fs.readdirSync(path.join(REPO, "supabase/migrations"));
  check("the category migration creates no table, and the only migration creating church_* tables is the Phase 2A people-and-groups one", !/create table/i.test(read("supabase/migrations/2026-12-26_church_category.sql").replace(/--[^\n]*/g, ""))
    && migFiles.filter((f) => /create table(?: if not exists)?\s+(?:public\.)?church_/i.test(read(`supabase/migrations/${f}`))).join() === "2026-12-27_church_people_groups.sql");
}

// ------------------------------------------------------------------ 6. EXECUTED against a disposable in-memory PostgreSQL (PGlite). Nothing here touches any real database.
// The schema is built from the repository's ORIGINAL migrations (2026-09-12 categories, 2026-09-27 sub-categories) on minimal profiles / signup_requests tables, so the
// constraints under test are the real pre-church ones. LIMITS (PGlite is PostgreSQL compiled to WASM, single user, no Supabase roles): it proves the constraint logic, the
// DO-block preconditions/postconditions, atomicity and the SQL support files' syntax and results; it does not prove Supabase-specific behaviour (roles, grants, the SQL editor's
// own transaction handling, lock contention on a busy production table). Fails closed when PGlite is missing; SKIP_SQL=1 skips these checks explicitly and says so.
{
  let PGlite = null;
  try { ({ PGlite } = require("@electric-sql/pglite")); } catch { /* handled below */ }
  if (!PGlite) {
    if (process.env.SKIP_SQL === "1") console.log("SKIPPED (SKIP_SQL=1): the executed-SQL checks of the church migration were NOT run.");
    else check("executed SQL: PGlite is installed (npm install --no-save @electric-sql/pglite, or set SKIP_SQL=1 to skip explicitly)", false);
  } else {
    const MIG = read("supabase/migrations/2026-12-26_church_category.sql");
    const PRE = read("supabase/support/2026-12-26_church_category.preflight.sql");
    const VER = read("supabase/support/2026-12-26_church_category.verify.sql");
    const ROLL = read("supabase/support/2026-12-26_church_category.rollback.sql");
    const CONS = ["profiles_category_check", "profiles_categories_check", "signup_requests_category_check", "signup_requests_categories_check", "profiles_subcategory_check"];
    const OLD_CATS = PREVIOUS_16;
    const sub0912 = read("supabase/migrations/2026-09-12_business_categories.sql");
    const old0927 = read("supabase/migrations/2026-09-27_category_subcategories.sql");
    const old0927Code = old0927.replace(/--[^\n]*/g, "");
    const OLD_SUBS = [...new Set([...old0927Code.slice(old0927Code.indexOf("subcategory in (")).matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))];
    const NEW_SUBS = ["local_church", "parish", "ministry", "fellowship", "choir"];
    check("executed SQL: the original sub-category migration lists exactly 64 old values (the number this test protects)", OLD_SUBS.length === 64, String(OLD_SUBS.length));
    check("executed SQL: the original category migration lists exactly 16 old values", OLD_CATS.length === 16);

    const newDb = async () => {
      const db = new PGlite();
      await db.exec("create table profiles (id uuid primary key default gen_random_uuid(), username text unique);");
      await db.exec("create table signup_requests (id uuid primary key default gen_random_uuid());");
      await db.exec(sub0912);
      await db.exec(old0927);
      return db;
    };
    // run a script like the SQL editor would: an error aborts it and the open transaction is rolled back
    const run = async (db, sql) => {
      try { await db.exec(sql); return null; } catch (e) { await db.exec("rollback").catch(() => {}); return String(e.message || e); }
    };
    const lits = (d) => (d.match(/'[a-z_]+'/g) || []).length;
    const counts = async (db) => Object.fromEntries((await db.query("select conname, pg_get_constraintdef(oid) d from pg_constraint where conname = any($1)", [CONS])).rows.map((r) => [r.conname, lits(r.d)]));
    const sig = async (db) => JSON.stringify((await db.query("select conname, pg_get_constraintdef(oid) d, convalidated v from pg_constraint where conname = any($1) order by 1", [CONS])).rows);
    let seq = 0;
    const accepts = async (db, sql) => (await run(db, sql)) === null;
    const insProfile = (cols, vals) => `insert into profiles (username, ${cols}) values ('u${++seq}', ${vals})`;
    const rows = async (db, sql) => (await db.query(sql)).rows;
    const selectOnly = (sql) => sql.replace(/--[^\n]*/g, "").trim().replace(/;\s*$/, "");
    const allOk = (rs) => rs.length > 0 && rs.every((r) => r.ok === true);

    // ---- A. fresh database: the migration applies, counts and behaviour
    {
      const db = await newDb();
      const before = await counts(db);
      check("SQL A0: before the migration the real constraints list 16/16/16/16 categories and 64 sub-types", before.profiles_category_check === 16 && before.profiles_categories_check === 16 && before.signup_requests_category_check === 16 && before.signup_requests_categories_check === 16 && before.profiles_subcategory_check === 64, JSON.stringify(before));
      check("SQL A0: before the migration a church category is rejected (so the migration has something to fix)", !(await accepts(db, insProfile("category", "'church_ministries'"))));
      // rows that exist before must survive untouched
      await db.exec("insert into profiles (username, category, categories, subcategory) values ('keep1','music_entertainment','{music_entertainment,other}','other'), ('keep2','agriculture_agribusiness','{agriculture_agribusiness}','farmer')");
      await db.exec("insert into signup_requests (category, categories) values ('restaurant_food','{restaurant_food}')");
      const err = await run(db, MIG);
      check("SQL A1: the migration applies cleanly to the original schema", err === null, err);
      const after = await counts(db);
      check("SQL A2: afterwards the constraints list 17/17/17/17 categories and 69 sub-types", after.profiles_category_check === 17 && after.profiles_categories_check === 17 && after.signup_requests_category_check === 17 && after.signup_requests_categories_check === 17 && after.profiles_subcategory_check === 69, JSON.stringify(after));
      check("SQL A3: all five constraints exist and are validated", (await db.query("select count(*)::int n from pg_constraint where conname = any($1) and convalidated", [CONS])).rows[0].n === 5);
      check("SQL A4: rows that existed before are all still there, unchanged", (await rows(db, "select count(*)::int n from profiles where (username='keep1' and category='music_entertainment' and subcategory='other') or (username='keep2' and subcategory='farmer')"))[0].n === 2 && (await rows(db, "select count(*)::int n from signup_requests where category='restaurant_food'"))[0].n === 1);

      let bad = [];
      for (const c of OLD_CATS) {
        if (!(await accepts(db, insProfile("category", `'${c}'`)))) bad.push(`profiles.category ${c}`);
        if (!(await accepts(db, insProfile("categories", `'{${c}}'`)))) bad.push(`profiles.categories ${c}`);
        if (!(await accepts(db, `insert into signup_requests (category, categories) values ('${c}', '{${c}}')`))) bad.push(`signup_requests ${c}`);
      }
      check("SQL A5: all 16 old category values are still accepted in all four category constraints", bad.length === 0, bad.join(", "));
      bad = [];
      for (const s of OLD_SUBS) if (!(await accepts(db, insProfile("subcategory", `'${s}'`)))) bad.push(s);
      check("SQL A6: all 64 old sub-category values are still accepted", bad.length === 0, bad.join(", "));
      bad = [];
      for (const s of NEW_SUBS) if (!(await accepts(db, insProfile("category, subcategory", `'church_ministries', '${s}'`)))) bad.push(s);
      check("SQL A7: the five new church sub-categories are accepted", bad.length === 0, bad.join(", "));
      bad = [];
      if (!(await accepts(db, insProfile("category, categories", "'church_ministries', '{church_ministries,other}'")))) bad.push("profiles");
      if (!(await accepts(db, "insert into signup_requests (category, categories) values ('church_ministries', '{church_ministries,music_entertainment}')"))) bad.push("signup_requests");
      check("SQL A8: the church category is accepted as primary and as an extra category, on profiles and signup_requests", bad.length === 0, bad.join(", "));
      bad = [];
      if (await accepts(db, insProfile("category", "'not_a_category'"))) bad.push("profiles.category");
      if (await accepts(db, insProfile("categories", "'{church_ministries,not_a_category}'"))) bad.push("profiles.categories");
      if (await accepts(db, "insert into signup_requests (category) values ('not_a_category')")) bad.push("signup_requests.category");
      if (await accepts(db, "insert into signup_requests (categories) values ('{not_a_category}')")) bad.push("signup_requests.categories");
      if (await accepts(db, insProfile("subcategory", "'not_a_subcategory'"))) bad.push("profiles.subcategory");
      if (await accepts(db, insProfile("subcategory", "'churchx'"))) bad.push("profiles.subcategory near-miss");
      check("SQL A9: bogus values are still rejected by all five constraints", bad.length === 0, `wrongly accepted: ${bad.join(", ")}`);
      check("SQL A10: a null category and null sub-category remain valid", await accepts(db, insProfile("category, subcategory", "null, null")));

      // ---- B. repeat run
      const state = await sig(db);
      const again = await run(db, MIG);
      check("SQL B1: a second run is refused by the precondition ('already allows the church values')", !!again && /already allows the church values/.test(again), String(again));
      check("SQL B2: the refused second run changed nothing", (await sig(db)) === state);

      // ---- C. the support files on the migrated state
      const vr = await rows(db, selectOnly(VER));
      check("SQL C1: verify.sql runs and every row is ok after the migration", allOk(vr) && vr.length === 10, JSON.stringify(vr.filter((r) => r.ok !== true)));
      const pr = await rows(db, selectOnly(PRE));
      check("SQL C2: preflight.sql runs and is NOT all-ok after the migration (it cannot be mistaken for a pre-state pass)", pr.length === 8 ? !allOk(pr) : false, `rows=${pr.length}`);

      // ---- D. rollback
      const rbErr = await run(db, ROLL);
      check("SQL D1: with church rows present the rollback is refused and says why", !!rbErr && /rollback refused/.test(rbErr), String(rbErr));
      check("SQL D2: the refused rollback changed nothing", (await sig(db)) === state);
      await db.exec("delete from profiles where category = 'church_ministries' or 'church_ministries' = any(categories) or subcategory in ('local_church','parish','ministry','fellowship','choir')");
      await db.exec("delete from signup_requests where category = 'church_ministries' or 'church_ministries' = any(categories)");
      const rb2 = await run(db, ROLL);
      check("SQL D3: with no church rows the rollback runs", rb2 === null, String(rb2));
      const rc = await counts(db);
      check("SQL D4: after the rollback the constraints are back to 16/16/16/16 and 64", rc.profiles_category_check === 16 && rc.profiles_categories_check === 16 && rc.signup_requests_category_check === 16 && rc.signup_requests_categories_check === 16 && rc.profiles_subcategory_check === 64, JSON.stringify(rc));
      check("SQL D5: after the rollback church values are rejected again and old values still accepted", !(await accepts(db, insProfile("category", "'church_ministries'"))) && !(await accepts(db, insProfile("subcategory", "'choir'"))) && (await accepts(db, insProfile("category, subcategory", "'agriculture_agribusiness', 'farmer'"))));
      const pr2 = await rows(db, selectOnly(PRE));
      check("SQL D6: preflight.sql is all-ok again on the rolled-back state (it is a true pre-state check)", pr2.length === 8 && allOk(pr2), JSON.stringify(pr2.filter((r) => r.ok !== true)));
      const vr2 = await rows(db, selectOnly(VER));
      check("SQL D7: verify.sql is NOT all-ok on the rolled-back state", !allOk(vr2));
      const rb3 = await run(db, ROLL);
      check("SQL D8: running the rollback twice is harmless", rb3 === null && JSON.stringify(await counts(db)) === JSON.stringify(rc));
      const re = await run(db, MIG);
      check("SQL D9: the migration can be applied again after a rollback", re === null, String(re));
      check("SQL D10: and the result is identical to the first application", (await sig(db)) === state);
    }

    // ---- E. preflight on the true pre-state, and an unmigrated database seen by verify
    {
      const db = await newDb();
      const pr = await rows(db, selectOnly(PRE));
      check("SQL E1: preflight.sql is all-ok (8 rows) on a fresh original schema", pr.length === 8 && allOk(pr), JSON.stringify(pr.filter((r) => r.ok !== true)));
      check("SQL E2: verify.sql is NOT all-ok before the migration", !allOk(await rows(db, selectOnly(VER))));
    }

    // ---- F. drifted / unexpected live state stops at the preconditions with nothing changed
    {
      const cases = [
        ["a category constraint is missing an id", "alter table profiles drop constraint profiles_category_check; alter table profiles add constraint profiles_category_check check (category is null or category in ('music_entertainment','other'));", /profiles_category_check lists 2 values/],
        ["a category constraint has an extra id", "alter table signup_requests drop constraint signup_requests_category_check; alter table signup_requests add constraint signup_requests_category_check check (category is null or category in ('music_entertainment','business_ecommerce','restaurant_food','real_estate','transport_logistics','professional_services','beauty_wellness','health_medical','education_training','travel_hospitality','events_experiences','creative_media','freelancers_creators','construction_home_services','agriculture_agribusiness','other','surprise_id'));", /signup_requests_category_check lists 17 values/],
        ["the sub-category constraint is missing an id", "alter table profiles drop constraint profiles_subcategory_check; alter table profiles add constraint profiles_subcategory_check check (subcategory is null or subcategory in ('farmer','other'));", /profiles_subcategory_check lists 2 values/],
        ["a constraint is missing altogether", "alter table profiles drop constraint profiles_categories_check;", /constraint profiles\.profiles_categories_check not found/],
        ["a column is missing", "alter table profiles drop column subcategory cascade;", /expected profiles\.category\/categories\/subcategory/],
      ];
      for (const [label, ddl, expect] of cases) {
        const db = await newDb();
        await db.exec(ddl);
        const s0 = await sig(db);
        const err = await run(db, MIG);
        check(`SQL F: ${label} -> refused by a precondition`, !!err && expect.test(err), String(err));
        check(`SQL F: ${label} -> nothing was changed`, (await sig(db)) === s0);
      }
      const db = await newDb();
      await db.exec("drop table signup_requests cascade;");
      const err = await run(db, MIG);
      check("SQL F: a missing table -> refused by a precondition", !!err && /public.profiles or public.signup_requests is missing/.test(err), String(err));
    }

    // ---- G. the postconditions really catch a bad result, and the whole file is atomic when they do
    {
      const mutate = (name, from, to) => {
        const i = MIG.indexOf(`add constraint ${name} check`);
        const j = MIG.indexOf(`'${from}'`, i);
        if (i < 0 || j < 0) throw new Error(`cannot mutate ${name}/${from}`);
        return MIG.slice(0, j) + `'${to}'` + MIG.slice(j + from.length + 2);
      };
      const removeLiteral = (name, val) => {
        const i = MIG.indexOf(`add constraint ${name} check`);
        const j = MIG.indexOf(`'${val}',`, i);
        if (i < 0 || j < 0) throw new Error(`cannot remove ${name}/${val}`);
        return MIG.slice(0, j) + MIG.slice(j + val.length + 3);
      };
      const cases = [
        ["profiles_category_check silently loses 'real_estate' (count unchanged)", mutate("profiles_category_check", "real_estate", "real_estatx"), /profiles_category_check lost existing value\(s\): real_estate/],
        ["signup_requests_categories_check silently loses 'music_entertainment'", mutate("signup_requests_categories_check", "music_entertainment", "music_entertainmenx"), /signup_requests_categories_check lost existing value\(s\): music_entertainment/],
        ["profiles_subcategory_check silently loses 'farmer' (count unchanged)", mutate("profiles_subcategory_check", "farmer", "farmerx"), /profiles_subcategory_check lost existing value\(s\): farmer/],
        ["profiles_subcategory_check silently loses 'painter' (count unchanged)", mutate("profiles_subcategory_check", "painter", "paintex"), /profiles_subcategory_check lost existing value\(s\): painter/],
        ["profiles_subcategory_check forgets the new 'local_church'", mutate("profiles_subcategory_check", "local_church", "local_churcx"), /profiles_subcategory_check does not allow local_church/],
        ["profiles_category_check forgets the new 'church_ministries'", mutate("profiles_category_check", "church_ministries", "church_ministrix"), /profiles_category_check does not allow church_ministries/],
        ["profiles_subcategory_check forgets one old value (count 68, not 69)", removeLiteral("profiles_subcategory_check", "painter"), /profiles_subcategory_check lists 68 values, expected 69/],
      ];
      for (const [label, sql, expect] of cases) {
        const db = await newDb();
        const s0 = await sig(db);
        const err = await run(db, sql);
        check(`SQL G: ${label} -> the postcondition aborts the file`, !!err && expect.test(err), String(err));
        check(`SQL G: ${label} -> all five constraints are exactly as before (atomic)`, (await sig(db)) === s0);
      }
    }

    // ---- H. regression guard for the production failure of 2026-10-22 ('profiles_subcategory_check lost an existing id')
    {
      const db = await newDb();
      const err = await run(db, MIG);
      check("SQL H1: the sub-category constraint is no longer mistaken for a category constraint (the production failure)", err === null && !/lost an existing id/.test(String(err)), String(err));
      const code = MIG.replace(/--[^\n]*/g, "");
      check("SQL H2: no constraint is selected by a LIKE pattern on its NAME", !/conname\s+(not\s+)?like/i.test(code));
      check("SQL H3: the postcondition checks every old value of each constraint by an explicit kind", /c_old_categories constant text\[\]/.test(code) && /c_old_subcategories constant text\[\]/.test(code) && /case when r\.kind = 'subcategory'/.test(code));
      const grab = (name) => [...code.slice(code.indexOf(`${name} constant text[] := array[`), code.indexOf("];", code.indexOf(`${name} constant text[] := array[`))).matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
      check("SQL H4: the postcondition's old-category list equals the 16 original ids", JSON.stringify(grab("c_old_categories").sort()) === JSON.stringify([...OLD_CATS].sort()));
      check("SQL H5: the postcondition's old-sub-category list equals the 64 original ids", JSON.stringify(grab("c_old_subcategories").sort()) === JSON.stringify([...OLD_SUBS].sort()));
    }
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} church category checks passed`);
if (failed.length) process.exit(1);
