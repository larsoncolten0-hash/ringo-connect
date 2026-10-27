// Churches & Ministries expansion, Phase 3: the public group pages, group photos, Pastors page and group-only announcements, validated end to end and OFFLINE.
// The REAL route files (src/app/api/church/public-groups/**, pastors/**, about, announcements/**), the REAL handlers, validation, error mapping and actor resolution run against scratch in-memory
// PostgreSQL (PGlite) that holds the REAL Team migrations and the REAL church migrations up to Phase 3 of the expansion. See scripts/tests/ministryApiHarness.mjs.
//   Run:  node scripts/tests/churchGroupsPastorsApi.test.mjs
import path from "path";
import { createHarness, kit, SRC } from "./ministryApiHarness.mjs";

const H = await createHarness({ dailyWords: true, events: true, attendance: true, bible: true, music: true, care: true, testimonies: true, landing: true, groupsPastors: true });
const { F, jiti } = H;
const { u, prof } = F;
const { check, eq, is, section, summary } = kit();
console.error = () => {};

const GH = jiti(path.join(SRC, "lib/church/pubgroups/handlers.ts"));
const PG = jiti(path.join(SRC, "lib/church/public/groups.ts"));
const PE = jiti(path.join(SRC, "lib/church/public/events.ts"));
const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));
const MODS = jiti(path.join(SRC, "lib/church/modules.ts"));
const ERR = jiti(path.join(SRC, "lib/church/errors.ts"));

const pm = F.id("c", 95), eventsMgr = F.id("c", 96);
const R = { pastor: F.id("b", 95), events: F.id("b", 96) };
const EXTRA = `
  insert into public.users (id, role, plan_id) values ('${pm}','user','${F.plan.free}'), ('${eventsMgr}','user','${F.plan.free}');
  insert into public.organization_roles (id, profile_id, key, name, permissions) values
    ('${R.pastor}','${prof.c1}','pastormgr','Pastor page manager','{church.pastors.manage}'),
    ('${R.events}','${prof.c1}','evmgr','Events publisher','{church.events.publish}');
  insert into public.organization_members (profile_id, user_id, role_id) values ('${prof.c1}','${pm}','${R.pastor}'), ('${prof.c1}','${eventsMgr}','${R.events}');
`;
const O = u.owner1, GM = u.grpMgr1;
const IMG = (n = 1) => `https://example.supabase.co/storage/v1/object/public/uploads/u1/church/p${n}.jpg`;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";

const groups = (who) => H.call(who, "GET", "church/public-groups");
const addGroup = (who, body) => H.call(who, "POST", "church/public-groups", { body });
const editGroup = (who, id, body) => H.call(who, "PATCH", "church/public-groups/[id]", { params: { id }, body });
const delGroup = (who, id, stamp) => H.call(who, "DELETE", "church/public-groups/[id]", { params: { id }, url: stamp === undefined ? "" : `?expected_updated_at=${encodeURIComponent(stamp)}` });
const photos = (who, id) => H.call(who, "GET", "church/public-groups/[id]/photos", { params: { id } });
const addPhoto = (who, id, body) => H.call(who, "POST", "church/public-groups/[id]/photos", { params: { id }, body });
const delPhoto = (who, id, pid, stamp) => H.call(who, "DELETE", "church/public-groups/[id]/photos/[photoId]", { params: { id, photoId: pid }, url: `?expected_updated_at=${encodeURIComponent(stamp)}` });
const pastors = (who) => H.call(who, "GET", "church/pastors");
const addPastor = (who, body) => H.call(who, "POST", "church/pastors", { body });
const editPastor = (who, id, body) => H.call(who, "PATCH", "church/pastors/[id]", { params: { id }, body });
const delPastor = (who, id, stamp) => H.call(who, "DELETE", "church/pastors/[id]", { params: { id }, url: `?expected_updated_at=${encodeURIComponent(stamp)}` });
const getAbout = (who) => H.call(who, "GET", "church/about");
const putAbout = (who, body) => H.call(who, "PUT", "church/about", { body });
const addAnn = (who, body) => H.call(who, "POST", "church/announcements", { body });
const count = async (t) => (await H.rows(`select count(*)::int as n from public.${t}`))[0].n;

section("A. input validation (pure): ");
{
  const P = (b, m = "create") => GH.parsePublicGroup ? GH.parsePublicGroup(b, m) : null;
  check("kinds: exactly Men, Women, Youths, Children", JSON.stringify(GH.PUBLIC_GROUP_KINDS) === '["men","women","youths","children"]' && GH.isPublicGroupKind("men") && !GH.isPublicGroupKind("elders") && !GH.isPublicGroupKind(null));
  check("limits: 12 photos, 12 pastors", GH.GROUP_PHOTO_LIMIT === 12 && GH.PASTOR_LIMIT === 12);
  check("capability: managePastors only from church.pastors.manage; viewGroups from groups.view or manage", PERM.churchCapabilities(["church.pastors.manage"]).managePastors === true && PERM.churchCapabilities(["church.groups.view"]).managePastors === false && PERM.churchCapabilities(["church.groups.manage"]).viewGroups === true);
  check("church.pastors.manage is a registered church permission and SENSITIVE (owner-only to grant)", PERM.CHURCH_PERMISSIONS.includes("church.pastors.manage") && PERM.isSensitiveChurchPermissionName("church.pastors.manage"));
  const caps = (p) => PERM.churchCapabilities(p);
  const keys = (c, owner = false) => MODS.accessibleChurchModules(c, owner).map((m) => m.key);
  check("module list: Group pages need group access, Pastors need church.pastors.manage", keys(caps(["church.groups.view"])).includes("pubgroups") && !keys(caps(["church.groups.view"])).includes("pastors") && keys(caps(["church.pastors.manage"])).join() === "pastors");
  check("module list: the owner (all permissions) sees both, the Store only for the owner", keys(caps(PERM.CHURCH_PERMISSIONS), true).includes("pastors") && keys(caps(PERM.CHURCH_PERMISSIONS), true).includes("store") && !keys(caps(PERM.CHURCH_PERMISSIONS), false).includes("store"));
  const cls = (message, code = "23514") => ERR.classifyDbError({ message, code });
  check("db codes: children caption, photo limit, one group per kind, locked audience", cls("church_children_photo_caption").code === "children_photo_caption" && cls("church_group_photo_limit").code === "photo_limit"
    && cls("duplicate key value violates unique constraint \"church_public_groups_kind_key\"", "23505").code === "group_exists" && cls("church_group_locked").code === "unpublish_first");
  void P;
}

section("B. permissions: ");
{
  await H.fresh(EXTRA);
  is("anonymous: 401", await groups(null), 401);
  is("a stranger: 403", await groups(u.stranger), 403);
  is("a members-only viewer cannot list group pages: 403", await groups(u.viewer1), 403);
  is("a groups manager can list", await groups(GM), 200, "ok");
  is("an events publisher can list (to choose an audience)", await groups(eventsMgr), 200, "ok");
  is("...but cannot create a group page: 403", await addGroup(eventsMgr, { kind: "men" }), 403);
  is("the owner can list pastors", await pastors(O), 200, "ok");
  is("a pastor-page manager can list pastors", await pastors(pm), 200, "ok");
  is("a groups manager cannot list pastors: 403", await pastors(GM), 403);
  is("an events publisher cannot read the vision and mission: 403", await getAbout(eventsMgr), 403);
  is("a pastor-page manager cannot create a group page: 403", await addGroup(pm, { kind: "men" }), 403);
  is("anonymous cannot add a pastor: 401", await addPastor(null, { name: "X" }), 401);
  is("a platform admin who is not the owner: 403", await groups(u.admin), 403);
  is("a plain POST must be JSON: 415", await H.call(O, "POST", "church/public-groups", { raw: "kind=men", headers: { "content-type": "application/x-www-form-urlencoded" } }), 415);
}

section("C. public groups: ");
{
  await H.fresh(EXTRA);
  is("create needs a kind", await addGroup(O, { leader_name: "A" }), 400, "invalid_kind");
  is("an unknown kind is refused", await addGroup(O, { kind: "elders" }), 400, "invalid_kind");
  is("the church and the audit columns are never accepted", await addGroup(O, { kind: "men", profile_id: prof.c2 }), 400, "unexpected_field");
  is("a leader photo must be this platform's storage", await addGroup(O, { kind: "men", leader_photo_url: "https://evil.example.com/x.jpg" }), 400, "invalid_image_url");
  is("a leader name has a limit", await addGroup(O, { kind: "men", leader_name: "x".repeat(81) }), 400, "invalid_leader_name");
  const men = await addGroup(GM, { kind: "men", leader_name: "Pastor Joy", leader_photo_url: IMG(), description_en: "Welcome", is_published: true });
  is("a groups manager creates the Men page", men, 201, "ok");
  const id = men.body.item.id;
  eq("the stored row has the church of the signed-in user", (await H.rows("select profile_id from public.church_public_groups"))[0].profile_id, prof.c1);
  is("a second Men page is refused", await addGroup(O, { kind: "men" }), 409, "group_exists");
  is("the kind never changes (PATCH)", await editGroup(O, id, { kind: "women", expected_updated_at: men.body.item.updated_at }), 400, "unexpected_field");
  is("an edit needs the version: 400", await editGroup(O, id, { leader_name: "Joy" }), 400, "invalid_body");
  const ed = await editGroup(O, id, { leader_name: "Pastor Joy M.", expected_updated_at: men.body.item.updated_at });
  is("an edit with the version works", ed, 200, "ok");
  is("a stale edit is refused: 409", await editGroup(O, id, { leader_name: "Old", expected_updated_at: men.body.item.updated_at }), 409, "stale");
  is("an unknown id: 404", await editGroup(O, F.id("f", 999), { leader_name: "Z", expected_updated_at: ed.body.item.updated_at }), 404);
  is("a bad id: 404", await editGroup(O, "nope", { leader_name: "Z", expected_updated_at: ed.body.item.updated_at }), 404);
  is("a viewer without manage cannot edit: 403", await editGroup(u.viewer1, id, { leader_name: "Z", expected_updated_at: ed.body.item.updated_at }), 403);
  eq("the list shows the page with its fields", (await groups(O)).body.items.map((g) => [g.kind, g.leader_name, g.is_published]), [["men", "Pastor Joy M.", true]]);
  const kids = await addGroup(O, { kind: "children", description_en: "Sunday school", is_published: true });
  is("the Children page is created", kids, 201, "ok");
  is("a photo needs a platform address", await addPhoto(O, kids.body.item.id, { image_url: "http://example.com/a.jpg" }), 400, "invalid_image_url");
  is("a photo needs an address", await addPhoto(O, kids.body.item.id, {}), 400, "invalid_image_url");
  is("a children photo with a caption is refused", await addPhoto(O, kids.body.item.id, { image_url: IMG(2), caption_en: "Little Sam" }), 422, "children_photo_caption");
  const kp = await addPhoto(O, kids.body.item.id, { image_url: IMG(2) });
  is("a children photo without a caption is accepted", kp, 201, "ok");
  const mp = await addPhoto(GM, id, { image_url: IMG(3), caption_en: "Retreat" });
  is("a Men photo may have a caption", mp, 201, "ok");
  is("a photo of an unknown group: 404 or refused", await addPhoto(O, F.id("f", 998), { image_url: IMG(4) }), 409);
  eq("photos list for a group", (await photos(O, id)).body.items.map((p) => p.caption_en), ["Retreat"]);
  is("a photo list for a bad group id: 404", await photos(O, "x"), 404);
  for (let i = 0; i < 11; i++) is(`photo ${i + 2} of 12 accepted`, await addPhoto(O, id, { image_url: IMG(10 + i) }), 201, "ok");
  is("the 13th photo is refused", await addPhoto(O, id, { image_url: IMG(40) }), 422, "photo_limit");
  is("a photo cannot be deleted without its version: 400", await H.call(O, "DELETE", "church/public-groups/[id]/photos/[photoId]", { params: { id, photoId: mp.body.item.id } }), 400);
  is("a photo is deleted with its version", await delPhoto(O, id, mp.body.item.id, mp.body.item.updated_at), 200, "ok");
  is("the same photo again: 404", await delPhoto(O, id, mp.body.item.id, mp.body.item.updated_at), 404);
  is("a photo cannot be deleted through another group's address: 404", await delPhoto(O, kids.body.item.id, (await photos(O, id)).body.items[0].id, (await photos(O, id)).body.items[0].updated_at), 404);
  is("delete the Men page needs its version", await delGroup(O, id), 400);
  is("delete the Men page with a stale version: 409", await delGroup(O, id, men.body.item.updated_at), 409, "stale");
  const cur = (await groups(O)).body.items.find((g) => g.kind === "men");
  is("delete the Men page", await delGroup(O, id, cur.updated_at), 200, "ok");
  check("its photos went with it", (await count("church_group_photos")) === 1);
}

section("D. group-only announcements: ");
{
  await H.fresh(EXTRA);
  const g = (await addGroup(O, { kind: "youths", leader_name: "Bro Paul", is_published: true })).body.item;
  const other = (await addGroup(O, { kind: "women", is_published: false })).body.item;
  const mk = (extra = {}) => ({ title_en: "Youth night", body_en: "Friday 6pm", ...extra });
  const aGroup = await addAnn(eventsMgr, mk({ public_group_id: g.id }));
  is("an events publisher writes a notice for a group", aGroup, 201, "ok");
  check("...and the group is stored", (await H.rows("select public_group_id from public.ministry_announcements"))[0].public_group_id === g.id);
  is("a notice cannot name a bad group id", await addAnn(eventsMgr, mk({ public_group_id: "nope" })), 400, "invalid_body");
  const whole = await addAnn(eventsMgr, mk({ title_en: "For all", body_en: "Sunday service" }));
  is("a church-wide notice has no group", whole, 201, "ok");
  const pub = async (id) => H.call(O, "POST", "church/announcements/[id]/publish", { params: { id }, body: { confirm: true, expected_updated_at: await H.stamp("ministry_announcements", id) } });
  is("publish the group notice", await pub(aGroup.body.item.id), 200, "ok");
  is("publish the church-wide notice", await pub(whole.body.item.id), 200, "ok");
  const anon = F.sessionFor(H.db, null);
  const wide = await PE.loadPublicAnnouncements(anon, prof.c1);
  eq("the church-wide list shows ONLY the church-wide notice", wide.map((a) => a.title_en), ["For all"]);
  const forGroup = await PE.loadGroupAnnouncements(anon, prof.c1, g.id);
  eq("the group's own list shows the group notice", forGroup.map((a) => a.title_en), ["Youth night"]);
  eq("another group's list is empty", (await PE.loadGroupAnnouncements(anon, prof.c1, other.id)).length, 0);
  eq("a malformed group id gives nothing", (await PE.loadGroupAnnouncements(anon, prof.c1, "x")).length, 0);
  const move = await H.call(O, "PATCH", "church/announcements/[id]", { params: { id: aGroup.body.item.id }, body: { public_group_id: "", expected_updated_at: await H.stamp("ministry_announcements", aGroup.body.item.id) } });
  is("a LIVE notice cannot be moved to another audience", move, 409, "unpublish_first");
}

section("E. pastors and about: ");
{
  await H.fresh(EXTRA);
  is("a pastor needs a name", await addPastor(pm, { word_en: "Hi" }), 400);
  is("a name has a limit", await addPastor(pm, { name: "x".repeat(81) }), 400, "invalid_name");
  is("a photo must be this platform's storage", await addPastor(pm, { name: "A", photo_url: "https://evil.example.com/x.jpg" }), 400, "invalid_image_url");
  is("a biography has a limit", await addPastor(pm, { name: "A", bio_en: "x".repeat(3001) }), 400, "invalid_biography");
  is("the church is never accepted", await addPastor(pm, { name: "A", profile_id: prof.c2 }), 400, "unexpected_field");
  const p1 = await addPastor(pm, { name: "Pastor Sam", photo_url: IMG(), word_en: "Grace to you", bio_en: "Bio", is_published: true, sort_order: 2 });
  is("a pastor-page manager adds a pastor", p1, 201, "ok");
  const p2 = await addPastor(O, { name: "Pastor Ann", sort_order: 1, is_published: false });
  is("the owner adds a pastor", p2, 201, "ok");
  eq("the list is in the church's order, drafts included", (await pastors(O)).body.items.map((p) => p.name), ["Pastor Ann", "Pastor Sam"]);
  const upd = await editPastor(pm, p1.body.item.id, { word_en: "Peace", expected_updated_at: p1.body.item.updated_at });
  is("a pastor is edited with the version", upd, 200, "ok");
  is("a stale edit: 409", await editPastor(pm, p1.body.item.id, { word_en: "Old", expected_updated_at: p1.body.item.updated_at }), 409, "stale");
  is("no version: 400", await editPastor(pm, p1.body.item.id, { word_en: "Old" }), 400);
  is("a groups manager cannot edit a pastor: 403", await editPastor(GM, p1.body.item.id, { word_en: "No", expected_updated_at: upd.body.item.updated_at }), 403);
  const anon = F.sessionFor(H.db, null);
  const pub = await PG.loadPublicPastors(anon, prof.c1);
  eq("the public sees the published pastor only", pub.pastors.map((p) => p.name), ["Pastor Sam"]);
  check("...with the photo, the word and the biography", pub.pastors[0].photo_url === IMG() && pub.pastors[0].word_en === "Peace" && pub.pastors[0].bio_en === "Bio");
  eq("no vision yet", pub.about, null);
  is("the empty vision and mission read", await getAbout(pm), 200, "ok");
  is("saving needs a published text length ok", await putAbout(pm, { vision_en: "x".repeat(1501) }), 400, "invalid_vision");
  const first = await putAbout(pm, { vision_en: "See far", mission_fr: "Servir", is_published: true });
  is("the first save creates the row", first, 201, "ok");
  is("the second save needs the version: 400", await putAbout(pm, { vision_en: "See farther" }), 400);
  is("a stale second save: 409", await putAbout(pm, { vision_en: "Old", expected_updated_at: "2020-01-01T00:00:00Z" }), 409, "stale");
  const second = await putAbout(pm, { vision_en: "See farther", expected_updated_at: first.body.item.updated_at });
  is("the second save works with the version", second, 200, "ok");
  const pub2 = await PG.loadPublicPastors(anon, prof.c1);
  check("the public reads the vision and the mission", pub2.about && pub2.about.vision_en === "See farther" && pub2.about.mission_fr === "Servir", JSON.stringify(pub2.about));
  await putAbout(pm, { is_published: false, expected_updated_at: second.body.item.updated_at });
  eq("an unpublished vision is not public", (await PG.loadPublicPastors(anon, prof.c1)).about, null);
  is("a pastor is deleted with its version", await delPastor(pm, p1.body.item.id, upd.body.item.updated_at), 200, "ok");
  eq("one pastor left", await count("church_pastors"), 1);
  for (let i = 0; i < 11; i++) await addPastor(O, { name: `P${i}` });
  is("the 13th pastor is refused by the limit", await addPastor(O, { name: "Too many" }), 422, "pastor_limit");
}

section("F. the public loaders: ");
{
  await H.fresh(EXTRA);
  const men = (await addGroup(O, { kind: "men", leader_name: "Bro Tom", description_en: "Men welcome", is_published: true })).body.item;
  const kids = (await addGroup(O, { kind: "children", leader_name: "Aunt Mary", is_published: true })).body.item;
  await addGroup(O, { kind: "women", is_published: false });
  await addPhoto(O, men.id, { image_url: IMG(1), caption_en: "Camp" });
  await addPhoto(O, kids.id, { image_url: IMG(2) });
  const anon = F.sessionFor(H.db, null);
  const list = await PG.loadPublicGroups(anon, prof.c1);
  eq("the public sees the published pages, in the fixed order", list.map((x) => x.kind), ["men", "children"]);
  check("the loaded group has no member, count, roster link or audit field", list.every((x) => Object.keys(x).sort().join() === "description_en,description_fr,id,kind,leader_name,leader_photo_url"), JSON.stringify(Object.keys(list[0])));
  const page = await PG.loadPublicGroupPage(anon, prof.c1, "men");
  check("a group page has the group, its photos and announcements", page && page.group.leader_name === "Bro Tom" && page.photos.length === 1 && page.photos[0].caption_en === "Camp" && Array.isArray(page.announcements));
  const kp = await PG.loadPublicGroupPage(anon, prof.c1, "children");
  check("the Children page has photos and no caption field set", kp && kp.photos.length === 1 && kp.photos[0].caption_en === null && kp.photos[0].caption_fr === null);
  eq("a hidden group is not a page", await PG.loadPublicGroupPage(anon, prof.c1, "women"), null);
  eq("an unknown kind is not a page", await PG.loadPublicGroupPage(anon, prof.c1, "elders"), null);
  eq("a kind that is not set up is not a page", await PG.loadPublicGroupPage(anon, prof.c1, "youths"), null);
  eq("another church's groups are not seen", (await PG.loadPublicGroups(anon, prof.c2)).length, 0);
  // the shapers defend against a bad row, whatever the database says
  eq("shapePublicGroups drops an unknown kind and a hidden row", PG.shapePublicGroups([{ id: men.id, kind: "elders", is_published: true }, { id: men.id, kind: "men", is_published: false }]).length, 0);
  eq("shapeGroupPhotos drops an address that is not this platform's storage", PG.shapeGroupPhotos([{ id: men.id, image_url: "https://evil.example.com/a.jpg" }], "men").length, 0);
  eq("shapeGroupPhotos strips captions from the Children group whatever the row says", PG.shapeGroupPhotos([{ id: men.id, image_url: IMG(), caption_en: "Sam", caption_fr: "Sam" }], "children")[0].caption_en, null);
  eq("shapePublicPastors drops a hidden or unnamed pastor", PG.shapePublicPastors([{ id: men.id, name: "A", is_published: false }, { id: men.id, name: " ", is_published: true }]).length, 0);
  check("loaders never throw on a broken client", (await PG.loadPublicGroups({ from() { throw new Error("x"); } }, prof.c1)).length === 0 && (await PG.loadPublicPastors({ from() { throw new Error("x"); } }, prof.c1)).pastors.length === 0 && (await PG.loadPublicGroupPage({ from() { throw new Error("x"); } }, prof.c1, "men")) === null);
  const stale = await PG.loadPublicGroups({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { code: "42P01" } }) }) }) }) }) }, prof.c1);
  eq("a database without the tables yet gives an empty page, not an error", stale, []);
}

H.close && (await H.close());
process.exit(summary());
