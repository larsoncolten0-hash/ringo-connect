// Churches & Ministries Phase 8: the Church Music back end, validated end to end and OFFLINE.
// The REAL route files (src/app/api/church/music/**), the REAL handlers, validation, error mapping and actor resolution run against scratch in-memory PostgreSQL (PGlite) that holds the REAL Team
// migrations, the REAL Phase 2A church migration and the REAL Phase 8 migration. See scripts/tests/ministryApiHarness.mjs.
//   Run:  node scripts/tests/ministryMusicApi.test.mjs
import path from "path";
import { createHarness, kit, SRC } from "./ministryApiHarness.mjs";

const H = await createHarness({ music: true });
const { F, jiti } = H;
const { u, prof } = F;
const { check, eq, is, section, summary } = kit();
console.error = () => {};

const MH = jiti(path.join(SRC, "lib/church/music/handlers.ts"));
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const ERR = jiti(path.join(SRC, "lib/church/errors.ts"));

const mu = F.id("c", 90), noPerm = F.id("c", 91), adminMgr = F.id("c", 92);
const R = { manage: F.id("b", 90), other: F.id("b", 91), adminMgr: F.id("b", 92) };
const EXTRA = `
  insert into public.users (id, role, plan_id) values ('${mu}','user','${F.plan.free}'), ('${noPerm}','user','${F.plan.free}'), ('${adminMgr}','admin','${F.plan.free}');
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${R.manage}','${prof.c1}','mmanage','Music manager','{church.music.manage}'),
    ('${R.other}','${prof.c1}','mother','Events publisher','{church.events.publish}'),
    ('${R.adminMgr}','${prof.c1}','madmin','Admin holding music','{church.music.manage}');
  insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${mu}','${R.manage}'), ('${prof.c1}','${noPerm}','${R.other}'), ('${prof.c1}','${adminMgr}','${R.adminMgr}');
`;
const O = u.owner1;
const list = (who) => H.call(who, "GET", "church/music");
const add = (who, body) => H.call(who, "POST", "church/music", { body });
const edit = (who, id, body) => H.call(who, "PATCH", "church/music/[id]", { params: { id }, body });
const del = (who, id, stamp) => H.call(who, "DELETE", "church/music/[id]", { params: { id }, url: stamp === undefined ? "" : `?expected_updated_at=${encodeURIComponent(stamp)}` });
const SP = (n = 1, o = {}) => ({ platform: "spotify", title: `Worship ${n}`, url: `https://open.spotify.com/playlist/${n}`, ...o });
const count = async () => (await H.rows("select count(*)::int as n from public.ministry_music_links"))[0].n;

section("A. input validation (pure): ");
{
  const P = MH.parseMusicBody;
  check("create: a valid link", P(SP(), "create").ok);
  check("create: platform, title and url are required", ["platform", "title", "url"].every((f) => { const b = SP(); delete b[f]; return !P(b, "create").ok; }));
  check("platform must be a known one", P(SP(1, { platform: "napster" }), "create").code === "invalid_platform");
  check("title: empty / too long refused", P(SP(1, { title: "  " }), "create").code === "invalid_title" && P(SP(1, { title: "x".repeat(81) }), "create").code === "invalid_title");
  check("url: http, javascript:, data:, credentials, localhost, raw IP, spaces refused", ["http://open.spotify.com/x", "javascript:alert(1)", "data:text/html,x", "https://u:p@open.spotify.com/x", "https://localhost/x", "https://10.0.0.1/x", "https://open.spotify.com/a b"].every((url) => P(SP(1, { url }), "create").code === "invalid_url"));
  check("is_visible must be a boolean; sort_order a whole number 0..1000", P(SP(1, { is_visible: "yes" }), "create").code === "invalid_body" && P(SP(1, { sort_order: -1 }), "create").code === "invalid_sort_order" && P(SP(1, { sort_order: 1.5 }), "create").code === "invalid_sort_order" && P(SP(1, { sort_order: 1001 }), "create").code === "invalid_sort_order");
  check("no other field is accepted (church, owner, audit, id)", ["profile_id", "id", "created_by", "updated_by", "status"].every((f) => P(SP(1, { [f]: "x" }), "create").code === "unexpected_field"));
  check("create refuses expected_updated_at (it is for edits)", P(SP(1, { expected_updated_at: "2026-01-01T00:00:00Z" }), "create").code === "unexpected_field");
  check("update: empty change refused; a bad version refused", P({}, "update").code === "empty_update" && P({ expected_updated_at: "2026-01-01T00:00:00Z" }, "update").code === "empty_update" && P({ title: "x", expected_updated_at: "soon" }, "update").code === "invalid_body");
  check("update: only the fields sent are returned", JSON.stringify(Object.keys(P({ is_visible: false }, "update").value)) === '["is_visible"]');
  check("not an object", P(null, "create").code === "invalid_body" && P([], "create").code === "invalid_body" && P("x", "create").code === "invalid_body");
  const M = MH.urlMatchesPlatform;
  check("platform/address pairs: right domain accepted", M("spotify", "https://open.spotify.com/x") && M("youtube", "https://youtu.be/x") && M("youtube", "https://www.youtube.com/@c") && M("youtube_music", "https://music.youtube.com/x") && M("bandcamp", "https://band.bandcamp.com/x") && M("apple_music", "https://music.apple.com/x"));
  check("platform/address pairs: wrong or look-alike domain refused", !M("spotify", "https://open.youtube.com/x") && !M("spotify", "https://evilspotify.com/x") && !M("spotify", "https://spotify.com.evil.org/x") && !M("youtube_music", "https://www.youtube.com/x") && !M("napster", "https://napster.com/x"));
  check("website and other accept any secure address", M("website", "https://example.org/x") && M("other", "https://example.org/x"));
  check("capability: manageMusic only from church.music.manage", PERM.churchCapabilities(["church.music.manage"]).manageMusic === true && PERM.churchCapabilities(["church.events.publish", "church.members.manage"]).manageMusic === false);
  check("the string is a registered church permission and SENSITIVE (owner-only to grant)", PERM.CHURCH_PERMISSIONS.includes("church.music.manage") && PERM.isSensitiveChurchPermissionName("church.music.manage"));
  const cls = (message, code = "23514") => ERR.classifyDbError({ message, code });
  check("db codes: limit, same address, bad address / label / platform, wrong profile", cls("music_link_limit").code === "music_link_limit" && cls("duplicate key value violates unique constraint \"ministry_music_links_profile_url_key\"", "23505").code === "link_exists" && cls("new row violates check constraint \"ministry_music_links_url_check\"").code === "invalid_url" && cls("ministry_music_links_title_check").code === "invalid_title" && cls("ministry_music_links_platform_check").code === "invalid_platform" && cls("music_profile_required").status === 403 && cls("music_tenant_immutable").status === 422);
}

section("B. permissions: ");
{
  await H.fresh(EXTRA);
  is("anonymous: 401", await list(null), 401);
  is("anonymous cannot add: 401", await add(null, SP()), 401);
  is("a stranger: 403", await list(u.stranger), 403);
  is("a staff member without the permission: 403", await list(noPerm), 403);
  is("...cannot add: 403", await add(noPerm, SP()), 403);
  is("the church owner can list", await list(O), 200, "ok");
  is("a manager can list", await list(mu), 200, "ok");
  is("a platform admin who is not the owner: 403", await list(adminMgr), 403);
  is("...cannot add either", await add(adminMgr, SP()), 403);
  is("a stranger cannot add: 403", await add(u.stranger, SP()), 403);
  is("a GET with an unknown query parameter: 400", await H.call(O, "GET", "church/music?church=x"), 400, "unexpected_field");
  eq("nothing was written by the refusals", await count(), 0);
  const noJson = await H.call(O, "POST", "church/music", { raw: "x", headers: { "content-type": "text/plain" } });
  check("a POST that is not JSON: 415", noJson.status === 415);
}

section("C. create, edit, hide, delete: ");
{
  await H.fresh(EXTRA);
  const c1 = await add(O, SP(1));
  is("the owner adds a link", c1, 201, "ok");
  check("the church comes from the session, the answer holds no audit or church field", c1.body.item && !("created_by" in c1.body.item) && !("profile_id" in c1.body.item) && c1.body.item.is_visible === true);
  const id1 = c1.body.item.id;
  is("a manager adds a link", await add(mu, SP(2, { platform: "youtube", url: "https://www.youtube.com/@choir", title: "Choir" })), 201, "ok");
  is("the wrong platform for the address: 422", await add(O, SP(3, { platform: "youtube" })), 422, "url_platform_mismatch");
  is("the same address twice: 409 link_exists", await add(O, SP(1)), 409, "link_exists");
  is("the same address in another case: 409", await add(O, SP(1, { url: "https://OPEN.SPOTIFY.COM/playlist/1" })), 409, "link_exists");
  is("a bad address: 400", await add(O, SP(4, { url: "http://open.spotify.com/x" })), 400, "invalid_url");
  eq("only two links exist", await count(), 2);
  const l = await list(O);
  eq("the list holds both, in order, no audit field", [l.body.items.length, l.body.items.every((x) => !("created_by" in x))], [2, true]);
  const st = l.body.items.find((x) => x.id === id1).updated_at;

  is("edit without the version: 400", await edit(O, id1, { title: "New" }), 400, "invalid_body");
  is("edit with a bad version: 400", await edit(O, id1, { title: "New", expected_updated_at: "soon" }), 400, "invalid_body");
  is("edit with an old version: 409 stale", await edit(O, id1, { title: "New", expected_updated_at: "2020-01-01T00:00:00Z" }), 409, "stale");
  const e1 = await edit(mu, id1, { title: "Renamed", expected_updated_at: st });
  is("a manager renames it", e1, 200, "ok");
  is("the old version is now stale: 409", await edit(O, id1, { title: "Again", expected_updated_at: st }), 409, "stale");
  const st2 = e1.body.item.updated_at;
  is("hiding a link", await edit(O, id1, { is_visible: false, expected_updated_at: st2 }), 200, "ok");
  eq("it is stored hidden", (await H.rows(`select is_visible from public.ministry_music_links where id = '${id1}'`))[0].is_visible, false);
  const st3 = await H.stamp("ministry_music_links", id1);
  is("changing only the platform to one the stored address does not match: 422", await edit(O, id1, { platform: "youtube", expected_updated_at: st3 }), 422, "url_platform_mismatch");
  is("changing platform and address together is fine", await edit(O, id1, { platform: "youtube", url: "https://youtu.be/abc123", expected_updated_at: st3 }), 200, "ok");
  is("unknown field in an edit: 400", await edit(O, id1, { profile_id: prof.c3, expected_updated_at: await H.stamp("ministry_music_links", id1) }), 400, "unexpected_field");
  is("a malformed id: 404", await edit(O, "nope", { title: "x", expected_updated_at: st3 }), 404, "not_found");
  is("an unknown id: 404", await edit(O, F.id("6", 999), { title: "x", expected_updated_at: st3 }), 404, "not_found");
  is("a member without the permission cannot edit: 403", await edit(noPerm, id1, { title: "x", expected_updated_at: await H.stamp("ministry_music_links", id1) }), 403);
  is("a platform admin who is not the owner cannot edit: 403", await edit(adminMgr, id1, { title: "x", expected_updated_at: await H.stamp("ministry_music_links", id1) }), 403);

  is("delete without the version: 400", await del(O, id1), 400, "invalid_body");
  is("delete with an old version: 409", await del(O, id1, "2020-01-01T00:00:00Z"), 409, "stale");
  is("a member without the permission cannot delete: 403", await del(noPerm, id1, await H.stamp("ministry_music_links", id1)), 403);
  eq("...nothing deleted", await count(), 2);
  is("delete with an extra query parameter: 400", await H.call(O, "DELETE", "church/music/[id]", { params: { id: id1 }, url: `?expected_updated_at=${encodeURIComponent(await H.stamp("ministry_music_links", id1))}&x=1` }), 400, "unexpected_field");
  is("the manager deletes it", await del(mu, id1, await H.stamp("ministry_music_links", id1)), 200, "ok");
  is("deleting it again: 404", await del(O, id1, st3), 404, "not_found");
  eq("one link is left", await count(), 1);
}

section("D. limit, isolation, visibility: ");
{
  await H.fresh(EXTRA);
  for (let i = 1; i <= 20; i++) await H.rows(`insert into public.ministry_music_links (profile_id, platform, title, url) values ('${prof.c1}','website','L${i}','https://example.org/${i}')`);
  is("the 21st link: 422 music_link_limit", await add(O, SP(99)), 422, "music_link_limit");
  eq("still 20", await count(), 20);
  await H.rows(`insert into public.ministry_music_links (id, profile_id, platform, title, url) values ('${F.id("6", 701)}','${prof.c2}','website','Other church','https://example.org/other')`);
  const mine = await list(O);
  check("the list never shows another church's link", mine.body.items.length === 20 && mine.body.items.every((x) => x.title !== "Other church"));
  is("editing another church's link by id: 404", await edit(O, F.id("6", 701), { title: "x", expected_updated_at: await H.stamp("ministry_music_links", F.id("6", 701)) }), 404, "not_found");
  is("deleting another church's link by id: 404", await del(O, F.id("6", 701), await H.stamp("ministry_music_links", F.id("6", 701))), 404, "not_found");
  const other = await add(u.owner2, SP(1));
  is("a church that is not a church_ministries primary profile... owner 2 can add to its own church", other, 201, "ok");
  eq("it landed in owner 2's church", (await H.rows(`select profile_id from public.ministry_music_links where id = '${other.body.item.id}'`))[0].profile_id, prof.c2);
}

section("E. the responses never leak the database: ");
{
  await H.fresh(EXTRA);
  const seen = [];
  seen.push(await add(O, SP(1)), await add(O, SP(1)), await add(O, SP(2, { url: "http://x.org" })), await add(noPerm, SP(5)), await edit(O, F.id("6", 999), { title: "x", expected_updated_at: "2020-01-01T00:00:00Z" }));
  const text = JSON.stringify(seen.map((x) => x.body));
  check("no table, policy, trigger or constraint name appears in any answer", !/ministry_music|policy|trigger|violates|constraint|pg_|supabase|church.music.manage/i.test(text), text.slice(0, 300));
}

await H.close();
process.exit(summary());
