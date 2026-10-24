// Churches & Ministries Phase 10 (Ringo AI): the get_my_church_report tool, validated OFFLINE against scratch PGlite that holds the REAL migrations.
// It must give the model the same AGGREGATES as the Reports screen through the person's OWN session, and nothing else: no person, no child, no care, no money.
//   Run:  node scripts/tests/churchAiReport.test.mjs
import fs from "fs";
import path from "path";
import { createHarness, kit, SRC, REPO, doualaToday } from "./ministryApiHarness.mjs";

const H = await createHarness({ dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true });
const { F, jiti } = H;
const { u, prof, m } = F;
const { check, eq, section, summary } = kit();
console.error = () => {};

const T = jiti(path.join(SRC, "lib/ai/tools/definitions/churchReport.ts")).getMyChurchReport;
const TR = jiti(path.join(SRC, "lib/i18n/translations.ts")).translations;
const D0 = doualaToday();

const U2 = (n) => F.id("c", 170 + n);
const staffOnly = U2(1), staffAll = U2(2), staffNone = U2(3);
const R2 = (n) => F.id("b", 170 + n);
const E = (k) => F.id("8", 700 + k);
const EXTRA = `
  insert into public.users (id, role, plan_id) values ('${staffOnly}','user','${F.plan.free}'), ('${staffAll}','user','${F.plan.free}'), ('${staffNone}','user','${F.plan.free}');
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${R2(1)}','${prof.c1}','aionly','Reports + events','{church.reports.view,church.events.view}'),
    ('${R2(2)}','${prof.c1}','aiall','Reports + people + attendance','{church.reports.view,church.members.view,church.attendance.view,church.events.view}'),
    ('${R2(3)}','${prof.c1}','aino','No reports permission','{church.members.view,church.attendance.view,church.events.view}');
  insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${staffOnly}','${R2(1)}'), ('${prof.c1}','${staffAll}','${R2(2)}'), ('${prof.c1}','${staffNone}','${R2(3)}');
  insert into public.ministry_events (id, profile_id, status, event_date, title_en, is_cancelled) values
    ('${E(1)}','${prof.c1}','published', public.ministry_today(), 'Sunday service', false),
    ('${E(2)}','${prof.c1}','published', public.ministry_today() - 7, 'Midweek prayer', false);
  insert into public.ministry_attendance (profile_id, event_id, member_id) values ('${prof.c1}','${E(1)}','${m.admin}'), ('${prof.c1}','${E(1)}','${m.other}');
  insert into public.ministry_attendance_counts (event_id, profile_id, visitors, children) values ('${E(1)}','${prof.c1}', 3, 4);
  insert into public.ministry_care_cases (id, profile_id, title_en, summary_en) values ('${F.id("6", 800)}','${prof.c1}','Hospital bill for Olivier','Private care story');
  insert into public.ministry_care_beneficiaries (case_id, profile_id, member_id) values ('${F.id("6", 800)}','${prof.c1}','${m.other}');
`;
const run = async (who, profileId, input = { period: "last_30_days" }) => {
  globalThis.__churchSession = F.sessionFor(H.db, who);
  return T.run({ workspace: { userId: who, profileId, username: "x", actor: { kind: "owner" } }, snapshot: {}, locale: "en" }, input);
};
const snapshot = (category, categories = []) => ({ profile: { category, categories } });

section("A. the tool definition: ");
{
  check("it is a READ tool with the church reports permission", T.kind === "read" && T.permission === "church.reports.view" && T.name === "get_my_church_report");
  check("it is offered only to church pages", T.available(snapshot("church_ministries")) && T.available(snapshot("other", ["church_ministries"])) && !T.available(snapshot("music_entertainment")) && !T.available(snapshot(null)));
  const sch = T.inputSchema;
  check("the schema is closed: one required enum, no free text, no id, no date", sch.additionalProperties === false && JSON.stringify(sch.required) === '["period"]' && Array.isArray(sch.properties.period.enum) && Object.keys(sch.properties).length === 1);
  check("input: a named period only", T.parseInput({ period: "last_7_days" })?.period === "last_7_days" && ["last_7_days", "last_30_days", "last_90_days", "last_12_months", "this_year"].every((p) => T.parseInput({ period: p })));
  check("input: anything else is rejected (no input, extra keys, free text, dates, ids, arrays)", [undefined, null, {}, { period: "yesterday" }, { period: "last_7_days", from: "2026-01-01" }, { period: "last_7_days", member_id: m.admin }, { period: "2026-01-01" }, { period: 7 }, [], "last_7_days"].every((x) => T.parseInput(x) === null));
  const idx = fs.readFileSync(path.join(REPO, "src/lib/ai/tools/index.ts"), "utf8");
  check("it is registered in the tool list", /import \{ getMyChurchReport \}/.test(idx) && /^\s*getMyChurchReport,/m.test(idx));
  check("it has a status label in both languages", !!TR.en.ringoAi.toolStatus.get_my_church_report && !!TR.fr.ringoAi.toolStatus.get_my_church_report && TR.en.ringoAi.toolStatus.get_my_church_report !== TR.fr.ringoAi.toolStatus.get_my_church_report);
  const desc = T.description.toLowerCase();
  check("the description tells the model what it will NOT get", desc.includes("never returns") && desc.includes("care") && desc.includes("money") && desc.includes("name"));
}

section("B. the figures reach the model, through the person's own session: ");
{
  await H.fresh(EXTRA);
  const r = await run(u.owner1, prof.c1);
  eq("period and timezone", [r.period, r.timezone, r.to], ["last_30_days", "Africa/Douala", D0]);
  eq("people by status (adults and young people only)", r.people.by_status, { pending: 1, active: 6, inactive: 0, removed: 0 });
  eq("groups and leadership", r.groups, { departments: 2, groups: 2, current_leadership_roles: 1 });
  eq("events", [r.events.published_in_period, r.events.still_to_come, r.events.already_held], [2, 1, 1]);
  eq("attendance totals leave children out entirely (total = present + visitors)", [r.attendance.totals.present, r.attendance.totals.visitors, r.attendance.totals.total_without_children], [2, 3, 5]);
  check("no child figure anywhere in the attendance answer, so it cannot be recovered by subtraction", !/child/i.test(JSON.stringify(r.attendance).replace(/total_without_children|Children are never included in these figures./g, "")) && r.attendance.totals.peak === 5 && r.attendance.totals.average_per_recorded_event === 5);
  eq("the most recent events carry only a date, a title and numbers", Object.keys(r.attendance.most_recent_events[0]).sort(), ["cancelled", "date", "present", "recorded", "title", "total_without_children", "visitors"]);
  eq("bible and daily word sections exist", [typeof r.bible_programmes, typeof r.daily_word], ["object", "object"]);
  eq("nothing unavailable and nothing failed for the owner", [r.not_available, r.could_not_load], [undefined, undefined]);
  const narrow = await run(u.owner1, prof.c1, { period: "last_7_days" });
  eq("a shorter period changes the range", narrow.from, new Date(Date.parse(D0 + "T00:00:00Z") - 6 * 86400000).toISOString().slice(0, 10));
  const year = await run(u.owner1, prof.c1, { period: "this_year" });
  eq("this_year starts on 1 January", year.from, `${D0.slice(0, 4)}-01-01`);
  const o2 = await run(u.owner2, prof.c2);
  eq("another church's owner gets their own numbers", [o2.people.by_status.active, o2.events.published_in_period], [1, 0]);
}

section("C. permissions are re-checked on the server: ");
{
  await H.fresh(EXTRA);
  const none = await run(staffNone, prof.c1);
  eq("a person WITHOUT church.reports.view gets nothing, even holding every data permission", [none.available, typeof none.reason], [false, "string"]);
  check("...and no figure at all", !JSON.stringify(none).match(/by_status|totals|published/));
  const only = await run(staffOnly, prof.c1);
  eq("reports + events builds only the events section", [Object.keys(only).filter((k) => ["people", "groups", "events", "attendance", "bible_programmes", "daily_word"].includes(k))], [["events"]]);
  eq("...and lists the rest as not available", only.not_available.sort(), ["attendance", "bible", "content", "groups", "people"]);
  const all = await run(staffAll, prof.c1);
  eq("reports + people + attendance + events builds exactly those three", Object.keys(all).filter((k) => ["people", "groups", "events", "attendance", "bible_programmes", "daily_word"].includes(k)).sort(), ["attendance", "events", "people"]);
  let err = null; try { await run(u.owner1, prof.c2); } catch (e) { err = String(e.message); }
  check("a workspace for a DIFFERENT church than the person's active one is refused, never read", err === "church mismatch", err);
  let err2 = null; try { await run(u.stranger, prof.c1); } catch (e) { err2 = String(e.message); }
  check("a stranger is refused", !!err2, err2);
  let err3 = null; try { await run(u.admin, prof.c1); } catch (e) { err3 = String(e.message); }
  check("a platform admin who is not the owner is refused", !!err3, err3);
  eq("the service-role client was never used", globalThis.__adminClientCalls, 0);
}

section("D. PRIVACY: counts only, nothing about a person, a child, care or money: ");
{
  await H.fresh(EXTRA);
  const SECRETS = ["Grace Admin", "Luc Leader", "Vera Volunteer", "Olivier", "Gaby Guardian", "Paul Pending", "Yann Youth", "Kiki Child", "Koko Child", "grace@example.test", "+2376700", "Second Church", "Hospital bill", "Private care story", m.admin, m.other, m.kid1, m.kid2, m.guardian, F.id("6", 800)];
  const out = JSON.stringify(await run(u.owner1, prof.c1, { period: "last_12_months" }));
  check("the answer holds no name, contact, roster id, child, guardian, case or beneficiary", SECRETS.every((s) => !out.includes(s)), SECRETS.filter((s) => out.includes(s)).join());
  const keys = new Set();
  const walk = (o) => { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); } };
  walk(JSON.parse(out));
  const banned = ["full_name", "name", "phone", "email", "member_id", "members", "guardian", "customer_id", "user_id", "beneficiary", "beneficiaries", "contribution", "amount", "care", "case", "consent", "currency", "payment"];
  check("no key of the answer is named like personal data, care or money", banned.every((k) => !keys.has(k)), banned.filter((k) => keys.has(k)).join());
  const log = (globalThis.__churchSession.log || []).map((l) => l.table);
  await run(u.owner1, prof.c1);
  const tables = new Set((globalThis.__churchSession.log || []).map((l) => l.table));
  check("it reads only report tables: never care, consent, beneficiary or any payment table", [...tables].every((t) => ["profiles", "users", "organization_members", "organization_roles", "church_members", "church_groups", "church_leadership", "ministry_events", "ministry_announcements", "ministry_attendance", "ministry_attendance_counts", "bible_programs", "daily_words"].includes(t)), [...tables].join());
  eq("it performs no write", (globalThis.__churchSession.log || []).filter((l) => l.mode !== "select").length, 0);
  void log;
  const src = fs.readFileSync(path.join(REPO, "src/lib/ai/tools/definitions/churchReport.ts"), "utf8").replace(/\/\/[^\n]*/g, "");
  check("the tool code references no care, beneficiary, consent, payment or admin-client code", !/ministry_care|beneficiar|consent|fapshi|stripe|payment|contribution|ledger|createAdminClient|church_members|full_name/i.test(src), (src.match(/ministry_care|beneficiar|consent|fapshi|stripe|payment|contribution|ledger|createAdminClient|church_members|full_name/i) || [""])[0]);
  const know = fs.readFileSync(path.join(REPO, "src/lib/ai/knowledge/modules/churchMinistries.ts"), "utf8");
  check("the knowledge module is version 4 and states the AI's limits", /version: 4,/.test(know) && /get_my_church_report/.test(know) && /no access to individual people, children/i.test(know));
  check("the knowledge no longer claims reports do not exist", !/church reports, exports, attendance reports/.test(know) && !/no attendance reports or exports yet/.test(know));
  check("the knowledge still says care and giving are not available", /care and support[^.]*not available yet/.test(know) && /giving or donations/.test(know));
}

section("E. the answer stays small: ");
{
  await H.fresh(EXTRA);
  // 60 events with long titles and many programmes cannot blow the tool's size cap
  const long = "T".repeat(110);
  await F.svc(H.db, `insert into public.ministry_events (profile_id, status, event_date, title_en) select '${prof.c1}','published', public.ministry_today() - g, '${long}' || g from generate_series(1, 60) g`);
  const out = JSON.stringify(await run(u.owner1, prof.c1, { period: "last_90_days" }));
  check("the JSON stays under the registry's 6000-character cap", out.length < 6000, String(out.length));
  eq("only the most recent events are listed", (JSON.parse(out).attendance.most_recent_events || []).length, 8);
  check("titles are clipped", JSON.parse(out).attendance.most_recent_events.every((e) => (e.title || "").length <= 60));
}

H.close();
process.exit(summary());
