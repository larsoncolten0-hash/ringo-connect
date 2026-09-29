// Ambassador Program — database-enforced notification de-duplication (claim-first).
// No network, no database. The SQL claim function is a JavaScript stand-in that
// models its one essential property (a primary key that admits a single winner
// per key); the migration TEXT is checked statically. The SQL itself has NOT been
// executed. This proves the application only sends when it wins the claim — it
// does not, and the code does not claim to, provide exactly-once delivery.
//
//   Run:  node scripts/tests/ambassadorNotificationClaim.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const load = (p) => jiti(path.join(REPO, "src", p));
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const quiet = async (fn) => {
  const o = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = o;
  }
};

// ------------------------------------------------------------------ fake admin
function makeAdmin({ claimMode = "pk", ledger = [] } = {}) {
  const claimed = new Set(); // models the primary key on dedupe_key
  const order = []; // records claim/send ordering
  const bell = [];
  const tables = {
    ambassador_commission_ledger: ledger,
    notifications: bell,
  };
  const from = (table) => {
    const filters = [];
    const b = {
      select: () => b,
      limit: () => b,
      eq(k, v) {
        filters.push((r) => r[k] === v);
        return b;
      },
      then(res, rej) {
        return Promise.resolve({ data: (tables[table] || []).filter((r) => filters.every((f) => f(r))), error: null }).then(res, rej);
      },
    };
    return b;
  };
  const admin = {
    _claimed: claimed,
    _order: order,
    _bell: bell,
    from,
    rpc: async (name, args) => {
      if (name !== "ambassador_claim_notification") return { data: { ok: true }, error: null };
      order.push(`claim:${args.p_dedupe_key}`);
      if (claimMode === "error") return { data: null, error: { message: "function does not exist" } };
      if (claimMode === "garbage") return { data: { ok: true }, error: null }; // no boolean `claimed`
      const won = !claimed.has(args.p_dedupe_key); // synchronous check-and-insert == the atomic primary key
      claimed.add(args.p_dedupe_key);
      return { data: { ok: true, claimed: won }, error: null };
    },
  };
  return admin;
}

// ------------------------------------------------------------------ mock the existing sender
const withBell = load("lib/push/withBell.ts");
let sends = [];
let senderThrows = false;
let currentAdmin = null;
withBell.sendPushAndBellToUser = async (admin, userId, payload) => {
  admin._order.push(`send:${userId}:${payload.category}`);
  if (senderThrows) throw new Error("push service down");
  sends.push({ userId, ...payload });
  admin._bell.push({ user_id: userId, type: payload.category, link: payload.url });
};
withBell.sendPushAndBellToAdmins = async () => {};
const n = load("lib/ambassador/notifications.ts");

const ledger = [
  { id: "l1", sale_id: "sale1", milestone: "sale_registration", entry_type: "commission", recipient_type: "ambassador", recipient_user_id: "uAmb", commission_amount: 3750, currency: "XAF" },
  { id: "l2", sale_id: "sale1", milestone: "sale_registration", entry_type: "commission", recipient_type: "team_leader", recipient_user_id: "uTl", commission_amount: 1250, currency: "XAF" },
];
const reset = () => {
  sends = [];
  senderThrows = false;
};

// ================================================================== claim-first
{
  reset();
  const a = makeAdmin({ ledger });
  await n.notifyMilestoneEarned(a, "sale1", "sale_registration");
  const seq = a._order;
  check("claim-first: for each recipient the claim is made BEFORE the send", seq.length === 4 && seq[0].startsWith("claim:") && seq[1].startsWith("send:") && seq[2].startsWith("claim:") && seq[3].startsWith("send:"), seq.join(" > "));
  check("claim-first: both recipients (Ambassador and Team Leader) got exactly one notification", sends.length === 2 && sends.some((s) => s.userId === "uAmb") && sends.some((s) => s.userId === "uTl"));
  const keys = [...a._claimed];
  check("claim-first: keys separate role, recipient, category and event", keys.every((k) => /^(ambassador|team_leader):u(Amb|Tl):ambassador_registration_completed:sale_registration-l[12]$/.test(k)), keys.join());
}

// ================================================================== duplicate / concurrent callers
{
  reset();
  const a = makeAdmin({ ledger });
  await n.notifyMilestoneEarned(a, "sale1", "sale_registration");
  await n.notifyMilestoneEarned(a, "sale1", "sale_registration");
  await n.notifyMilestoneEarned(a, "sale1", "sale_registration");
  check("dedupe: repeated evaluations of the same event never send a second copy", sends.length === 2);

  reset();
  const b = makeAdmin({ ledger });
  await Promise.all(Array.from({ length: 12 }, () => n.notifyMilestoneEarned(b, "sale1", "sale_registration")));
  check("concurrency: twelve simultaneous callers for the same event produce exactly one send per recipient", sends.length === 2, `sends=${sends.length}`);

  reset();
  const c = makeAdmin({ ledger: [...ledger, { ...ledger[0], id: "l3", milestone: "activation" }, { ...ledger[1], id: "l4", milestone: "activation" }] });
  await Promise.all([n.notifyMilestoneEarned(c, "sale1", "sale_registration"), n.notifyMilestoneEarned(c, "sale1", "activation")]);
  check("dedupe: a DIFFERENT milestone/event on the same sale is still delivered (keys are per event)", sends.length === 4 && sends.filter((s) => s.category === "ambassador_activation_completed").length === 2);

  reset();
  const d = makeAdmin({ ledger: [{ ...ledger[0], recipient_type: "ambassador" }, { ...ledger[0], id: "l9", recipient_type: "team_leader" }] });
  await n.notifyMilestoneEarned(d, "sale1", "sale_registration");
  check("dedupe: one person holding BOTH roles is notified once per role, not once in total", sends.length === 2 && sends.filter((s) => s.url.startsWith("/dashboard/ambassador#")).length === 1 && sends.filter((s) => s.url.startsWith("/dashboard/sales-team#")).length === 1);

  reset();
  const e = makeAdmin();
  await Promise.all([n.notifyPayoutDestinationChanged(e, "uAmb", "ambassador", "2026-06-02T12:00:00Z"), n.notifyPayoutDestinationChanged(e, "uAmb", "ambassador", "2026-06-02T12:00:00Z"), n.notifyPayoutDestinationChanged(e, "uAmb", "ambassador", "2026-06-05T09:00:00Z")]);
  check("dedupe: the same destination change notifies once; a later, different change notifies again", sends.length === 2);
}

// ================================================================== send failure: at-most-once, never throws
{
  reset();
  senderThrows = true;
  const a = makeAdmin({ ledger });
  let threw = false;
  await quiet(async () => {
    try {
      await n.notifyMilestoneEarned(a, "sale1", "sale_registration");
    } catch {
      threw = true;
    }
  });
  check("failure: a failing sender never throws out of the notifier", !threw);
  senderThrows = false;
  await n.notifyMilestoneEarned(a, "sale1", "sale_registration");
  check("failure: a CLAIMED event whose send failed is not re-sent (at-most-once, by design — no duplicate money message)", sends.length === 0);
}

// ================================================================== degraded mode (claim function unavailable)
for (const mode of ["error", "garbage"]) {
  reset();
  const a = makeAdmin({ claimMode: mode, ledger });
  await quiet(() => n.notifyMilestoneEarned(a, "sale1", "sale_registration"));
  await quiet(() => n.notifyMilestoneEarned(a, "sale1", "sale_registration"));
  check(`degraded (${mode}): notifications still flow, and the legacy bell-row check still stops sequential repeats`, sends.length === 2);
}

// ================================================================== no second notification system + honest wording
{
  const src = strip(read("src/lib/ambassador/notifications.ts"));
  check("reuse: delivery still goes through the existing sendPushAndBellToUser and nothing else", /sendPushAndBellToUser\(admin, d\.userId/.test(src) && !/web-push|webpush|push_subscriptions|from\("notifications"\)\s*\.insert/.test(src));
  check("claim-first: the send is unreachable except after a claim decision (no send before claimNotification in deliver)", (() => { const body = src.slice(src.indexOf("async function deliver")); return body.indexOf("claimNotification(") > 0 && body.indexOf("claimNotification(") < body.indexOf("sendPushAndBellToUser("); })());
  const header = read("src/lib/ambassador/notifications.ts");
  check("honesty: the code documents that this is NOT exactly-once delivery", /NOT an exactly-once DELIVERY\s+\/\/\s*guarantee/.test(header) || /NOT an exactly-once DELIVERY/.test(header));
}

// ================================================================== the migration (static)
{
  const m = read("supabase/migrations/2026-11-27_ambassador_notification_dedup.sql");
  const sql = m.replace(/--.*$/gm, "");
  check("sql 27: a primary key on dedupe_key is what makes a claim single-winner", /dedupe_key text primary key/.test(sql));
  check("sql 27: the claim inserts with ON CONFLICT DO NOTHING and reports whether THIS call inserted", /on conflict \(dedupe_key\) do nothing\s+returning dedupe_key into v_claimed/.test(sql) && /'claimed', v_claimed is not null/.test(sql));
  check("sql 27: service-role only — RLS on with no policy, table and function privileges revoked, function granted to service_role", /enable row level security/.test(sql) && !/create policy/.test(sql) && /revoke all on table public\.ambassador_notification_events from anon/.test(sql) && /revoke all on table public\.ambassador_notification_events from authenticated/.test(sql) && /revoke all on function public\.ambassador_claim_notification\(uuid, text, text\) from public/.test(sql) && /grant execute on function public\.ambassador_claim_notification\(uuid, text, text\) to service_role/.test(sql));
  check("sql 27: additive only — creates one table and one function, alters nothing that exists (not the notifications table)", (sql.match(/create table/gi) || []).length === 1 && (sql.match(/create or replace function/gi) || []).length === 1 && !/alter table (public\.)?notifications/i.test(sql) && !/drop |delete from|update /i.test(sql) && /set search_path = public/.test(sql));
  check("sql 27: the migration does not promise exactly-once delivery", /NOT an exactly-once delivery guarantee/.test(m));
}

const failed = results.filter((x) => !x.pass);
console.log(`\nambassadorNotificationClaim: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
