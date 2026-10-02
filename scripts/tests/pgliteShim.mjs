// Shared PGlite stand-ins for the SQL-backed tests (NOT a test file): a small PostgREST-style translator over PGlite that runs each query as a given
// Postgres role, plus a helper that builds the reduced Supabase-shaped schema the repository's Business Toolkit migrations expect.
// Nothing here connects to Supabase or any real database.
export const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
// ------------------------------------------------------------------------ a tiny PostgREST-style translator over PGlite (run as a given role)
export const splitCols = (sel) => { const out = []; let depth = 0, cur = ""; for (const ch of String(sel)) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
export const lit = (v) => (v === null || v === undefined ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : typeof v === "object" ? `${q(JSON.stringify(v))}::jsonb` : q(v));
export const makeClientFactory = (db) => {
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`); }
};
const dbErr = (e) => ({ code: e.code, message: String(e.message).split("\n")[0] });
// PGlite serialises queries, but the role switch + query + reset below is several statements: run them one at a time so concurrent callers cannot interleave.
let chainTail = Promise.resolve();
const serial = (fn) => { const next = chainTail.then(fn, fn); chainTail = next.then(() => undefined, () => undefined); return next; };
function client(role, subOf) {
  const run = (sql) => serial(() => as(role, subOf(), sql));
  return {
    from(table) {
      const st = { cols: "*", where: [], order: [], limit: null, offset: 0, mode: "select", values: null, head: false };
      const colSql = () => st.cols === "*" ? "*" : splitCols(st.cols).map((c) => {
        const m = /^plans\(([^)]*)\)$/.exec(c);
        if (m) return `(select to_json(x) from (select ${m[1]} from public.plans where plans.id = "${table}".plan_id) x) as plans`;
        if (c.includes("(")) return `'[]'::json as "${c.slice(0, c.indexOf("("))}"`;
        return `"${c}"`;
      }).join(", ");
      const whereSql = () => (st.where.length ? ` where ${st.where.join(" and ")}` : "");
      const sql = () => {
        if (st.mode === "insert") {
          const keys = Object.keys(st.values);
          return `with r as (insert into public."${table}" (${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map((k) => lit(st.values[k])).join(",")}) returning *) select coalesce(json_agg(x), '[]'::json) as j from (select ${colSql()} from r) x`;
        }
        if (st.mode === "update") {
          const set = Object.entries(st.values).map(([k, v]) => `"${k}" = ${lit(v)}`).join(", ");
          return `with r as (update public."${table}" set ${set}${whereSql()} returning *) select coalesce(json_agg(x), '[]'::json) as j from (select ${colSql()} from r) x`;
        }
        if (st.head) return `select '[]'::json as j, (select count(*)::int from public."${table}"${whereSql()}) as n`;
        const o = st.order.length ? ` order by ${st.order.join(", ")}` : "";
        const l = st.limit !== null ? ` limit ${st.limit} offset ${st.offset}` : "";
        return `select coalesce(json_agg(r), '[]'::json) as j from (select ${colSql()} from public."${table}"${whereSql()}${o}${l}) r`;
      };
      const exec1 = async () => { try { const r = (await run(sql())).rows[0]; return { data: r.j, count: r.n ?? null, error: null }; } catch (e) { return { data: null, count: null, error: dbErr(e) }; } };
      const chain = {
        select(c, opts) { if (st.mode === "select" || c !== undefined) st.cols = c ?? "*"; if (opts?.head) st.head = true; return chain; },
        insert(v) { st.mode = "insert"; st.values = v; return chain; },
        update(v) { st.mode = "update"; st.values = v; return chain; },
        eq(c, v) { st.where.push(`"${c}" = ${lit(v)}`); return chain; },
        in(c, v) { st.where.push(`"${c}" in (${v.map(lit).join(",")})`); return chain; },
        is(c, v) { st.where.push(`"${c}" is ${v === null ? "null" : lit(v)}`); return chain; },
        not(c, op, v) { st.where.push(`"${c}" is not ${v === null ? "null" : lit(v)}`); return chain; },
        gte(c, v) { st.where.push(`"${c}" >= ${lit(v)}`); return chain; },
        lte(c, v) { st.where.push(`"${c}" <= ${lit(v)}`); return chain; },
        lt(c, v) { st.where.push(`"${c}" < ${lit(v)}`); return chain; },
        gt(c, v) { st.where.push(`"${c}" > ${lit(v)}`); return chain; },
        neq(c, v) { st.where.push(`"${c}" <> ${lit(v)}`); return chain; },
        or(str) { st.where.push("(" + String(str).split(",").map((cl) => { const i = cl.indexOf(".ilike."); return i < 0 ? "false" : `"${cl.slice(0, i)}" ilike ${q(cl.slice(i + 7))}`; }).join(" or ") + ")"); return chain; },
        order(c, o) { st.order.push(`"${c}" ${o?.ascending === false ? "desc" : "asc"}`); return chain; },
        limit(n) { st.limit = n; return chain; },
        range(a, b) { st.limit = b - a + 1; st.offset = a; return chain; },
        async maybeSingle() { const r = await exec1(); if (r.error) return r; return r.data.length > 1 ? { data: null, error: { message: "multiple rows" } } : { data: r.data[0] ?? null, error: null }; },
        async single() { const r = await exec1(); if (r.error) return r; return r.data.length === 1 ? { data: r.data[0], error: null } : { data: null, error: { message: "expected one row" } }; },
        then(res, rej) { return exec1().then((r) => ({ data: r.data, count: r.count, error: r.error }), rej).then(res, rej); },
      };
      return chain;
    },
    rpc: async (name, args) => {
      const list = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
      try {
        const r = await run(`select * from ${name}(${list})`);
        const cols = r.fields.map((f) => f.name);
        return { data: cols.length === 1 && cols[0] === name ? r.rows[0]?.[name] ?? null : r.rows, error: null };
      } catch (e) { return { data: null, error: dbErr(e) }; }
    },
  };
}
return client;
};
