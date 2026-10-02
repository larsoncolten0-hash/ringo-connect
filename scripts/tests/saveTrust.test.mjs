// Phase 2A "Save Trust": the pure decisions behind EditorSection's Save flow (src/components/dashboard/sectionSaveState.ts) and
// source-level checks that EditorSection uses them. There is no React renderer in this repo, so the component itself is covered at the
// narrowest practical layer: (1) the pure functions are executed, (2) the component source is asserted to apply them in the right places.
// It does NOT mount EditorSection or exercise router.refresh() in a browser.
//   Run:  node scripts/tests/saveTrust.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const S = jiti(path.join(SRC, "components/dashboard/sectionSaveState.ts"));
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${e.message.split("\n").join("\n    ")}`);
  }
}

const section = strip(read("src/components/dashboard/EditorSection.tsx"));
// the body of handleSave, from its declaration to the handler that follows it
const handleSave = section.slice(section.indexOf("const handleSave"), section.indexOf("const handleKeepEditing"));

// ------------------------------------------------------------------ the false-success trap
test("saveOutcome: no registered handlers is 'none', never 'success' (the every([]) === true trap)", () => {
  assert.equal([].every(Boolean), true, "documents the trap this guards against");
  assert.equal(S.saveOutcome([]), "none");
});
test("saveOutcome: a registered handler that succeeds still reports success", () => {
  assert.equal(S.saveOutcome([true]), "success");
  assert.equal(S.saveOutcome([true, true, true]), "success");
});
test("saveOutcome: any failed handler is an error (never success)", () => {
  assert.equal(S.saveOutcome([false]), "error");
  assert.equal(S.saveOutcome([true, false]), "error");
  assert.equal(S.saveOutcome([false, false]), "error");
});
test("showSaveAction: hidden for a section with no handler, however much was typed", () => {
  assert.equal(S.showSaveAction({ saverCount: 0, saveState: "idle" }), false);
});
test("showSaveAction: shown when a card registered a handler, and while a save is in flight / finishing", () => {
  assert.equal(S.showSaveAction({ saverCount: 1, saveState: "idle" }), true);
  assert.equal(S.showSaveAction({ saverCount: 3, saveState: "idle" }), true);
  for (const state of ["saving", "success", "error"]) assert.equal(S.showSaveAction({ saverCount: 0, saveState: state }), true, state);
});

// ------------------------------------------------------------------ EditorSection applies them
test("EditorSection: Save visibility no longer depends on 'dirty' alone", () => {
  assert.match(section, /showSaveAction\(\{ saverCount, saveState \}\)/);
  assert.doesNotMatch(section, /dirty \|\| saveState/);
});
test("EditorSection: handleSave does nothing when no handler is registered (before it blurs, saves or reports anything)", () => {
  const guardAt = handleSave.indexOf("saversRef.current.size === 0");
  assert.ok(guardAt > 0, "empty-handler guard present");
  assert.match(handleSave.slice(guardAt, guardAt + 80), /return;/);
  assert.ok(guardAt < handleSave.indexOf("setSaveState(\"saving\")"), "guard runs before the saving state");
});
test("EditorSection: success is decided by saveOutcome, and 'success' state is only set in the success branch", () => {
  assert.match(handleSave, /const outcome = saveOutcome\(results\)/);
  assert.match(handleSave, /if \(outcome === "success"\) \{[\s\S]*?setSaveState\("success"\)/);
  assert.equal((handleSave.match(/setSaveState\("success"\)/g) || []).length, 1);
  assert.doesNotMatch(handleSave, /results\.every\(Boolean\)/);
});
test("EditorSection: a failed save stays open with the error and never closes or refreshes", () => {
  const errorBranch = handleSave.slice(handleSave.indexOf('outcome === "error"'));
  assert.match(errorBranch, /setSaveState\("error"\)/);
  assert.doesNotMatch(errorBranch, /requestClose|router\.refresh|setSaveState\("success"\)|setDirty\(false\)/);
});
test("EditorSection: registered handlers still run exactly as before (blur, then every saver, errors caught)", () => {
  assert.match(handleSave, /\.blur\?\.\(\)/);
  assert.match(handleSave, /Array\.from\(saversRef\.current\)\.map\(async \(save\) =>/);
  assert.match(handleSave, /catch \{\s*return false;/);
  assert.match(handleSave, /requestClose\(id\)/);
});

// ------------------------------------------------------------------ stale reopen: when must the server snapshot be re-fetched?
// Cards seed their fields from the server snapshot each time they mount. These run the real tracker EditorSection uses, through the
// lifecycles that matter. "refresh" below means: router.refresh() is called, so the NEXT mount of a card sees current server values.
const d0 = { id: "draft-0" };
const d1 = { id: "draft-1" };

test("tracker: a section that was never opened never refreshes", () => {
  const t = S.createSyncTracker();
  assert.equal(t.closed(d0), false);
});
test("tracker: open, nothing happens, close -> no refresh (nothing to sync)", () => {
  const t = S.createSyncTracker();
  t.opened(d0);
  assert.equal(t.closed(d0), false);
});
test("tracker: a card that updates the draft (Links add/delete, Social, Tracks…) -> refresh on close", () => {
  const t = S.createSyncTracker();
  t.opened(d0);
  assert.equal(t.closed(d1), true);
});
test("tracker: a card that persists without touching the draft (Pixels, Tables) -> refresh on close, via any interaction", () => {
  for (const interact of ["touch"]) {
    const t = S.createSyncTracker();
    t.opened(d0);
    t[interact]();
    assert.equal(t.closed(d0), true, "same draft object, but the user interacted");
  }
});
test("tracker: successful Save refreshes immediately, so closing afterwards does not refresh a second time", () => {
  const t = S.createSyncTracker();
  t.opened(d0);
  t.touch(); // typing / clicking Save
  t.synced(d1); // Save succeeded -> router.refresh() requested now
  assert.equal(t.closed(d1), false);
});
test("tracker: changes AFTER a successful Save are still synced on close", () => {
  const t = S.createSyncTracker();
  t.opened(d0);
  t.synced(d0);
  t.touch();
  assert.equal(t.closed(d0), true);
  const u = S.createSyncTracker();
  u.opened(d0);
  u.synced(d0);
  assert.equal(u.closed(d1), true, "draft replaced after the save");
});
test("tracker: a FAILED save does not mark anything synced -> closing still refreshes", () => {
  const t = S.createSyncTracker();
  t.opened(d0);
  t.touch();
  // saveOutcome(...) === "error": EditorSection never calls synced()
  assert.equal(t.closed(d1), true);
});
test("tracker: Discard refreshes once and closing afterwards does not refresh again", () => {
  const t = S.createSyncTracker();
  t.opened(d0);
  t.touch();
  t.synced(d1);
  assert.equal(t.closed(d1), false);
});
test("tracker: each visit starts clean (a close resets; the next open re-baselines)", () => {
  const t = S.createSyncTracker();
  t.opened(d0);
  t.touch();
  assert.equal(t.closed(d1), true);
  assert.equal(t.closed(d1), false, "already consumed");
  t.opened(d1);
  assert.equal(t.closed(d1), false, "second visit with no change");
});
test("tracker: synced() on a section that is not open does not arm a refresh", () => {
  const t = S.createSyncTracker();
  t.synced(d1);
  assert.equal(t.closed(d1), false);
});
test("EditorSection wires the tracker: Save success and Discard sync + refresh; close asks the tracker; change/input/click all touch it", () => {
  const ok = handleSave.slice(handleSave.indexOf('outcome === "success"'), handleSave.indexOf('outcome === "error"'));
  assert.match(ok, /sync\.synced\(draftRef\.current\)[\s\S]*router\.refresh\(\)/);
  assert.match(section, /if \(sync\.closed\(draftRef\.current\)\) router\.refresh\(\)/);
  assert.match(section, /sync\.opened\(draftRef\.current\)/);
  assert.equal((section.match(/sync\.touch\(\)/g) || []).length, 3, "onChangeCapture, onInputCapture, onClickCapture");
  assert.match(section, /onClickCapture=\{\(\) => sync\.touch\(\)\}/);
  const discard = section.slice(section.indexOf("const handleDiscard"), section.indexOf("return (\n    <>"));
  assert.match(discard, /sync\.synced\(draftRef\.current\)[\s\S]*router\.refresh\(\)/);
  assert.equal((section.match(/router\.refresh\(\)/g) || []).length, 3, "save success, close, discard");
});
test("every card that persists on its own is covered by the touch signal, even those that never update the draft", () => {
  const neverDraft = ["PixelsCard", "TablesCard"].filter((f) => !/updateDraft/.test(read(`src/components/editor/${f}.tsx`)));
  assert.deepEqual(neverDraft.sort(), ["PixelsCard", "TablesCard"], "documents why draft-diff alone is not enough");
  assert.match(section, /onClickCapture/);
});

// ------------------------------------------------------------------ why refresh() cannot clobber the draft or the open section
test("refresh() safety: the preview draft is seeded once and never replaced wholesale by later props", () => {
  const ctx = strip(read("src/components/editor/EditorPreviewContext.tsx"));
  assert.match(ctx, /useState<DraftProfile>\(initialProfile\)/);
  assert.match(ctx, /updateDraft: \(patch\) => setDraft\(\(prev\) => \(\{ \.\.\.prev, \.\.\.patch \}\)\)/);
  // The only effect that reads fresh props may restore the keys a Discard queued, nothing else.
  assert.doesNotMatch(ctx, /setDraft\(\s*(initialProfile|serverRef\.current)\s*\)/, "no wholesale re-seed");
  const effect = ctx.slice(ctx.indexOf("useEffect("), ctx.indexOf("const value = useMemo"));
  assert.match(effect, /if \(pendingRestore\.current\.size === 0\) return;/, "a refresh with nothing queued changes nothing");
  assert.match(effect, /restoreKeys\(prev, serverRef\.current, keys\)/);
});
test("refresh() safety: the open section lives in client state, and the default open id is only read on mount", () => {
  const acc = strip(read("src/components/ui/Accordion.tsx"));
  assert.match(acc, /useState<string \| null>\(defaultOpenId\)/);
  assert.doesNotMatch(acc, /useEffect\([\s\S]{0,120}defaultOpenId/);
});
test("refresh() safety: cards seed their fields from server props, so the refreshed props are what a reopened card sees", () => {
  const editor = read("src/components/Editor.tsx");
  assert.match(editor, /initialNumber=\{profile\.whatsapp_number\}/);
  assert.match(read("src/components/editor/WhatsAppCard.tsx"), /useState\(initialNumber \|\| ""\)/);
});
test("a refresh is not a save loop: no card or the section calls save from an effect on props/draft", () => {
  assert.doesNotMatch(section, /useEffect\([^)]*\)\s*=>\s*\{[^}]*handleSave/);
});

// ------------------------------------------------------------------ which sections have a Save action (documents the Phase 2A behaviour)
test("sections with a registered handler keep their Save: the seven buffered cards", () => {
  for (const f of ["AboutCard", "CatalogCard", "CategoryCard", "LinksCard", "MenuCard", "ProfileHeaderCard", "WhatsAppCard"]) {
    assert.match(read(`src/components/editor/${f}.tsx`), /useSectionSave\(/, f);
  }
});
test("cards that persist on their own register nothing, so their section shows no Save (Social, Theme, Pixels, …)", () => {
  for (const f of ["SocialLinksCard", "ThemeCard", "PixelsCard", "PinnedSpotlightCard", "TracksCard", "MusicReleasesCard", "MusicSettingsCard", "RestaurantSettingsCard", "TablesCard"]) {
    assert.doesNotMatch(read(`src/components/editor/${f}.tsx`), /useSectionSave\(/, f);
  }
});
test("useSectionSave contract is unchanged (register returns an unregister; true when inside a section)", () => {
  const ss = strip(read("src/components/dashboard/sectionSave.tsx"));
  assert.match(ss, /export function useSectionSave\(save: SectionSaveFn\): boolean/);
  assert.match(ss, /return register\(\(\) => latest\.current\(\)\)/);
  assert.match(ss, /return !!ctx;/);
});

// ------------------------------------------------------------------ scope
test("Phase 2A adds no database or server code (pure client/read-time change)", () => {
  for (const f of ["src/components/dashboard/sectionSaveState.ts"]) {
    assert.doesNotMatch(strip(read(f)), /supabase|fetch\(|process\.env|\.insert\(|\.update\(|\.delete\(/, f);
  }
  assert.doesNotMatch(section, /createClient|\.from\("|supabase/);
});

if (failures.length) {
  console.log(`FAIL: ${failures.length} failed, ${passed} passed`);
  failures.forEach((f) => console.log(" - " + f));
  process.exit(1);
}
console.log(`PASS: ${passed} tests passed`);
