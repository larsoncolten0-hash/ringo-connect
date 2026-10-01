// Shared in-memory fakes for the Phase 7B-7D tests (trends, entry correction, customer attention). NOT a test file (no `.test.`): it only exports helpers.
// The fake database is READ-ONLY by construction (no insert/update/delete method exists) except where a test installs its own `rpc`. It supports the filters,
// ordering, ranges and column projection the Business Toolkit readers use, so a reader that selects a column it should not shows up as a missing key.
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

export const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const SRC = path.join(REPO, "src");
const require = createRequire(import.meta.url);

export const PROFILE = "22222222-2222-4222-8222-222222222222";
export const OTHER = "99999999-9999-4999-8999-999999999999";
export const USER = "11111111-1111-4111-8111-111111111111";
export const ID = (n) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;

export function makeJiti(tmp, tag) {
  const mk = (name, body) => { const f = path.join(os.tmpdir(), `p7_${tag}_${name}_${process.pid}.cjs`); fs.writeFileSync(f, body); tmp.push(f); return f; };
  const accessStub = mk("access", "module.exports = { resolveBookkeepingOwner: async () => globalThis.__owner };");
  const serverStub = mk("server", "module.exports = { createAdminClient: () => globalThis.__admin };");
  return require("jiti")(import.meta.url, { alias: { "@/lib/bookkeeping/access": accessStub, "@/lib/supabase/server": serverStub, "@": SRC }, interopDefault: true, cache: false });
}

export const splitCols = (sel) => { const out = []; let depth = 0, cur = ""; for (const ch of String(sel)) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };

export function makeDb(tables, log, fail) {
  return { from(table) {
    const q = { f: [], range: null, sort: [], select: "*", limit: null };
    const call = { table, eq: [], select: "", ops: [] };
    log?.push(call);
    const rows = () => {
      let r = (tables[table] || []).filter((row) => q.f.every(([op, c, v]) => {
        const x = row[c];
        if (op === "eq") return x === v;
        if (op === "in") return v.includes(x);
        if (op === "gte") return x !== null && x !== undefined && x >= v;
        if (op === "lte") return x !== null && x !== undefined && x <= v;
        if (op === "lt") return x !== null && x !== undefined && x < v;
        if (op === "is") return (x ?? null) === v;
        if (op === "notnull") return (x ?? null) !== null;
        if (op === "or") return v.some(([col, pat]) => typeof row[col] === "string" && row[col].toLowerCase().includes(pat));
        return true;
      }));
      for (const [c, asc] of [...q.sort].reverse()) r = [...r].sort((a, b) => (String(a[c] ?? "") < String(b[c] ?? "") ? -1 : String(a[c] ?? "") > String(b[c] ?? "") ? 1 : 0) * (asc ? 1 : -1));
      return r;
    };
    const project = (row) => {
      if (q.select === "*") return row;
      const out = {};
      for (const col of splitCols(q.select)) {
        const key = col.includes("(") ? col.slice(0, col.indexOf("(")) : col.includes(":") ? col.slice(0, col.indexOf(":")) : col;
        if (key in row) out[key] = row[key];
      }
      return out;
    };
    const chain = {
      select(s) { q.select = s ?? "*"; call.select = String(s ?? "*"); return chain; },
      eq(c, v) { q.f.push(["eq", c, v]); call.eq.push([c, v]); return chain; },
      in(c, v) { q.f.push(["in", c, v]); call.ops.push(["in", c, v]); return chain; },
      gte(c, v) { q.f.push(["gte", c, v]); return chain; }, lte(c, v) { q.f.push(["lte", c, v]); return chain; }, lt(c, v) { q.f.push(["lt", c, v]); return chain; },
      is(c, v) { q.f.push(["is", c, v]); return chain; },
      or(str) { q.f.push(["or", "", String(str).split(",").map((cl) => { const i = cl.indexOf(".ilike."); return i < 0 ? ["", String.fromCharCode(0)] : [cl.slice(0, i), cl.slice(i + 7).replace(/%/g, "").toLowerCase()]; })]); return chain; },
      not(c, op, v) { if (op === "is" && v === null) q.f.push(["notnull", c, null]); return chain; },
      order(c, o) { q.sort.push([c, o?.ascending !== false]); return chain; },
      limit(n) { q.limit = n; return chain; },
      range(a, b) { q.range = [a, b]; return chain; },
      maybeSingle: async () => ({ data: rows()[0] ? project(rows()[0]) : null, error: null }),
      then(res, rej) {
        if (fail && fail(table, call.select)) return Promise.resolve({ data: null, error: { code: "XX000", message: "boom" } }).then(res, rej);
        let all = rows().map(project);
        if (q.range) all = all.slice(q.range[0], q.range[1] + 1);
        else if (q.limit !== null) all = all.slice(0, q.limit);
        return Promise.resolve({ data: all, error: null }).then(res, rej);
      },
    };
    return chain;
  } };
}
export const makeAdmin = (responses = {}) => { const calls = []; return { calls, rpc: async (name, args) => { calls.push([name, args]); const r = responses[name]; return typeof r === "function" ? r(args) : r ?? { data: null, error: { code: "PGRST202", message: "not found" } }; } }; };

export const earn = (fee, net, extra = {}) => ({ gross_amount: String(fee + net), platform_fee: String(fee), net_amount: String(net), currency: "XAF", status: "recorded", ...extra });
export const entry = (id, kind, amount, date, extra = {}) => ({ id, profile_id: PROFILE, kind, amount: String(amount), currency: "XAF", entry_date: date, category: null, description: null, cash_settled: true, linked_order_type: null, linked_order_id: null, replaces_entry_id: null, voided_at: null, void_reason: null, created_at: `${date}T09:00:00Z`, ...extra });
export const order = (id, status, total, paidAt, e, extra = {}) => ({ id, profile_id: PROFILE, status, total: String(total), currency: "XAF", paid_at: paidAt, order_number: null, commerce_sale_earnings: e, ...extra });

export const RECEIVABLES_EMPTY = { data: { today: "2026-12-10", profile_currency: "XAF", currencies: [] }, error: null };
export const INVENTORY_EMPTY = { data: { profile_currency: "XAF", total: 0, summary: { tracked: 0, out: 0, low: 0, ok: 0, legacy: 0, untracked: 0, estimated_value: "0", value_excluded: 0, drift: 0 }, items: [] }, error: null };

export const mkOwner = (tables, over = {}, log = [], opts = {}) => ({
  userId: USER, profile: { id: PROFILE, currency: opts.currency ?? "XAF" }, supabase: makeDb(tables, log, opts.fail), log,
  admin: makeAdmin({ doc_receivables_summary: RECEIVABLES_EMPTY, inv_overview: INVENTORY_EMPTY, ...over }),
});

export function counters() {
  const c = { pass: 0, fail: 0 };
  const check = (name, cond, detail = "") => { if (cond) c.pass++; else { c.fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
  const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  return { c, check, eq };
}
