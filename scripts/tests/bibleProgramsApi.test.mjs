// Churches & Ministries Phase 5: the Bible programmes back end for CHURCH STAFF, validated end to end and OFFLINE.
// The REAL route files (src/app/api/church/bible/**), the REAL handlers, validation, error mapping and actor resolution run against scratch in-memory PostgreSQL (PGlite) that holds the REAL Team
// migrations, the REAL Phase 2A church migration and the REAL Phase 3 / 4 / 5 migrations. See scripts/tests/ministryApiHarness.mjs. The participant side is bibleJourneyApi.test.mjs.
//   Run:  node scripts/tests/bibleProgramsApi.test.mjs
import fs from "fs";
import path from "path";
import { createHarness, kit, SRC } from "./ministryApiHarness.mjs";

const H = await createHarness({ dailyWords: true, events: true, bible: true });
const { F, jiti } = H;
const { u, prof } = F;
const { check, eq, is, section, summary } = kit();
const realConsoleError = console.error;
console.error = () => {};

const BH = jiti(path.join(SRC, "lib/church/bible/handlers.ts"));
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const ERR = jiti(path.join(SRC, "lib/church/errors.ts"));

const U2 = (n) => F.id("c", 80 + n);
const bv = U2(1), bm = U2(2), bp = U2(3), adminPub = U2(4), evOnly = U2(5);
const R2 = (n) => F.id("b", 80 + n);
const r = { view: R2(1), manage: R2(2), publish: R2(3), adminPub: R2(4), events: R2(5) };
const CU = (k) => F.id("c", 700 + k);
const EXTRA = `
  insert into public.users (id, role, plan_id) values ('${bv}','user','${F.plan.free}'), ('${bm}','user','${F.plan.free}'), ('${bp}','user','${F.plan.free}'), ('${adminPub}','admin','${F.plan.free}'), ('${evOnly}','user','${F.plan.free}');
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${r.view}','${prof.c1}','bview','Bible viewer','{church.bible.view}'),
    ('${r.manage}','${prof.c1}','bmanage','Bible writer','{church.bible.manage}'),
    ('${r.publish}','${prof.c1}','bpublish','Bible publisher','{church.bible.publish}'),
    ('${r.adminPub}','${prof.c1}','badmin','Admin holding publish','{church.bible.publish,church.bible.view}'),
    ('${r.events}','${prof.c1}','bevents','Events publisher only','{church.events.publish}');
  insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${bv}','${r.view}'), ('${prof.c1}','${bm}','${r.manage}'), ('${prof.c1}','${bp}','${r.publish}'), ('${prof.c1}','${adminPub}','${r.adminPub}'), ('${prof.c1}','${evOnly}','${r.events}');
  insert into public.ringo_customers (id) values ('${CU(1)}'), ('${CU(2)}'), ('${CU(3)}');
`;
const O = u.owner1;
const REL = "church/bible";
const stamp = {
  p: (id) => H.stamp("bible_programs", id),
  s: (id) => H.stamp("bible_program_sessions", id),
};
const mkProgram = async (who = O, body = { title_en: "Psalms in 30 days", title_fr: "Les Psaumes en 30 jours", description_en: "A month of Psalms." }) => (await H.call(who, "POST", REL, { body })).body.id;
const mkSession = async (who, pid, body = { title_en: "Day 1", scripture_ref_en: "Psalm 1" }) => (await H.call(who, "POST", `${REL}/[id]/sessions`, { params: { id: pid }, body }));
const pub = async (who, pid) => H.call(who, "POST", `${REL}/[id]/publish`, { params: { id: pid }, body: { confirm: true, expected_updated_at: await stamp.p(pid) } });
const unpub = async (who, pid) => H.call(who, "POST", `${REL}/[id]/unpublish`, { params: { id: pid }, body: { confirm: true, expected_updated_at: await stamp.p(pid) } });
const delSession = async (who, pid, sid) => H.call(who, "DELETE", `${REL}/[id]/sessions/[sid]`, { params: { id: pid, sid }, url: `?expected_updated_at=${encodeURIComponent(await stamp.s(sid))}` });
const editSession = async (who, pid, sid, body) => H.call(who, "PATCH", `${REL}/[id]/sessions/[sid]`, { params: { id: pid, sid }, body: { ...body, expected_updated_at: await stamp.s(sid) } });
const move = (who, pid, sid, direction) => H.call(who, "POST", `${REL}/[id]/sessions/[sid]/move`, { params: { id: pid, sid }, body: { direction } });
const order = async (pid) => (await H.rows(`select string_agg(title_en, ',' order by position) as o from public.bible_program_sessions where program_id = '${pid}'`))[0].o;

// =================================================================================================================================================================
section("A. input validation (pure): ");
// =================================================================================================================================================================
{
  const Pp = BH.parseProgram, Ps = BH.parseSession;
  check("programme: an empty draft is a valid create", Pp({}, "create").ok);
  check("programme: text fields only; status and church are refused", Pp({ status: "published" }, "create").code === "unexpected_field" && Pp({ profile_id: "x" }, "create").code === "unexpected_field" && Pp({ published_at: "x" }, "create").code === "unexpected_field");
  check("programme: too-long text carries its own code", Pp({ title_en: "x".repeat(121) }, "create").code === "invalid_title" && Pp({ description_fr: "x".repeat(2001) }, "create").code === "invalid_description");
  check("programme: an edit needs content and may carry expected_updated_at", Pp({ expected_updated_at: "2027-01-01T00:00:00Z" }, "update").code === "empty_update" && Pp({ title_en: "x", expected_updated_at: "2027-01-01T00:00:00Z" }, "update").ok && Pp({ title_en: "x", expected_updated_at: "soon" }, "update").code === "invalid_body");
  check("session: the three text kinds have their own codes", Ps({ title_en: "x".repeat(121) }, "create").code === "invalid_title" && Ps({ scripture_ref_en: "x".repeat(121) }, "create").code === "invalid_reference" && Ps({ note_fr: "x".repeat(1001) }, "create").code === "invalid_note");
  check("session: position, program and church can never be sent", ["position", "program_id", "profile_id", "id", "created_by"].every((f) => Ps({ title_en: "x", [f]: "x" }, "create").code === "unexpected_field"));
  check("session: control characters are refused and blank text becomes null", Ps({ title_en: "a\u0007b" }, "create").code === "invalid_title" && Ps({ title_en: "   " }, "create").value.title_en === null);
  check("session: no Bible text field exists (a reference only)", Ps({ scripture_text_en: "In the beginning" }, "create").code === "unexpected_field" && Ps({ verse: "x" }, "create").code === "unexpected_field");
  const M = BH.parseMove;
  check("move: up or down only", M({ direction: "up" }).ok && M({ direction: "down" }).ok && M({ direction: "left" }).code === "invalid_direction" && M({}).code === "invalid_direction" && M({ direction: "up", x: 1 }).code === "unexpected_field");
  const caps = (...p) => PERM.churchCapabilities(p);
  check("capabilities: the three Bible levels", caps("church.bible.view").viewBible && !caps("church.bible.view").manageBible && caps("church.bible.manage").viewBible && caps("church.bible.manage").manageBible && !caps("church.bible.manage").publishBible && caps("church.bible.publish").manageBible && caps("church.bible.publish").publishBible);
  check("capabilities: other permissions grant nothing here", !caps("church.events.publish").viewBible && !caps("church.content.publish").viewBible && !caps("church.members.manage").manageBible);
  check("the three strings are registered as church permissions and are SENSITIVE (owner-only to grant)", ["church.bible.view", "church.bible.manage", "church.bible.publish"].every((p) => PERM.CHURCH_PERMISSIONS.includes(p) && PERM.isSensitiveChurchPermissionName(p)));
  const cls = (message, code = "23514") => ERR.classifyDbError({ message, code });
  eq("db: publishing without a session", [cls("bible_program_needs_sessions").status, cls("bible_program_needs_sessions").code], [422, "needs_sessions"]);
  eq("db: the 400-session cap", cls("bible_session_limit").code, "session_limit");
  eq("db: a session without a title", cls('violates check constraint "bible_program_sessions_title_check"').code, "session_needs_title");
  eq("db: a position collision asks to try again", [cls('duplicate key value violates unique constraint "bible_program_sessions_position_key"', "23505").status, cls('duplicate key value violates unique constraint "bible_program_sessions_position_key"', "23505").code], [409, "try_again"]);
  eq("db: deleting a programme with participants", cls('update or delete on table "bible_programs" violates foreign key constraint "bible_enrollments_program_fk" on table "bible_enrollments"', "23503").code, "program_has_participants");
  eq("db: a programme that cannot be joined", cls("bible_program_unavailable").code, "program_unavailable");
}

// =================================================================================================================================================================
section("B. the programme lifecycle: ");
// =================================================================================================================================================================
{
  await H.fresh(EXTRA);
  const anon = () => F.sessionFor(H.db, null).from("bible_programs").select("id, title_en");
  const anonS = () => F.sessionFor(H.db, null).from("bible_program_sessions").select("id");
  let res = await H.call(O, "GET", REL);
  is("empty list", res, 200, "ok");
  check("...no items, today is not part of this answer", res.body.items.length === 0 && res.body.total === 0);
  res = await H.call(O, "POST", REL, { body: { title_en: "Psalms in 30 days", title_fr: "Les Psaumes en 30 jours", description_en: "A month of Psalms." } });
  is("create a draft programme", res, 201, "ok");
  const pid = res.body.id;
  check("created as a DRAFT, nothing decided by the client", res.body.item.status === "draft" && res.body.item.state === "draft" && (await H.rows(`select profile_id::text as p, created_by::text as c from public.bible_programs where id = '${pid}'`))[0].p === prof.c1);
  res = await pub(O, pid);
  is("a programme with no session cannot be published", res, 422, "needs_sessions");
  check("...and it is still a draft", (await H.rows(`select status from public.bible_programs where id = '${pid}'`))[0].status === "draft");
  res = await mkSession(O, pid, { title_en: "Day 1", scripture_ref_en: "Psalm 1", note_en: "Read slowly." });
  is("add the first session", res, 201, "ok");
  check("...at position 1, with the reference as typed", res.body.session.position === 1 && res.body.session.scripture_ref_en === "Psalm 1" && !("profile_id" in res.body.session) && !("created_by" in res.body.session));
  const s1 = res.body.id;
  const s2 = (await mkSession(O, pid, { title_en: "Day 2", scripture_ref_en: "Psalm 23" })).body.id;
  const s3 = (await mkSession(O, pid, { title_fr: "Jour 3", scripture_ref_fr: "Psaume 91" })).body.id;
  eq("sessions are appended in order", (await H.rows(`select position from public.bible_program_sessions where program_id = '${pid}' order by position`)).map((x) => x.position), [1, 2, 3]);
  res = await H.call(O, "GET", REL);
  check("the list shows the session count", res.body.items.length === 1 && res.body.items[0].session_count === 3 && res.body.items[0].has_en === true && res.body.items[0].has_fr === true);
  res = await H.call(O, "GET", `${REL}/[id]`, { params: { id: pid } });
  is("detail", res, 200, "ok");
  check("...the programme, its sessions in order, the counts (no participants yet), the rights", res.body.item.title_en === "Psalms in 30 days" && res.body.sessions.map((x) => x.position).join() === "1,2,3" && res.body.stats.enrolled === 0 && res.body.stats.detailed === false && res.body.can.sessions === true && res.body.can.publish === true && res.body.maxSessions === 400);
  check("...no audit column anywhere", !JSON.stringify(res.body).match(/created_by|updated_by|published_by|profile_id/));
  check("a draft is invisible to the public", ((await anon()).data || []).length === 0 && ((await anonS()).data || []).length === 0);
  // publish
  res = await H.call(O, "POST", `${REL}/[id]/publish`, { params: { id: pid }, body: { expected_updated_at: await stamp.p(pid) } });
  is("publish without confirmation is refused", res, 400, "confirmation_required");
  res = await pub(O, pid);
  is("publish", res, 200, "ok");
  check("...the public now reads the programme and its three sessions", ((await anon()).data || []).length === 1 && ((await anonS()).data || []).length === 3);
  is("publishing twice is refused", await pub(O, pid), 409, "already_published");
  // edit a live programme
  res = await H.call(O, "PATCH", `${REL}/[id]`, { params: { id: pid }, body: { description_en: "Edited live", expected_updated_at: await stamp.p(pid) } });
  is("the publisher edits a live programme", res, 200, "ok");
  check("...the public sees it at once", ((await F.sessionFor(H.db, null).from("bible_programs").select("description_en").eq("id", pid)).data || [])[0]?.description_en === "Edited live");
  // a title is required to publish
  const noTitle = await mkProgram(O, { description_en: "No title" });
  await mkSession(O, noTitle);
  is("a programme with no title cannot be published", await pub(O, noTitle), 422, "needs_title");
  // unpublish / delete
  res = await unpub(O, pid);
  is("unpublish", res, 200, "ok");
  check("...hidden again, sessions too", ((await anon()).data || []).length === 0 && ((await anonS()).data || []).length === 0);
  is("unpublishing a draft is refused", await unpub(O, pid), 409, "not_published");
  res = await H.call(O, "DELETE", `${REL}/[id]`, { params: { id: pid }, url: `?expected_updated_at=${encodeURIComponent(await stamp.p(pid))}` });
  is("delete a draft programme", res, 200, "ok");
  check("...its sessions went with it", (await H.rows(`select count(*)::int as n from public.bible_program_sessions where program_id = '${pid}'`))[0].n === 0);
  res = await H.call(O, "GET", REL + "?view=nope");
  is("an unknown view is refused", res, 400, "invalid_view");
  check("the service-role client was never used", globalThis.__adminClientCalls === 0);
}

// =================================================================================================================================================================
section("C. sessions: ");
// =================================================================================================================================================================
{
  await H.fresh(EXTRA);
  const pid = await mkProgram();
  let res = await mkSession(O, pid, { scripture_ref_en: "Psalm 1" });
  is("a session needs a title", res, 400, "session_needs_title");
  res = await mkSession(O, pid, { title_en: "x".repeat(121) });
  is("a too-long title is refused", res, 400, "invalid_title");
  res = await mkSession(O, pid, { title_en: "A", position: 5 });
  is("a client cannot choose the position", res, 400, "unexpected_field");
  const a = (await mkSession(O, pid, { title_en: "A" })).body.id;
  const b = (await mkSession(O, pid, { title_en: "B" })).body.id;
  const c = (await mkSession(O, pid, { title_en: "C" })).body.id;
  eq("A, B, C in order", await order(pid), "A,B,C");
  // edit
  const BAD = ["not-a-date", "", null, 12345, "x".repeat(41)];
  res = await H.call(O, "PATCH", `${REL}/[id]/sessions/[sid]`, { params: { id: pid, sid: a }, body: { title_en: "A2" } });
  is("an edit without expected_updated_at is refused", res, 400, "invalid_body");
  check("...naming the field", res.body.field === "expected_updated_at");
  for (const bad of BAD) is(`an edit with an invalid timestamp (${JSON.stringify(bad)})`, await H.call(O, "PATCH", `${REL}/[id]/sessions/[sid]`, { params: { id: pid, sid: a }, body: { title_en: "A2", expected_updated_at: bad } }), 400, "invalid_body");
  is("an edit with a stale timestamp", await H.call(O, "PATCH", `${REL}/[id]/sessions/[sid]`, { params: { id: pid, sid: a }, body: { title_en: "A2", expected_updated_at: "2020-01-01T00:00:00Z" } }), 409, "stale");
  check("...none of those changed anything", (await order(pid)) === "A,B,C");
  const old = await stamp.s(a);
  res = await editSession(O, pid, a, { title_en: "A2", note_en: "A note" });
  is("an edit with the current timestamp", res, 200, "ok");
  check("...saved, with a new timestamp", res.body.session.title_en === "A2" && res.body.session.updated_at !== old);
  is("the previous timestamp is now stale", await H.call(O, "PATCH", `${REL}/[id]/sessions/[sid]`, { params: { id: pid, sid: a }, body: { title_en: "A3", expected_updated_at: old } }), 409, "stale");
  res = await editSession(O, pid, a, { title_en: null, title_fr: null });
  is("a session cannot be left without any title", res, 422, "session_needs_title");
  // move
  res = await move(O, pid, c, "up");
  is("move C up", res, 200, "ok");
  check("...A2, C, B", res.body.moved === true && (await order(pid)) === "A2,C,B");
  res = await move(O, pid, a, "up");
  check("moving the first session up does nothing (moved: false)", res.status === 200 && res.body.moved === false && (await order(pid)) === "A2,C,B");
  res = await move(O, pid, b, "down");
  check("moving the last session down does nothing", res.status === 200 && res.body.moved === false);
  is("a bad direction is refused", await move(O, pid, b, "sideways"), 400, "invalid_direction");
  is("moving an unknown session is not found", await move(O, pid, F.id("e", 990), "up"), 404, "not_found");
  eq("positions stay unique and gap-free after moves", (await H.rows(`select position from public.bible_program_sessions where program_id = '${pid}' order by position`)).map((x) => x.position), [1, 2, 3]);
  // delete
  const dBad = [["without a timestamp", ""], ["with an invalid timestamp", "?expected_updated_at=nope"], ["with a repeated timestamp", "?expected_updated_at=2020-01-01T00:00:00Z&expected_updated_at=2020-01-02T00:00:00Z"], ["with an extra query key", `?expected_updated_at=${encodeURIComponent(await stamp.s(b))}&x=1`]];
  for (const [what, url] of dBad) {
    const code = what === "with an extra query key" ? "unexpected_field" : "invalid_body";
    is(`delete ${what} is refused`, await H.call(O, "DELETE", `${REL}/[id]/sessions/[sid]`, { params: { id: pid, sid: b }, url }), 400, code);
  }
  is("delete with a stale timestamp", await H.call(O, "DELETE", `${REL}/[id]/sessions/[sid]`, { params: { id: pid, sid: b }, url: "?expected_updated_at=2020-01-01T00:00:00Z" }), 409, "stale");
  check("...nothing was deleted", (await order(pid)) === "A2,C,B");
  is("delete with the current timestamp", await delSession(O, pid, b), 200, "ok");
  eq("...A2, C remain", await order(pid), "A2,C");
  // ids that do not match
  const other = await mkProgram(O, { title_en: "Other programme" });
  is("a session addressed through another programme is not found", await H.call(O, "PATCH", `${REL}/[id]/sessions/[sid]`, { params: { id: other, sid: a }, body: { title_en: "x", expected_updated_at: await stamp.s(a) } }), 404, "not_found");
  is("...also for delete", await H.call(O, "DELETE", `${REL}/[id]/sessions/[sid]`, { params: { id: other, sid: a }, url: `?expected_updated_at=${encodeURIComponent(await stamp.s(a))}` }), 404, "not_found");
  is("...and for move", await move(O, other, a, "up"), 404, "not_found");
  is("a malformed id is not found", await H.call(O, "PATCH", `${REL}/[id]/sessions/[sid]`, { params: { id: pid, sid: "x' or '1'='1" }, body: { title_en: "x", expected_updated_at: "2027-01-01T00:00:00Z" } }), 404, "not_found");
  // a live programme keeps at least one session
  const live = await mkProgram(O, { title_en: "Live one" });
  const only = (await mkSession(O, live, { title_en: "Only" })).body.id;
  is("publish the programme", await pub(O, live), 200, "ok");
  is("the last session of a LIVE programme cannot be deleted", await delSession(O, live, only), 409, "last_session");
  const second = (await mkSession(O, live, { title_en: "Second" }));
  is("a session can be added to a live programme by the publisher", second, 201, "ok");
  is("...and then one can be deleted", await delSession(O, live, only), 200, "ok");
  // the 400 cap
  const big = await mkProgram(O, { title_en: "Big" });
  await F.svc(H.db, `insert into public.bible_program_sessions (profile_id, program_id, position, title_en) select '${prof.c1}', '${big}', g, 'D' || g from generate_series(1, 400) g`);
  is("the 401st session is refused", await mkSession(O, big, { title_en: "Too many" }), 422, "session_limit");
  const bigDetail = await H.call(O, "GET", `${REL}/[id]`, { params: { id: big } });
  check("a programme of 400 sessions is returned whole", bigDetail.status === 200 && bigDetail.body.sessions.length === 400);
  check("the service-role client was never used", globalThis.__adminClientCalls === 0);
}

// =================================================================================================================================================================
section("D. permissions: ");
// =================================================================================================================================================================
{
  await H.fresh(EXTRA);
  const draft = await mkProgram();
  const dSession = (await mkSession(O, draft, { title_en: "D1" })).body.id;
  const live = await mkProgram(O, { title_en: "Live programme" });
  const lSession = (await mkSession(O, live, { title_en: "L1" })).body.id;
  await mkSession(O, live, { title_en: "L2" });
  await pub(O, live);
  // view only
  let res = await H.call(bv, "GET", REL);
  check("view only: reads the list, drafts included", res.status === 200 && res.body.total === 2);
  res = await H.call(bv, "GET", `${REL}/[id]`, { params: { id: draft } });
  check("view only: reads a draft with its sessions and the counts; every right is off", res.status === 200 && res.body.sessions.length === 1 && res.body.stats !== null && res.body.can.edit === false && res.body.can.sessions === false && res.body.can.publish === false);
  for (const [n, rr] of [
    ["create", await H.call(bv, "POST", REL, { body: { title_en: "x" } })],
    ["edit", await H.call(bv, "PATCH", `${REL}/[id]`, { params: { id: draft }, body: { title_en: "x", expected_updated_at: await stamp.p(draft) } })],
    ["publish", await pub(bv, draft)],
    ["delete", await H.call(bv, "DELETE", `${REL}/[id]`, { params: { id: draft }, url: `?expected_updated_at=${encodeURIComponent(await stamp.p(draft))}` })],
    ["add a session", await mkSession(bv, draft)],
    ["edit a session", await editSession(bv, draft, dSession, { title_en: "x" })],
    ["delete a session", await delSession(bv, draft, dSession)],
    ["move a session", await move(bv, draft, dSession, "down")],
  ]) is(`view only cannot ${n}`, rr, 403, "forbidden");
  // manage: drafts only
  res = await H.call(bm, "POST", REL, { body: { title_en: "By writer" } });
  is("manage: creates a draft programme", res, 201, "ok");
  const mine = res.body.id;
  is("manage: adds sessions to a draft", await mkSession(bm, mine, { title_en: "M1" }), 201, "ok");
  const mSession = (await mkSession(bm, mine, { title_en: "M2" })).body.id;
  is("manage: edits a session of a draft", await editSession(bm, mine, mSession, { title_en: "M2 edited" }), 200, "ok");
  is("manage: moves a session of a draft", await move(bm, mine, mSession, "up"), 200, "ok");
  is("manage: deletes a session of a draft", await delSession(bm, mine, mSession), 200, "ok");
  is("manage: CANNOT publish", await pub(bm, mine), 403, "forbidden");
  is("manage: CANNOT unpublish", await unpub(bm, live), 403, "forbidden");
  is("manage: CANNOT edit a LIVE programme", await H.call(bm, "PATCH", `${REL}/[id]`, { params: { id: live }, body: { title_en: "Vandal", expected_updated_at: await stamp.p(live) } }), 403, "publish_required");
  is("manage: CANNOT delete a LIVE programme", await H.call(bm, "DELETE", `${REL}/[id]`, { params: { id: live }, url: `?expected_updated_at=${encodeURIComponent(await stamp.p(live))}` }), 403, "publish_required");
  is("manage: CANNOT add a session to a LIVE programme", await mkSession(bm, live, { title_en: "Vandal" }), 403, "publish_required");
  is("manage: CANNOT edit a session of a LIVE programme", await editSession(bm, live, lSession, { title_en: "Vandal" }), 403, "publish_required");
  is("manage: CANNOT delete a session of a LIVE programme", await delSession(bm, live, lSession), 403, "publish_required");
  is("manage: CANNOT move a session of a LIVE programme", await move(bm, live, lSession, "down"), 403, "publish_required");
  check("...the live programme is untouched", (await H.rows(`select title_en from public.bible_programs where id = '${live}'`))[0].title_en === "Live programme" && (await order(live)) === "L1,L2");
  res = await H.call(bm, "GET", `${REL}/[id]`, { params: { id: live } });
  check("manage: sees a live programme but every right is off", res.status === 200 && res.body.can.edit === false && res.body.can.sessions === false && res.body.can.unpublish === false);
  // publish permission
  is("publish: edits a live programme", await H.call(bp, "PATCH", `${REL}/[id]`, { params: { id: live }, body: { title_en: "Corrected", expected_updated_at: await stamp.p(live) } }), 200, "ok");
  is("publish: edits a session of a live programme", await editSession(bp, live, lSession, { title_en: "L1 corrected" }), 200, "ok");
  is("publish: moves a session of a live programme", await move(bp, live, lSession, "down"), 200, "ok");
  is("publish: unpublishes", await unpub(bp, live), 200, "ok");
  is("publish: publishes", await pub(bp, live), 200, "ok");
  // everyone else
  for (const [who, tag] of [[u.plain1, "staff without the permission"], [u.mgr1, "a church administrator without the permission"], [u.viewer1, "a People viewer"], [evOnly, "an events publisher"], [u.stranger, "a stranger"], [u.leader1, "a group leader (roster record only)"], [u.admin, "a platform admin with no relationship"], [adminPub, "a platform admin holding publish as a team member"]]) {
    is(`${tag}: cannot list`, await H.call(who, "GET", REL), 403, "forbidden");
    is(`${tag}: cannot create`, await H.call(who, "POST", REL, { body: { title_en: "x" } }), 403, "forbidden");
    is(`${tag}: cannot read a programme`, await H.call(who, "GET", `${REL}/[id]`, { params: { id: live } }), 403, "forbidden");
    is(`${tag}: cannot add a session`, await mkSession(who, draft), 403, "forbidden");
  }
  is("nobody signed in: 401", await H.call(null, "GET", REL), 401, "not_signed_in");
  is("a write without JSON is refused (415)", await H.call(O, "POST", REL, { headers: { "content-type": "text/plain" }, raw: "x" }), 415, "invalid_body");
  check("the service-role client was never used", globalThis.__adminClientCalls === 0);
}

// =================================================================================================================================================================
section("E. cross-church isolation and participants: ");
// =================================================================================================================================================================
{
  await H.fresh(EXTRA);
  const p1 = await mkProgram();
  const s1 = (await mkSession(O, p1, { title_en: "One" })).body.id;
  await pub(O, p1);
  const p2 = await mkProgram(u.owner2, { title_en: "Other church" });
  await mkSession(u.owner2, p2, { title_en: "Theirs" });
  const snap = async () => JSON.stringify(await H.rows("select id, title_en, status, updated_at::text from public.bible_programs order by id")) + JSON.stringify(await H.rows("select id, title_en, position from public.bible_program_sessions order by id"));
  const before = await snap();
  for (const [n, rr] of [
    ["detail", await H.call(u.owner2, "GET", `${REL}/[id]`, { params: { id: p1 } })],
    ["edit", await H.call(u.owner2, "PATCH", `${REL}/[id]`, { params: { id: p1 }, body: { title_en: "Hijack", expected_updated_at: await stamp.p(p1) } })],
    ["delete", await H.call(u.owner2, "DELETE", `${REL}/[id]`, { params: { id: p1 }, url: `?expected_updated_at=${encodeURIComponent(await stamp.p(p1))}` })],
    ["unpublish", await unpub(u.owner2, p1)],
    ["add a session", await mkSession(u.owner2, p1, { title_en: "Planted" })],
    ["edit a session", await editSession(u.owner2, p1, s1, { title_en: "Hijack" })],
    ["delete a session", await delSession(u.owner2, p1, s1)],
    ["move a session", await move(u.owner2, p1, s1, "down")],
  ]) is(`other church's owner: ${n} -> not found`, rr, 404, "not_found");
  check("nothing of church 1 changed", (await snap()) === before);
  const list = await H.call(u.owner2, "GET", REL);
  check("their list holds only their own programme", list.body.total === 1 && list.body.items[0].id === p2);
  // participants: counts only
  const join = async (c) => { await F.svc(H.db, `insert into public.bible_enrollments (profile_id, program_id, customer_id) values ('${prof.c1}','${p1}','${CU(c)}')`); return (await H.rows(`select id::text as i from public.bible_enrollments where customer_id = '${CU(c)}'`))[0].i; };
  const e1 = await join(1);
  await F.svc(H.db, `insert into public.bible_session_progress (enrollment_id, program_id, session_id) values ('${e1}','${p1}','${s1}')`);
  let res = await H.call(O, "GET", `${REL}/[id]`, { params: { id: p1 } });
  check("one participant: the number is shown, the per-session numbers are withheld", res.body.stats.enrolled === 1 && res.body.stats.detailed === false && res.body.stats.sessions.every((x) => x.completed === null), JSON.stringify(res.body.stats));
  const e2 = await join(2), e3 = await join(3);
  await F.svc(H.db, `insert into public.bible_session_progress (enrollment_id, program_id, session_id) values ('${e2}','${p1}','${s1}'), ('${e3}','${p1}','${s1}')`);
  res = await H.call(O, "GET", `${REL}/[id]`, { params: { id: p1 } });
  check("three participants: counts per session", res.body.stats.enrolled === 3 && res.body.stats.detailed === true && res.body.stats.sessions[0].completed === 3, JSON.stringify(res.body.stats));
  const dump = JSON.stringify([res.body, (await H.call(O, "GET", REL)).body]);
  check("no response names or identifies a participant", !/customer|enrollment|email|ringo_customers/i.test(dump) && !new RegExp(CU(1)).test(dump));
  res = await H.call(O, "DELETE", `${REL}/[id]`, { params: { id: p1 }, url: `?expected_updated_at=${encodeURIComponent(await stamp.p(p1))}` });
  is("a programme with participants cannot be deleted (a clear code)", res, 409, "program_has_participants");
  check("...nothing of it, nor of the participants' progress, was lost", (await H.rows("select count(*)::int as n from public.bible_programs where id = '" + p1 + "'"))[0].n === 1 && (await H.rows("select count(*)::int as n from public.bible_session_progress"))[0].n === 3);
  res = await unpub(O, p1);
  is("it can be unpublished instead", res, 200, "ok");
  check("...and the participants' progress is kept", (await H.rows("select count(*)::int as n from public.bible_session_progress"))[0].n === 3);
  // a participant's data is unreachable through every staff route and the generic API
  for (const t of ["bible_enrollments", "bible_session_progress"]) {
    const x = await F.sessionFor(H.db, O).from(t).select("id");
    check(`the owner cannot read ${t} through the API either`, !!x.error && x.error.code === "42501");
  }
}

// =================================================================================================================================================================
section("F. the code itself: ");
// =================================================================================================================================================================
{
  const rd = (p) => fs.readFileSync(path.join(SRC, p), "utf8");
  const code = rd("lib/church/bible/handlers.ts").replace(/\/\/[^\n]*/g, "");
  check("staff handlers: no service-role client, no raw SQL, no eval", !/createAdminClient|service_role|eval\(|new Function/.test(code));
  check("staff handlers: they never touch the private tables or the visitor accounts", !/bible_enrollments|bible_session_progress|ringo_customers|customer_id/.test(code));
  check("staff handlers: the only RPCs are the stats and the move", [...code.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort().join() === "bible_program_stats,bible_session_move");
  check("staff handlers: the church always comes from the actor, never from a request", (code.match(/profile_id: a\.profileId/g) || []).length >= 1 && !/params\.get\("profile_id"\)|body\.profile_id/.test(code));
  check("staff handlers: sessions need expected_updated_at to be edited or deleted", /expected_updated_at/.test(code) && (code.match(/\.eq\("updated_at"/g) || []).length >= 2);
  for (const sub of ["route.ts", "[id]/route.ts", "[id]/publish/route.ts", "[id]/unpublish/route.ts", "[id]/sessions/route.ts", "[id]/sessions/[sid]/route.ts", "[id]/sessions/[sid]/move/route.ts"]) {
    const route = rd(`app/api/church/bible/${sub}`);
    check(`bible/${sub}: goes through churchRoute, never takes a church from the request, dynamic and uncached`, /churchRoute\(/.test(route) && !/profile_id|profileId/.test(route.replace(/\/\/[^\n]*/g, "")) && /export const dynamic = "force-dynamic"/.test(route));
  }
}

console.error = realConsoleError;
await H.close();
process.exit(summary());
