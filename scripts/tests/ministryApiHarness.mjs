// Shared harness for the Churches & Ministries Phase 4-8 API tests. NOT a test file.
// Runs the REAL route files (src/app/api/church/** and src/app/api/customer/bible/**), the REAL handlers, validation, error mapping and actor resolution against scratch in-memory PostgreSQL (PGlite)
// that holds the REAL Team migrations, the REAL Phase 2A church migration and the REAL Phase 3-8 migrations. Every request is made as a chosen signed-in user (role `authenticated`, auth.uid() = that
// user) or as an anonymous visitor, so row-level security and the guard triggers decide exactly as they would for that user. Only the session client factory and the two Team helpers
// (active-organization cookie, plan flag) are stubbed. The service-role factory THROWS unless a test installs one on purpose (the customer routes), so any other use fails a test.
// All data is synthetic. No Supabase, no network, no production data.
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import * as F from "./churchFixtures.mjs";

const require = createRequire(import.meta.url);
export const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const SRC = path.join(REPO, "src");

export async function createHarness(dbOpts = {}) {
  const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "church_ministry_stubs_"));
  const serverStub = path.join(stubDir, "server.cjs");
  const accessStub = path.join(stubDir, "teamaccess.cjs");
  const customerStub = path.join(stubDir, "customer.cjs");
  fs.writeFileSync(
    serverStub,
    `module.exports = { createClient: () => globalThis.__churchSession, createAdminClient: () => { if (globalThis.__adminFactory) return globalThis.__adminFactory(); globalThis.__adminClientCalls = (globalThis.__adminClientCalls || 0) + 1; throw new Error("the service-role client must not be used here"); } };`
  );
  fs.writeFileSync(accessStub, `module.exports = { getActiveOrgCookie: () => globalThis.__orgCookie || null, getOrgTeamEnabled: async (id) => globalThis.__teamEnabled(id) };`);
  fs.writeFileSync(
    customerStub,
    `module.exports = { getCustomerFromCookie: async () => globalThis.__customer || null, isSameOrigin: (req) => (globalThis.__sameOrigin === undefined ? true : globalThis.__sameOrigin) };`
  );
  const jiti = require("jiti")(import.meta.url, {
    alias: { "@/lib/supabase/server": serverStub, "@/lib/team/access": accessStub, "@/lib/customer/session": customerStub, "@": SRC },
    interopDefault: true,
    cache: false,
  });
  const routeFile = (rel) => path.join(SRC, "app/api", rel, "route.ts");

  const h = {
    PGlite,
    F,
    jiti,
    db: null,
    stubDir,
    async fresh(extraSql = "") {
      if (h.db) await h.db.close().catch(() => {});
      h.db = await F.newDb(PGlite, dbOpts);
      await F.seed(h.db);
      if (extraSql) await F.svc(h.db, extraSql);
      globalThis.__teamEnabled = async (profileId) => {
        const rows = await F.svcQuery(h.db, `select pl.team_enabled from public.profiles p join public.users us on us.id = p.user_id left join public.plans pl on pl.id = us.plan_id where p.id = '${profileId}'`);
        return !!rows[0]?.team_enabled;
      };
      globalThis.__orgCookie = null;
      globalThis.__adminClientCalls = 0;
      globalThis.__adminFactory = null;
      globalThis.__customer = null;
      return h.db;
    },
    /** Calls a church route as `user` (null = anonymous). `rel` is the folder under src/app/api, e.g. "church/events/[id]". */
    async call(user, method, relWithQuery, { url = "", body, headers, raw, params = {} } = {}) {
      const [rel, inlineQuery] = relWithQuery.split("?");
      if (inlineQuery) url = `?${inlineQuery}${url ? "&" + url.replace(/^\?/, "") : ""}`;
      globalThis.__churchSession = F.sessionFor(h.db, user);
      const mod = jiti(routeFile(rel));
      const hd = { ...(method !== "GET" && method !== "DELETE" ? { "content-type": "application/json" } : {}), ...(headers || {}) };
      const init = { method, headers: hd };
      if (raw !== undefined) init.body = raw;
      else if (body !== undefined) init.body = JSON.stringify(body);
      const res = await mod[method](new Request(`http://test.local/api/${rel}${url}`, init), { params });
      let json = null;
      try {
        json = await res.json();
      } catch {
        /* none */
      }
      return { status: res.status, body: json, headers: res.headers };
    },
    rows: (sql) => F.svcQuery(h.db, sql),
    /** The updated_at an editor would hold right now for a row of `table`. */
    async stamp(table, id) {
      return (await h.rows(`select to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as t from public.${table} where id = '${id}'`))[0].t;
    },
    async close() {
      if (h.db) await h.db.close().catch(() => {});
      fs.rmSync(stubDir, { recursive: true, force: true });
    },
  };
  return h;
}

/** A tiny assertion kit: returns { check, eq, is, summary }. */
export function kit() {
  const st = { pass: 0, fail: 0, section: "" };
  const check = (name, cond, detail = "") => {
    if (cond) st.pass++;
    else {
      st.fail++;
      console.log("  FAIL:", `${st.section}${name}`, "|", String(detail).slice(0, 400));
    }
  };
  const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  const is = (name, res, status, code) => check(name, res.status === status && (code === undefined || res.body?.error === code || (code === "ok" && res.body?.ok === true)), `${res?.status} ${String(JSON.stringify(res?.body)).slice(0, 220)}`);
  const section = (s) => {
    st.section = s;
  };
  const summary = () => {
    console.log(`\n${st.fail === 0 ? "OK" : "FAILED"}: ${st.pass} checks passed, ${st.fail} failed`);
    return st.fail === 0 ? 0 : 1;
  };
  return { check, eq, is, section, summary, st };
}

export const shift = (d, n) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
export const doualaToday = () => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
