// Unit checks for Ringo AI Content Calendar (src/lib/ai/calendar/**, the create_content_calendar
// / update_content_calendar_item tools, publish.ts). No network, no real database, no real API
// key — jiti-loading + a fake Supabase client, same conventions as the rest of this suite.
//
//   Run:  node scripts/tests/ringo_ai_calendar_unit.test.mjs
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const load = (p) => jiti(path.join(REPO, "src", p));

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

// ------------------------------------------------------------------ fake database
// A minimal in-memory fake for content_calendar_plans/items + community_announcements/profiles,
// enough to exercise store.ts/publish.ts's real query shapes (eq-chains, insert, update, delete,
// select).
const WS = { userId: "11111111-1111-1111-1111-111111111111", profileId: "22222222-2222-2222-2222-222222222222", username: "demo", actor: { kind: "owner" } };
const OTHER_WS = { userId: "99999999-9999-9999-9999-999999999999", profileId: "88888888-8888-8888-8888-888888888888" };

let db;
const resetDb = () => {
  db = { plans: new Map(), items: new Map(), announcements: new Map(), profiles: new Map([[WS.profileId, { id: WS.profileId, username: "demo", name: "Demo" }]]) };
};
const uuid = () => crypto.randomUUID();

function fakeAdminClient() {
  return {
    from(table) {
      const store = table === "content_calendar_plans" ? db.plans : table === "content_calendar_items" ? db.items : table === "community_announcements" ? db.announcements : table === "profiles" ? db.profiles : new Map();
      const st = { filters: [], op: "select" };
      const rowsFor = () => Array.from(store.values()).filter((r) => st.filters.every(([k, v]) => r[k] === v));
      const b = {
        select: () => b,
        eq(k, v) {
          st.filters.push([k, v]);
          return b;
        },
        order: () => b,
        limit: () => b,
        in(k, vals) {
          st.filters.push([k, "__in__", vals]);
          return b;
        },
        insert(payload) {
          st.op = "insert";
          st.payload = Array.isArray(payload) ? payload : [payload];
          return b;
        },
        update(payload) {
          st.op = "update";
          st.payload = payload;
          return b;
        },
        delete() {
          st.op = "delete";
          return b;
        },
        maybeSingle: async () => resolve(true),
        single: async () => resolve(true),
        then(res, rej) {
          return Promise.resolve(resolve(false)).then(res, rej);
        },
      };
      function matches(r) {
        return st.filters.every(([k, v, extra]) => (v === "__in__" ? extra.includes(r[k]) : r[k] === v));
      }
      function resolve(single) {
        if (st.op === "insert") {
          const rows = st.payload.map((p) => ({ id: uuid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...p }));
          for (const r of rows) store.set(r.id, r);
          return { data: single ? rows[0] : rows, error: null };
        }
        if (st.op === "update") {
          const targets = Array.from(store.values()).filter(matches);
          for (const t of targets) Object.assign(t, st.payload);
          return { data: single ? targets[0] ?? null : targets, error: null };
        }
        if (st.op === "delete") {
          const targets = Array.from(store.values()).filter(matches);
          for (const t of targets) store.delete(t.id);
          return { data: null, error: null };
        }
        const rows = Array.from(store.values()).filter(matches);
        return { data: single ? rows[0] ?? null : rows, error: null };
      }
      return b;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

const serverMod = load("lib/supabase/server.ts");
serverMod.createAdminClient = fakeAdminClient;

// sendAnnouncementToSubscribers is exercised through the real publish.ts, but the real function
// reaches into community_subscribers/community_delivery_logs which aren't modeled here — stub it
// directly (publish.ts imports it from lib/community/send.ts), same technique used throughout
// this suite for external side effects.
const communitySendMod = load("lib/community/send.ts");
let lastAnnouncementSent = null;
communitySendMod.sendAnnouncementToSubscribers = async (_admin, announcement) => {
  lastAnnouncementSent = announcement;
  return { recipientCount: 3, sentCount: 3, failedCount: 0, emailChannel: true };
};

const { getOwnPlan, getOwnItem, insertItems, upsertPlan, updateOwnItem, deleteOwnItem, listPlanItems } = load("lib/ai/calendar/store.ts");
const { publishCalendarItem } = load("lib/ai/calendar/publish.ts");
const { createContentCalendar, updateContentCalendarItem } = load("lib/ai/tools/definitions/calendar.ts");

const ctxFor = (workspace) => ({ workspace, snapshot: {}, locale: "en" });

// ------------------------------------------------------------------ store.ts: ownership scoping
{
  resetDb();
  const plan = await upsertPlan(WS, 2026, 10, { title: "October", locale: "en", status: "active" });
  check("upsertPlan: creates a plan for the correct owner/profile", plan?.user_id === WS.userId && plan?.profile_id === WS.profileId, JSON.stringify(plan));
  check("upsertPlan: one plan per profile per month (upserts, doesn't duplicate)", (await upsertPlan(WS, 2026, 10, { title: "October (renamed)" })).title === "October (renamed)");
  check("getOwnPlan: another user's workspace never sees this plan", (await getOwnPlan(OTHER_WS, 2026, 10)) === null);

  const rows = await insertItems(WS, plan.id, "UTC", [
    { scheduledDate: "2026-10-05", scheduledTime: null, title: "T1", content: "Post one", cta: null, contentType: "announcement", linkType: "none", linkRefId: null },
    { scheduledDate: "2026-10-12", scheduledTime: null, title: "T2", content: "Post two", cta: null, contentType: "promotion", linkType: "none", linkRefId: null },
  ], true);
  check("insertItems: creates the right number of items, correctly owned", rows.length === 2 && rows.every((r) => r.user_id === WS.userId && r.profile_id === WS.profileId));
  check("insertItems: items start 'planned' (never auto-published)", rows.every((r) => r.status === "planned"));

  const listed = await listPlanItems(WS, plan.id);
  check("listPlanItems: returns exactly this plan's own items", listed.length === 2);
  check("listPlanItems: another user's workspace sees nothing for this plan", (await listPlanItems(OTHER_WS, plan.id)).length === 0);

  const itemId = rows[0].id;
  check("getOwnItem: another user cannot read this item", (await getOwnItem(OTHER_WS, itemId)) === null);

  const updated = await updateOwnItem(WS, itemId, { content: "Edited content", status: "approved" });
  check("updateOwnItem: edits content and status", updated?.content === "Edited content" && updated?.status === "approved");
  check("updateOwnItem: another user cannot edit this item", (await updateOwnItem(OTHER_WS, itemId, { content: "hacked" })) === null);

  await updateOwnItem(WS, itemId, { status: "published" });
  const afterPublish = await updateOwnItem(WS, itemId, { content: "should not apply" });
  check("updateOwnItem: refuses to edit an already-published item", afterPublish === null);

  const deleteOk = await deleteOwnItem(WS, rows[1].id);
  check("deleteOwnItem: deletes a non-published owned item", deleteOk === true);
  const deletePublishedBlocked = await deleteOwnItem(WS, itemId); // now published
  check("deleteOwnItem: refuses to delete a published item", deletePublishedBlocked === false);
}

// ------------------------------------------------------------------ create_content_calendar tool: no fabrication, structure
{
  resetDb();
  check("create_content_calendar: kind is 'calendar'", createContentCalendar.kind === "calendar");
  check("create_content_calendar: schema is strict at the top level", createContentCalendar.inputSchema.additionalProperties === false);
  check("create_content_calendar: nested item schema is ALSO strict (OpenAI strict-mode requirement)", createContentCalendar.inputSchema.properties.items.items.additionalProperties === false);

  const validInput = {
    year: 2026,
    month: 10,
    focus: "grow_community",
    items: [
      { scheduled_date: "2026-10-03", scheduled_time: null, title: "Tip", content: "A general tip post.", cta: null, content_type: "educational", link_type: "none", link_ref_id: null },
      { scheduled_date: "2026-10-40", scheduled_time: null, title: "x", content: "bad date", cta: null, content_type: "other", link_type: "none", link_ref_id: null },
    ],
  };
  check("parseInput: rejects a malformed date", createContentCalendar.parseInput(validInput) === null);

  validInput.items[1].scheduled_date = "2026-10-10";
  const parsed = createContentCalendar.parseInput(validInput);
  check("parseInput: accepts a well-formed plan", parsed !== null && parsed.items.length === 2, JSON.stringify(parsed));

  check("parseInput: rejects a link_type other than 'none' with no link_ref_id", createContentCalendar.parseInput({ ...validInput, items: [{ ...validInput.items[0], link_type: "product", link_ref_id: null }] }) === null);
  check("parseInput: rejects more than the max items per plan", createContentCalendar.parseInput({ ...validInput, items: Array(25).fill(validInput.items[0]) }) === null);
  check("parseInput: rejects content over the max length", createContentCalendar.parseInput({ ...validInput, items: [{ ...validInput.items[0], content: "x".repeat(2000) }] }) === null);

  const result = await createContentCalendar.run(ctxFor(WS), parsed);
  check("run: creates the plan and its items", result.ok === true && result.items_created === 2, JSON.stringify(result));
  const plan = await getOwnPlan(WS, 2026, 10);
  check("run: the plan is findable afterward under the caller's own workspace", plan?.id === result.plan_id);
  const items = await listPlanItems(WS, plan.id);
  check("run: every item starts 'planned', never published, regardless of AI generation", items.every((i) => i.status === "planned"));
  check("run: ai_generated is recorded true for AI-planned items", items.every((i) => i.ai_generated === true));

  let emitted = null;
  await createContentCalendar.run({ ...ctxFor(WS), emitCalendarPlan: (p) => (emitted = p) }, parsed);
  check("run: emits a calendar-plan card with a bounded item preview", emitted?.itemCount === 2 && Array.isArray(emitted.items));
}

// ------------------------------------------------------------------ update_content_calendar_item tool: can never publish
{
  resetDb();
  const statusEnum = updateContentCalendarItem.inputSchema.properties.status.anyOf[0].enum;
  check("update_content_calendar_item: status enum NEVER includes 'published' — that's Human-only", Array.isArray(statusEnum) && !statusEnum.includes("published"), JSON.stringify(statusEnum));

  const plan = await upsertPlan(WS, 2026, 11, { locale: "en", status: "active" });
  const [item] = await insertItems(WS, plan.id, "UTC", [{ scheduledDate: "2026-11-05", scheduledTime: null, title: "T", content: "Original", cta: null, contentType: "other", linkType: "none", linkRefId: null }], true);

  check("update tool: parseInput rejects an attempt to set status to 'published' (not in the enum)", updateContentCalendarItem.parseInput({ item_id: item.id, scheduled_date: null, scheduled_time: null, title: null, content: null, cta: null, content_type: null, status: "published" }) === null);

  const okInput = updateContentCalendarItem.parseInput({ item_id: item.id, scheduled_date: null, scheduled_time: null, title: null, content: "Rewritten, more engaging.", cta: null, content_type: null, status: "approved" });
  check("update tool: parseInput accepts a real edit", okInput !== null);
  const result = await updateContentCalendarItem.run(ctxFor(WS), okInput);
  check("update tool: applies the edit", result.ok === true && result.status === "approved", JSON.stringify(result));

  const otherResult = await updateContentCalendarItem.run(ctxFor(OTHER_WS), okInput);
  check("update tool: refuses another workspace's item", otherResult.ok === false && otherResult.reason === "item_not_found", JSON.stringify(otherResult));
}

// ------------------------------------------------------------------ publish.ts: reuses the EXISTING Community mechanism, never a second one
{
  resetDb();
  const plan = await upsertPlan(WS, 2026, 12, { locale: "en", status: "active" });
  const [item] = await insertItems(WS, plan.id, "UTC", [{ scheduledDate: "2026-12-25", scheduledTime: null, title: "Holiday", content: "Happy holidays from us!", cta: "Visit us", contentType: "announcement", linkType: "none", linkRefId: null }], true);
  await updateOwnItem(WS, item.id, { status: "approved" });

  lastAnnouncementSent = null;
  const result = await publishCalendarItem(WS, item.id);
  check("publishCalendarItem: succeeds for an approved item", result.ok === true, JSON.stringify(result));
  check("publishCalendarItem: creates a REAL community_announcements row (the existing mechanism, not a new one)", lastAnnouncementSent?.message === "Happy holidays from us!" && lastAnnouncementSent?.profile_id === WS.profileId);

  const publishedItem = await getOwnItem(WS, item.id);
  check("publishCalendarItem: marks the item published with a stored community_post_id", publishedItem?.status === "published" && !!publishedItem?.community_post_id);

  const secondAttempt = await publishCalendarItem(WS, item.id);
  check("publishCalendarItem: refuses to publish an already-published item twice (no duplicate community post)", secondAttempt.ok === false && secondAttempt.reason === "already_published", JSON.stringify(secondAttempt));

  const otherAttempt = await publishCalendarItem(OTHER_WS, item.id);
  check("publishCalendarItem: another workspace cannot publish this item", otherAttempt.ok === false && otherAttempt.reason === "not_found", JSON.stringify(otherAttempt));

  // A cancelled item is not publishable either.
  const [item2] = await insertItems(WS, plan.id, "UTC", [{ scheduledDate: "2026-12-26", scheduledTime: null, title: "X", content: "Should not publish.", cta: null, contentType: "other", linkType: "none", linkRefId: null }], true);
  await updateOwnItem(WS, item2.id, { status: "cancelled" });
  const cancelledAttempt = await publishCalendarItem(WS, item2.id);
  check("publishCalendarItem: refuses to publish a cancelled item", cancelledAttempt.ok === false && cancelledAttempt.reason === "not_publishable", JSON.stringify(cancelledAttempt));
}

const failed = results.filter((x) => !x.pass);
console.log(`\nringo_ai_calendar_unit: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
