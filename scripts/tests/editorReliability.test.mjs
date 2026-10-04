// Phase 2 editor reliability: the auto-save engine, the section status / leave-warning rules, and the preview-draft
// synchronisation helpers. Pure logic only (no React renderer in this repo); see saveTrust.test.mjs for the EditorSection wiring.
//   Run:  node scripts/tests/editorReliability.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const E = jiti(path.join(SRC, "components/dashboard/autosaveEngine.ts"));
const S = jiti(path.join(SRC, "components/dashboard/sectionSaveState.ts"));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${String(e.message).split("\n").join("\n    ")}`);
  }
}

// a manual clock so debounce is deterministic
function fakeTimers() {
  let id = 0;
  const q = new Map();
  return {
    timers: { set: (fn, ms) => { q.set(++id, { fn, ms }); return id; }, clear: (h) => q.delete(h) },
    fireAll: () => { const fns = [...q.values()].map((x) => x.fn); q.clear(); fns.forEach((f) => f()); },
    size: () => q.size,
  };
}
const ok = async () => ({ error: null });
const bad = async () => ({ error: { message: "permission denied for table profiles (secret detail)" } });
const boom = async () => { throw new Error("network down"); };
const flushMicrotasks = () => new Promise((r) => setImmediate(r));

// ------------------------------------------------------------------ run(): success, failure, throw
await test("run: a write with no error succeeds", async () => {
  const e = E.createAutosaveEngine();
  assert.equal(await e.run(ok), true);
  assert.deepEqual(e.snapshot(), { pending: 0, retryable: 0, undone: false, uncommitted: 0 });
});
await test("run: a Supabase-style { error } is a failure, never success", async () => {
  const e = E.createAutosaveEngine();
  assert.equal(await e.run(bad), false);
  assert.equal(e.snapshot().retryable, 1);
});
await test("run: a thrown error (network) is a failure", async () => {
  const e = E.createAutosaveEngine();
  assert.equal(await e.run(boom), false);
  assert.equal(e.snapshot().retryable, 1);
});
await test("run: void / null results (no error object) count as success", async () => {
  const e = E.createAutosaveEngine();
  assert.equal(await e.run(async () => undefined), true);
  assert.equal(await e.run(async () => null), true);
});
await test("isFailure: only a truthy error is a failure", () => {
  assert.equal(E.isFailure({ error: null }), false);
  assert.equal(E.isFailure({ error: undefined }), false);
  assert.equal(E.isFailure({ error: { message: "x" } }), true);
  assert.equal(E.isFailure({ data: [] }), false);
  assert.equal(E.isFailure(null), false);
});

// ------------------------------------------------------------------ rollback vs retry
await test("rollback: a failed add/delete/reorder is UNDONE, the UI is restored, and no retry is kept", async () => {
  let ui = "after-optimistic-change";
  const e = E.createAutosaveEngine();
  const okRun = await e.run(bad, { rollback: () => { ui = "restored-to-saved-state"; } });
  assert.equal(okRun, false);
  assert.equal(ui, "restored-to-saved-state");
  assert.deepEqual(e.snapshot(), { pending: 0, retryable: 0, undone: true, uncommitted: 0 });
});
await test("rollback is not called when the write succeeds", async () => {
  let called = false;
  const e = E.createAutosaveEngine();
  await e.run(ok, { rollback: () => { called = true; } });
  assert.equal(called, false);
});
await test("rollback that throws does not break the engine", async () => {
  const e = E.createAutosaveEngine();
  await e.run(bad, { rollback: () => { throw new Error("ui gone"); } });
  assert.equal(e.snapshot().undone, true);
});
await test("undone notice persists until dismissed, or until a later write succeeds", async () => {
  const e = E.createAutosaveEngine();
  await e.run(bad, { rollback: () => {} });
  assert.equal(e.snapshot().undone, true);
  e.dismiss();
  assert.equal(e.snapshot().undone, false);
  await e.run(bad, { rollback: () => {} });
  await e.run(ok);
  assert.equal(e.snapshot().undone, false);
});
await test("retry: a kept failure is re-sent exactly once per retry; success clears it", async () => {
  let calls = 0;
  let healthy = false;
  const op = async () => { calls++; return healthy ? { error: null } : { error: { message: "x" } }; };
  const e = E.createAutosaveEngine();
  await e.run(op, { key: "field" });
  assert.equal(calls, 1);
  assert.equal(await e.retry(), false);
  assert.equal(calls, 2, "one re-send per retry, no duplicates");
  assert.equal(e.snapshot().retryable, 1);
  healthy = true;
  assert.equal(await e.retry(), true);
  assert.equal(calls, 3);
  assert.equal(e.snapshot().retryable, 0);
});
await test("a later success for the same key clears an earlier failure of that key (blur, fix, blur again)", async () => {
  const e = E.createAutosaveEngine();
  await e.run(bad, { key: "pixel" });
  assert.equal(e.snapshot().retryable, 1);
  await e.run(ok, { key: "pixel" });
  assert.equal(e.snapshot().retryable, 0);
});
await test("a success for a DIFFERENT key does not hide another field's failure", async () => {
  const e = E.createAutosaveEngine();
  await e.run(bad, { key: "a" });
  await e.run(ok, { key: "b" });
  assert.equal(e.snapshot().retryable, 1);
});
await test("two different failures are both kept (distinct keys)", async () => {
  const e = E.createAutosaveEngine();
  await e.run(bad, { key: "a" });
  await e.run(boom, { key: "b" });
  assert.equal(e.snapshot().retryable, 2);
});

// ------------------------------------------------------------------ pending / debounce / flush
await test("pending counts a write while it is in flight", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const e = E.createAutosaveEngine();
  const p = e.run(async () => { await gate; return { error: null }; });
  assert.equal(e.snapshot().pending, 1);
  release();
  await p;
  assert.equal(e.snapshot().pending, 0);
});
await test("debounce: repeated schedules with one key run ONE write (the last), and count as pending meanwhile", async () => {
  const clock = fakeTimers();
  const e = E.createAutosaveEngine(() => {}, clock.timers);
  const seen = [];
  for (const v of ["#111", "#222", "#333"]) e.schedule("theme", async () => { seen.push(v); return { error: null }; }, 300);
  assert.equal(e.snapshot().pending, 1, "one pending debounced write");
  assert.equal(clock.size(), 1, "earlier timers were cancelled");
  clock.fireAll();
  await flushMicrotasks();
  assert.deepEqual(seen, ["#333"]);
  assert.equal(e.snapshot().pending, 0);
});
await test("debounce: a failed debounced write is kept for retry (the UI still shows the unsaved colour)", async () => {
  const clock = fakeTimers();
  const e = E.createAutosaveEngine(() => {}, clock.timers);
  e.schedule("theme", bad, 300);
  clock.fireAll();
  await flushMicrotasks();
  assert.equal(e.snapshot().retryable, 1);
});
await test("flush: runs debounced writes immediately (once) and waits, so leaving never races them", async () => {
  const clock = fakeTimers();
  const e = E.createAutosaveEngine(() => {}, clock.timers);
  let ran = 0;
  e.schedule("reorder", async () => { ran++; await flushMicrotasks(); return { error: null }; }, 400);
  await e.flush();
  assert.equal(ran, 1);
  assert.equal(e.snapshot().pending, 0);
  assert.equal(clock.size(), 0, "the timer was cancelled, so it cannot run a second time");
  clock.fireAll();
  await flushMicrotasks();
  assert.equal(ran, 1, "no duplicate write");
});
await test("flush: waits for a write already in flight", async () => {
  let done = false;
  const e = E.createAutosaveEngine();
  void e.run(async () => { await flushMicrotasks(); await flushMicrotasks(); done = true; return { error: null }; });
  await e.flush();
  assert.equal(done, true);
});
await test("flush with a failing debounced write leaves it as a retryable failure (so the leave warning can fire)", async () => {
  const clock = fakeTimers();
  const e = E.createAutosaveEngine(() => {}, clock.timers);
  e.schedule("order", bad, 400);
  await e.flush();
  assert.equal(e.snapshot().retryable, 1);
});

// ------------------------------------------------------------------ uncommitted input and reset
await test("uncommitted input is tracked per key and idempotent", () => {
  const e = E.createAutosaveEngine();
  e.setUncommitted("social-url", true);
  e.setUncommitted("social-url", true);
  assert.equal(e.snapshot().uncommitted, 1);
  e.setUncommitted("social-url", false);
  assert.equal(e.snapshot().uncommitted, 0);
});
await test("reset (Discard) forgets failures, timers and uncommitted input", async () => {
  const clock = fakeTimers();
  const e = E.createAutosaveEngine(() => {}, clock.timers);
  await e.run(bad, { key: "a" });
  e.schedule("b", ok, 300);
  e.setUncommitted("c", true);
  e.reset();
  assert.deepEqual(e.snapshot(), { pending: 0, retryable: 0, undone: false, uncommitted: 0 });
  assert.equal(clock.size(), 0);
});
await test("onChange is told about every change (so the UI can re-render)", async () => {
  const seen = [];
  const e = E.createAutosaveEngine((s) => seen.push(s.pending));
  await e.run(ok);
  assert.ok(seen.includes(1) && seen[seen.length - 1] === 0);
});

// ------------------------------------------------------------------ status vocabulary
const base = { saverCount: 0, dirty: false, saveState: "idle", autoPending: 0, autoRetryable: 0, autoUndone: false };
await test("sectionStatus: every state in the vocabulary is reachable and distinct", () => {
  const st = (o) => S.sectionStatus({ ...base, ...o });
  assert.equal(st({}), "none");
  assert.equal(st({ saverCount: 1 }), "idle");
  assert.equal(st({ saverCount: 1, dirty: true }), "dirty");
  assert.equal(st({ saverCount: 1, saveState: "saving" }), "saving");
  assert.equal(st({ saverCount: 1, saveState: "success" }), "saved");
  assert.equal(st({ saverCount: 1, saveState: "error" }), "failed");
  assert.equal(st({ autoPending: 1 }), "autosaving");
  assert.equal(st({ autoRetryable: 1 }), "autosave_failed");
  assert.equal(st({ autoUndone: true }), "autosave_undone");
});
await test("sectionStatus: a section with no Save handler can never be 'saved' or 'dirty' (no fake success)", () => {
  const st = (o) => S.sectionStatus({ ...base, ...o });
  assert.equal(st({ dirty: true }), "none");
  assert.notEqual(st({ dirty: true, autoPending: 0 }), "saved");
});
await test("sectionStatus: a failing save outranks everything else, and an auto-save failure outranks 'saving'", () => {
  const st = (o) => S.sectionStatus({ ...base, ...o });
  assert.equal(st({ saverCount: 1, dirty: true, saveState: "error", autoPending: 1 }), "failed");
  assert.equal(st({ autoPending: 1, autoRetryable: 1 }), "autosave_failed");
});

// ------------------------------------------------------------------ leave warning
const warn = (o) => S.sectionWarnsOnLeave({ saverCount: 0, dirty: false, autoRetryable: 0, uncommitted: 0, ...o });
await test("leave warning: genuinely unsaved BUFFERED edits warn", () => {
  assert.equal(warn({ saverCount: 1, dirty: true }), true);
});
await test("leave warning: a buffered section with nothing edited does not warn", () => {
  assert.equal(warn({ saverCount: 1, dirty: false }), false);
});
await test("leave warning: edits in an AUTO-SAVING section do not warn by themselves (the old false alarm)", () => {
  assert.equal(warn({ saverCount: 0, dirty: true }), false);
});
await test("leave warning: a FAILED auto-save warns (the UI shows a value the database does not have)", () => {
  assert.equal(warn({ autoRetryable: 1 }), true);
});
await test("leave warning: typed-but-never-submitted input warns (not silently discarded)", () => {
  assert.equal(warn({ uncommitted: 1 }), true);
});
await test("leave warning: a rolled-back (undone) failure does not warn, the UI already matches the database", () => {
  const e = E.createAutosaveEngine();
  return e.run(bad, { rollback: () => {} }).then(() => {
    const s = e.snapshot();
    assert.equal(warn({ autoRetryable: s.retryable, uncommitted: s.uncommitted }), false);
  });
});

// ------------------------------------------------------------------ error messages never expose technical detail
await test("the user-facing error text is generic: the raw backend message never reaches the UI strings", () => {
  const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
  assert.ok(translations);
  const src = fs.readFileSync(path.join(SRC, "components/dashboard/autosaveEngine.ts"), "utf8");
  assert.doesNotMatch(src, /\.message/, "the engine never reads or forwards error.message");
});

// ------------------------------------------------------------------ Discard: the preview draft goes back to what is saved (2B.3)
const D = jiti(path.join(SRC, "components/editor/draftSync.ts"));
await test("restoreKeys: discarded keys return to the saved values, other keys are untouched", () => {
  const server = { whatsapp_number: "+237 1", name: "Saved name", links: [{ id: "a" }] };
  const draft = { whatsapp_number: "+237 999 (typed, discarded)", name: "Unsaved name in the Profile card", links: [{ id: "a" }, { id: "b" }] };
  const next = D.restoreKeys(draft, server, ["whatsapp_number"]);
  assert.equal(next.whatsapp_number, "+237 1", "the discarded section's value is restored");
  assert.equal(next.name, "Unsaved name in the Profile card", "unrelated unsaved work survives");
  assert.deepEqual(next.links, draft.links);
});
await test("restoreKeys: does not mutate the draft or the server snapshot (new object)", () => {
  const server = { a: 1 };
  const draft = { a: 2, b: 3 };
  const next = D.restoreKeys(draft, server, ["a"]);
  assert.notStrictEqual(next, draft);
  assert.deepEqual(draft, { a: 2, b: 3 });
  assert.deepEqual(server, { a: 1 });
});
await test("restoreKeys: a list changed by a discarded section is replaced by the saved list; a key the server lacks becomes undefined", () => {
  const next = D.restoreKeys({ products: [{ id: "x" }, { id: "new:1" }], scratch: 1 }, { products: [{ id: "x" }] }, ["products", "scratch"]);
  assert.deepEqual(next.products, [{ id: "x" }]);
  assert.equal(next.scratch, undefined);
});
await test("restoreKeys: no keys queued = nothing changes", () => {
  const draft = { a: 1 };
  assert.deepEqual(D.restoreKeys(draft, { a: 2 }, []), draft);
});
await test("EditorPreviewContext: a section's updateDraft records the keys it touched, and Discard restores them after the next refresh", () => {
  const ctx = fs.readFileSync(path.join(SRC, "components/editor/EditorPreviewContext.tsx"), "utf8").replace(/\r\n/g, "\n");
  assert.match(ctx, /scope\.record\(Object\.keys\(patch\)\)/);
  assert.match(ctx, /restoreFromServer = useCallback/);
  assert.match(ctx, /setDraft\(\(prev\) => restoreKeys\(prev, serverRef\.current, keys\)\)/);
  const section = fs.readFileSync(path.join(SRC, "components/dashboard/EditorSection.tsx"), "utf8").replace(/\r\n/g, "\n");
  const discard = section.slice(section.indexOf("const handleDiscard"), section.indexOf("return (\n    <>"));
  assert.match(discard, /preview\.restoreFromServer\(\[\.\.\.touchedKeysRef\.current\]\)/);
  assert.ok(discard.indexOf("restoreFromServer") < discard.indexOf("router.refresh()"), "queued before the refresh whose props apply it");
  assert.match(discard, /engine\.reset\(\)/);
});

// ------------------------------------------------------------------ navigation protection (2B.6)
const N = jiti(path.join(SRC, "components/dashboard/navigationGuard.ts"));
const click = (o) => ({ href: "/dashboard/analytics", target: null, download: false, button: 0, modified: false, currentUrl: "https://ringo.test/dashboard", ...o });
await test("navigation guard: an ordinary same-site link away from the editor is intercepted", () => {
  assert.equal(N.guardedNavigationTarget(click({})), "/dashboard/analytics");
  assert.equal(N.guardedNavigationTarget(click({ href: "/dashboard/home" })), "/dashboard/home");
  assert.equal(N.guardedNavigationTarget(click({ href: "https://ringo.test/dashboard/reports?x=1#top" })), "/dashboard/reports?x=1#top");
});
await test("navigation guard: the editor's own ?section= links are intercepted (they reload the page)", () => {
  assert.equal(N.guardedNavigationTarget(click({ href: "/dashboard?section=links" })), "/dashboard?section=links");
});
await test("navigation guard: never blocks new-tab, modified, middle-click, download, or target=_blank links (the public profile link)", () => {
  assert.equal(N.guardedNavigationTarget(click({ target: "_blank", href: "/jane" })), null);
  assert.equal(N.guardedNavigationTarget(click({ modified: true })), null);
  assert.equal(N.guardedNavigationTarget(click({ button: 1 })), null);
  assert.equal(N.guardedNavigationTarget(click({ download: true })), null);
});
await test("navigation guard: never blocks external sites, mailto:/tel:/javascript:, in-page anchors, or the current page", () => {
  assert.equal(N.guardedNavigationTarget(click({ href: "https://example.com/x" })), null);
  assert.equal(N.guardedNavigationTarget(click({ href: "mailto:a@b.co" })), null);
  assert.equal(N.guardedNavigationTarget(click({ href: "tel:+237600000000" })), null);
  assert.equal(N.guardedNavigationTarget(click({ href: "javascript:void(0)" })), null);
  assert.equal(N.guardedNavigationTarget(click({ href: "#preview" })), null);
  assert.equal(N.guardedNavigationTarget(click({ href: "/dashboard" })), null);
  assert.equal(N.guardedNavigationTarget(click({ href: null })), null);
  assert.equal(N.guardedNavigationTarget(click({ href: "http://[bad" })), null);
});
await test("navigation guard: only active while something is genuinely unsaved (registered by sections, nothing otherwise)", () => {
  const guard = fs.readFileSync(path.join(SRC, "components/dashboard/UnsavedNavigationGuard.tsx"), "utf8");
  assert.match(guard, /if \(!any\) return;/);
  assert.equal((guard.match(/if \(!any\) return;/g) || []).length, 2, "both beforeunload and click listeners are gated");
  assert.match(guard, /beforeunload/);
  assert.match(guard, /addEventListener\("click", onClick, true\)/);
});
const M = jiti(path.join(SRC, "components/ui/useModalA11y.ts"));
await test("focus trap: Tab wraps at both ends and pulls stray focus in; Escape/shift cases", () => {
  assert.equal(M.nextTrapIndex(2, 3, false), 0, "Tab on the last item goes to the first");
  assert.equal(M.nextTrapIndex(0, 3, true), 2, "Shift+Tab on the first goes to the last");
  assert.equal(M.nextTrapIndex(1, 3, false), null, "middle: the browser moves focus");
  assert.equal(M.nextTrapIndex(-1, 3, false), 0, "focus outside the dialog is pulled in");
  assert.equal(M.nextTrapIndex(-1, 3, true), 2);
  assert.equal(M.nextTrapIndex(0, 0, false), null);
  assert.equal(M.nextTrapIndex(0, 1, false), 0, "a single control keeps focus");
});

// ------------------------------------------------------------------ link addresses (2C.3)
const U = jiti(path.join(SRC, "lib/linkUrl.ts"));
await test("linkUrl: a bare web address gets https:// and is reported as changed", () => {
  for (const [input, out] of [["example.com", "https://example.com"], ["www.example.com/shop", "https://www.example.com/shop"], ["instagram.com/ama", "https://instagram.com/ama"], ["boutique.cm", "https://boutique.cm"], ["shop.co.za/a?b=1", "https://shop.co.za/a?b=1"], ["  example.com  ", "https://example.com"]]) {
    assert.deepEqual(U.normalizeLinkUrl(input), { ok: true, url: out, changed: true }, input);
  }
});
await test("linkUrl: addresses with an allowed scheme are kept exactly as typed", () => {
  for (const v of ["https://example.com", "http://example.com/a", "mailto:team@example.com", "tel:+237600000000", "sms:+237600000000", "whatsapp://send?phone=237600000000", "HTTPS://Example.com"]) {
    const r = U.normalizeLinkUrl(v);
    assert.equal(r.ok, true, v);
    assert.equal(r.url, v, v);
  }
});
await test("linkUrl: empty, scheme-only and placeholder values are 'empty', not valid", () => {
  for (const v of ["", "   ", "https://", "http://", "mailto:", "tel:", null, undefined, 42]) assert.deepEqual(U.normalizeLinkUrl(v), { ok: false, reason: "empty" }, String(v));
});
await test("linkUrl: scripts and data URLs are rejected (a link must never run code)", () => {
  for (const v of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "file:///etc/passwd"]) assert.deepEqual(U.normalizeLinkUrl(v), { ok: false, reason: "invalid" }, v);
});
await test("linkUrl: things that are not addresses are rejected, with no over-validation of real ones", () => {
  for (const v of ["hello world", "not a url", "justtext", "6 00 00 00 00", "user@example.com"]) assert.equal(U.normalizeLinkUrl(v).ok, false, v);
  assert.equal(U.normalizeLinkUrl("https://localhost:3000/x").ok, true);
  assert.equal(U.normalizeLinkUrl("//cdn.example.com/a").ok, true);
  assert.equal(U.normalizeLinkUrl("//cdn.example.com/a").url, "https://cdn.example.com/a");
});
await test("linkUrl.displayHref: an older stored bare address becomes a working link; scripts become '#'; allowed values pass through", () => {
  assert.equal(U.displayHref("example.com"), "https://example.com");
  assert.equal(U.displayHref("https://example.com"), "https://example.com");
  assert.equal(U.displayHref("mailto:a@b.co"), "mailto:a@b.co");
  assert.equal(U.displayHref("javascript:alert(1)"), "#");
  assert.equal(U.displayHref("hello world"), "#");
  assert.equal(U.displayHref(null), "#");
});
await test("linkUrl.displayHref: INVARIANT - anything normalizeLinkUrl rejects is never returned as an href (obfuscated schemes included)", () => {
  const hostile = [
    "javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "data:text/html,<script>1</script>", "vbscript:msgbox(1)",
    "java\tscript:alert(1)", "java\nscript:alert(1)", "java\rscript:alert(1)", "javascript\t:alert(1)", "\u0001javascript:alert(1)",
    "\u0000javascript:alert(1)", "​javascript:alert(1)", "​‍javascript:alert(1)", "﻿javascript:alert(1)",
    "&#106;avascript:alert(1)", "jav&#x09;ascript:alert(1)", "java\u0000script:alert(1)", "data\t:text/html,x",
  ];
  for (const h of hostile) {
    assert.equal(U.normalizeLinkUrl(h).ok, false, "the save rule rejects " + JSON.stringify(h));
    assert.equal(U.displayHref(h), "#", "must not render " + JSON.stringify(h));
  }
  for (const v of [undefined, null, "", "   ", 42, {}, [], "hello world", "https://"]) assert.equal(U.displayHref(v), "#");
  // legitimate values are untouched
  for (const ok of ["https://ringo.cm/a?b=1", "http://example.com", "mailto:a@b.co", "tel:+237677123456", "sms:+237677123456", "whatsapp://send?phone=237677123456"]) {
    assert.equal(U.displayHref(ok), ok);
  }
  assert.equal(U.displayHref("  instagram.com/ringo  "), "https://instagram.com/ringo");
});
await test("linkUrl.displayHref: the source has no raw-input fallback left", () => {
  const code = fs.readFileSync(path.join(SRC, "lib/linkUrl.ts"), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const body = code.slice(code.indexOf("export function displayHref"));
  assert.doesNotMatch(body, /String\(stored/);
  assert.match(body, /check\.ok \? check\.url : "#"/);
});
await test("linkUrl: Phase 1 still counts a stored bare address as content (scoring unchanged)", () => {
  const H = jiti(path.join(SRC, "lib/profileHealth/index.ts"));
  assert.equal(H.hasUsableUrl("example.com"), true);
  assert.equal(H.hasUsableUrl("https://"), false);
});

// ------------------------------------------------------------------ what Save does with rows added on screen (2C.2)
const R = jiti(path.join(SRC, "components/editor/rowsSave.ts"));
const L = jiti(path.join(SRC, "components/editor/linksSave.ts"));
const P = jiti(path.join(SRC, "components/editor/productsSave.ts"));
const MS = jiti(path.join(SRC, "components/editor/menuSave.ts"));
const norm = (v) => U.normalizeLinkUrl(v);
await test("links save: a row added on screen with a usable address is INSERTED, with its position", () => {
  const plan = L.planLinksSave([{ id: "a", url: "https://a.co" }, { id: "new:1", title: "Menu", url: "menu.example.com" }], norm);
  assert.deepEqual(plan.inserts.map((i) => [i.row.id, i.payload.url, i.position]), [["new:1", "https://menu.example.com", 1]]);
  assert.deepEqual(plan.updates.map((u) => u.row.id), ["a"]);
});
await test("links save: an EMPTY row added on screen is dropped and never inserted (no blank record)", () => {
  const plan = L.planLinksSave([{ id: "new:1", title: "", url: "", description: "" }, { id: "new:2", url: "https://" }], norm);
  assert.deepEqual(plan.drop, ["new:1", "new:2"]);
  assert.equal(plan.inserts.length + plan.updates.length, 0);
  assert.deepEqual(plan.errors, {});
});
await test("links save: a title without a usable address is REFUSED ('required'), not saved and not dropped", () => {
  const plan = L.planLinksSave([{ id: "new:1", title: "My shop", url: "https://" }, { id: "b", title: "Old", url: "" }], norm);
  assert.deepEqual(plan.errors, { "new:1": "required", b: "required" });
  assert.equal(plan.drop.length, 0);
});
await test("links save: an address that cannot be a link is REFUSED ('invalid'); scripts too", () => {
  const plan = L.planLinksSave([{ id: "a", url: "hello there" }, { id: "b", url: "javascript:alert(1)" }], norm);
  assert.deepEqual(plan.errors, { a: "invalid", b: "invalid" });
});
await test("links save: an old empty row saved by the previous behaviour is left untouched, not updated and not an error", () => {
  const plan = L.planLinksSave([{ id: "old", title: "", url: "https://", description: "" }], norm);
  assert.deepEqual(plan, { drop: [], updates: [], inserts: [], errors: {} });
});
await test("links save: positions skip dropped rows so the saved order matches what the user sees", () => {
  const plan = L.planLinksSave([{ id: "new:a", url: "" }, { id: "new:b", url: "b.co" }, { id: "new:c", url: "c.co" }], norm);
  assert.deepEqual(plan.inserts.map((i) => i.position), [0, 1]);
});
await test("links save: a saved row whose address was fixed is updated with the NORMALISED address", () => {
  const plan = L.planLinksSave([{ id: "a", url: "example.com" }], norm);
  assert.equal(plan.updates[0].payload.url, "https://example.com");
});
await test("products save: a product needs a name; empty added rows are dropped; content without a name is refused", () => {
  const plan = P.planProductsSave([
    { id: "new:1", name: "Braids", price: "5000" },
    { id: "new:2", name: "", price: "" },
    { id: "new:3", name: " ", price: "2000" },
    { id: "p1", name: "Gel" },
    { id: "old", name: "", price: null, description: "" },
  ]);
  assert.deepEqual(plan.inserts.map((i) => i.row.id), ["new:1"]);
  assert.deepEqual(plan.drop, ["new:2"]);
  assert.deepEqual(plan.errors, { "new:3": "required" });
  assert.deepEqual(plan.updates.map((u) => u.row.id), ["p1"]);
});
await test("menu save: a dish needs a name; empty added dishes are dropped; a priced dish without a name is refused", () => {
  const plan = MS.planMenuItemsSave([
    { id: "new:1", name: "Ndolé", price: "2500" },
    { id: "new:2", name: "", price: "", description: "" },
    { id: "new:3", name: "", price: "1500" },
    { id: "m1", name: "Soya" },
  ]);
  assert.deepEqual(plan.inserts.map((i) => i.row.id), ["new:1"]);
  assert.deepEqual(plan.drop, ["new:2"]);
  assert.deepEqual(plan.errors, { "new:3": "required" });
  assert.deepEqual(plan.updates.map((u) => u.row.id), ["m1"]);
});
await test("rows save: a temporary id can only ever be inserted, never updated (it cannot reach the database as an id)", () => {
  const plan = R.planRowsSave([{ id: "new:1" }, { id: "real" }], () => ({ state: "ok", payload: 1 }));
  assert.deepEqual(plan.inserts.map((i) => i.row.id), ["new:1"]);
  assert.deepEqual(plan.updates.map((u) => u.row.id), ["real"]);
  assert.equal(R.isNewRowId("new:abc"), true);
  assert.equal(R.isNewRowId("2f1c0b7e-0000-4000-8000-000000000000"), false);
});
await test("Phase 1 agrees with the editor: a row the editor would drop or refuse is not counted as content", () => {
  const H = jiti(path.join(SRC, "lib/profileHealth/index.ts"));
  const rows = [{ id: "new:1", title: "", url: "https://" }];
  assert.equal(L.planLinksSave(rows, norm).inserts.length, 0);
  assert.equal(H.meaningfulRows({ links: rows }).links.length, 0);
  const prods = [{ id: "new:1", name: "" }];
  assert.equal(P.planProductsSave(prods).inserts.length, 0);
  assert.equal(H.meaningfulRows({ products: prods }).products.length, 0);
  const good = [{ id: "new:2", title: "", url: "shop.co" }];
  assert.equal(L.planLinksSave(good, norm).inserts.length, 1);
  assert.equal(H.meaningfulRows({ links: [{ ...good[0], url: "https://shop.co" }] }).links.length, 1);
});

// ------------------------------------------------------------------ no unchecked writes in the editor cards (2B.1)
await test("every database write in the editor cards is checked: through the engine, or its result is read", () => {
  const dir = path.join(SRC, "components/editor");
  const offenders = [];
  for (const file of fs.readdirSync(dir).filter((f) => /\.(tsx|ts)$/.test(f))) {
    if (file === "EventTicketTypesEditor.tsx") continue; // used on the Tickets pages; tickets are out of scope
    const lines = fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n").split("\n");
    lines.forEach((line, i) => {
      if (!/\.(insert|update|upsert|delete)\(/.test(line) || /^\s*\/\//.test(line)) return;
      // a database write: "supabase" on the line, or a chained ".verb(" line whose chain started on a recent line
      const near = lines.slice(Math.max(0, i - 4), i + 1).join("\n");
      const isDatabaseWrite = /supabase/.test(line) || (/^\s*\.(insert|update|upsert|delete)\(/.test(line) && /supabase/.test(near));
      if (!isDatabaseWrite) return; // e.g. the hook's own update(), a Map.delete()
      const context = lines.slice(Math.max(0, i - 6), i + 3).join("\n");
      // allowed: sent through the engine, or its result is read; plus the one documented best-effort cleanup delete
      if (!/autosave\.(run|schedule)\(|\berror\b|\.error\b|const res\b|writes\.push|profileWrite|results|Fire and forget/.test(context)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
await test("no editor card inserts a blank row when 'Add' is pressed, except tracks and releases (cleaned up when the section closes)", () => {
  const dir = path.join(SRC, "components/editor");
  const blankInsert = /(?:\.insert|\badd)\(\{[^}]*(?:title|name|phone_number): ""/;
  const hits = [];
  for (const file of fs.readdirSync(dir).filter((f) => /\.tsx$/.test(f))) {
    if (file === "EventTicketTypesEditor.tsx") continue; // Tickets pages; out of scope
    const src = fs.readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n");
    if (blankInsert.test(src.replace(/\n\s*/g, " "))) hits.push(file);
  }
  assert.deepEqual(hits.sort(), ["MusicReleasesCard.tsx", "TracksCard.tsx"]);
  for (const f of ["TracksCard.tsx", "MusicReleasesCard.tsx"]) assert.match(fs.readFileSync(path.join(dir, f), "utf8"), /isBlank:/, f);
});

// ------------------------------------------------------------------ preview matches the public page (2D.1)
const PV = jiti(path.join(SRC, "lib/previewPlan.ts"));
const FREE_PLAN = { max_links: 5, max_products: 0, custom_theme_enabled: false };
const PRO_PLAN = { max_links: null, max_products: 20, custom_theme_enabled: true };
const mkLinks = (n) => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, url: `https://x.co/${i}`, sort_order: i }));
const mkProducts = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, sort_order: i }));
await test("preview on a FREE plan shows what the public page shows: first N links, no products (catalogue locked), standard theme", () => {
  const draft = { links: mkLinks(7), products: mkProducts(3), theme_color: "#ff0000", background_color: "#123456", button_style: "fill", name: "Ama" };
  const out = PV.applyPlanToPreview(draft, FREE_PLAN);
  assert.equal(out.profile.links.length, 5);
  assert.deepEqual(out.profile.links.map((l) => l.id), ["l0", "l1", "l2", "l3", "l4"]);
  assert.equal(out.profile.products.length, 0);
  assert.equal(out.hiddenLinks, 2);
  assert.equal(out.hiddenProducts, 3);
  assert.equal(out.themeLocked, true);
  for (const [k, v] of Object.entries(PV.FALLBACK_THEME)) assert.equal(out.profile[k], v, k);
  assert.equal(out.profile.name, "Ama", "everything else passes through");
});
await test("preview on a paid plan changes nothing", () => {
  const draft = { links: mkLinks(7), products: mkProducts(3), theme_color: "#ff0000", button_style: "fill" };
  const out = PV.applyPlanToPreview(draft, PRO_PLAN);
  assert.equal(out.profile.links.length, 7);
  assert.equal(out.profile.products.length, 3);
  assert.equal(out.profile.theme_color, "#ff0000");
  assert.equal(out.themeLocked, false);
  assert.equal(out.hiddenLinks + out.hiddenProducts, 0);
});
await test("preview keeps the owner's own order and never mutates or deletes the draft (nothing saved is touched)", () => {
  const links = [{ id: "b", url: "https://b.co", sort_order: 1 }, { id: "a", url: "https://a.co", sort_order: 0 }, { id: "c", url: "https://c.co", sort_order: 2 }];
  const draft = { links, products: [] };
  const snapshot = JSON.stringify(draft);
  const out = PV.applyPlanToPreview(draft, { max_links: 2, max_products: null, custom_theme_enabled: true });
  assert.deepEqual(out.profile.links.map((l) => l.id), ["a", "b"], "same slicing as the public page: by sort_order");
  assert.equal(JSON.stringify(draft), snapshot);
  assert.equal(draft.links.length, 3);
});
await test("preview with no plan row behaves like the public page does (unlimited lists, standard theme)", () => {
  const out = PV.applyPlanToPreview({ links: mkLinks(9), products: mkProducts(9) }, null);
  assert.equal(out.profile.links.length, 9);
  assert.equal(out.themeLocked, true);
});
await test("the preview's fallback theme equals the literals in the public page (they cannot drift apart)", () => {
  const page = fs.readFileSync(path.join(SRC, "app/[username]/page.tsx"), "utf8").replace(/\r\n/g, "\n");
  const block = page.slice(page.indexOf("if (!isCustomThemeAllowed(ownerPlan))"), page.indexOf("const isOwner") > 0 ? page.indexOf("// Only ever used to suppress") : undefined);
  const grab = (key) => {
    const m = new RegExp(`profile\\.${key} = (null|"[^"]*")`).exec(block);
    assert.ok(m, `public page sets ${key}`);
    return m[1] === "null" ? null : m[1].slice(1, -1);
  };
  for (const key of Object.keys(PV.FALLBACK_THEME)) assert.equal(PV.FALLBACK_THEME[key], grab(key), key);
});
await test("the preview uses the SAME entitlement helpers as the public page, not a copy of the rules", () => {
  const src = fs.readFileSync(path.join(SRC, "lib/previewPlan.ts"), "utf8");
  // the limit itself is splitByPlanLimit (planEntitlements), reached through limitPublicRows so the order is
  // "drop empty rows, then apply the plan limit" exactly as on the public page
  assert.match(src, /import \{[^}]*limitPublicRows[^}]*\} from "@\/lib\/publicContent"/);
  assert.match(fs.readFileSync(path.join(SRC, "lib/publicContent.ts"), "utf8"), /import \{ splitByPlanLimit \} from "\.\/planEntitlements"/);
  assert.match(src, /isCustomThemeAllowed/);
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /max_links\s*[<>=]|\.slice\(/, "no hand-written limit logic");
  const panel = fs.readFileSync(path.join(SRC, "components/editor/LivePreviewPanel.tsx"), "utf8");
  assert.equal((panel.match(/applyPlanToPreview\(/g) || []).length, 1, "one place computes it, both previews use it");
  assert.equal((panel.match(/profile=\{preview\.profile\}/g) || []).length, 2, "desktop frame and mobile sheet");
});
await test("the preview explains what the public page will not show, and that unsaved edits are included", () => {
  const panel = fs.readFileSync(path.join(SRC, "components/editor/LivePreviewPanel.tsx"), "utf8");
  assert.match(panel, /previewUnsavedNote/);
  assert.match(panel, /linksHiddenByPlan/);
  assert.match(panel, /productsHiddenByPlan/);
  assert.match(panel, /previewThemeNote/);
});

// ------------------------------------------------------------------ "Next:" after a successful Save is the SAME engine as Home (2E.1)
const NS = jiti(path.join(SRC, "components/dashboard/nextStep.ts"));
const HH = jiti(path.join(SRC, "lib/profileHealth/index.ts"));
const { translations: TR } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const PAID_PLAN = { max_products: 20, max_links: null, bookings_feature_enabled: true };
const restaurant = { id: "prof-1", name: "Chez Ama", avatar_url: "a", bio: "b", category: "restaurant_food", whatsapp_number: "+237 600", social_links: [{}], links: [{ url: "https://x.co" }], published: true };
await test("post-save hint: a restaurant without a menu is told to add its menu, with the right Editor section", () => {
  const hint = NS.nextStepAfterSave(restaurant, PAID_PLAN, TR.en, "en", () => []);
  assert.equal(hint.title, TR.en.guidance.rec.menuItems.title);
  assert.equal(hint.href, "/dashboard?section=menu");
  assert.equal(hint.cta, "Next:");
});
await test("post-save hint is in the user's language (EN and FR)", () => {
  assert.equal(NS.nextStepAfterSave(restaurant, PAID_PLAN, TR.fr, "fr", () => []).cta, "Ensuite :");
  assert.equal(NS.nextStepAfterSave(restaurant, PAID_PLAN, TR.fr, "fr", () => []).title, TR.fr.guidance.rec.menuItems.title);
});
await test("post-save hint always equals Home's Next Best Action for the same profile (editor and Home cannot disagree)", () => {
  for (const profile of [restaurant, { ...restaurant, menu_items: [{ name: "Ndolé" }] }, { ...restaurant, menu_items: [{ name: "Ndolé", image_url: "p" }], about_location: "Akwa", opening_hours: { mon: {} } }, { id: "p2", category: "other" }]) {
    const home = HH.computeProfileHealth({ profile, plan: PAID_PLAN }).nextAction;
    const hint = NS.nextStepAfterSave(profile, PAID_PLAN, TR.en, "en", () => []);
    assert.equal(hint?.title, home ? TR.en.guidance.rec[home.id === "catalog" ? "catalog" : home.id].title === undefined ? undefined : (home.id === "catalog" ? TR.en.guidance.rec.catalog.title(home.catalogLabel?.en) : TR.en.guidance.rec[home.id].title) : undefined);
    assert.equal(hint?.href, home ? (home.action === "share" ? "/dashboard/home" : home.href) : undefined);
  }
});
await test("post-save hint moves on after the step is done (blank rows do not count as done)", () => {
  const before = NS.nextStepAfterSave({ ...restaurant, menu_items: [{ name: "" }] }, PAID_PLAN, TR.en, "en", () => []);
  assert.equal(before.href, "/dashboard?section=menu", "an empty dish row is not a menu");
  const after = NS.nextStepAfterSave({ ...restaurant, menu_items: [{ name: "Ndolé" }] }, PAID_PLAN, TR.en, "en", () => []);
  assert.notEqual(after.href, "/dashboard?section=menu");
});
await test("post-save hint skips what this device hid with 'Not now' on Home, and never reads a profile id it does not have", () => {
  const hidden = NS.nextStepAfterSave(restaurant, PAID_PLAN, TR.en, "en", () => ["menuItems"]);
  assert.notEqual(hidden.href, "/dashboard?section=menu");
  let asked = null;
  NS.nextStepAfterSave({ ...restaurant, id: undefined }, PAID_PLAN, TR.en, "en", (id) => { asked = id; return []; });
  assert.equal(asked, null);
});
await test("post-save hint: 'share' has no editor page, so it points to Home; nothing to suggest returns null", () => {
  const complete = { id: "p3", name: "A", avatar_url: "a", bio: "b", category: "other", whatsapp_number: "1", social_links: [{}], links: [{ url: "https://a.co" }], published: true };
  const hint = NS.nextStepAfterSave(complete, PAID_PLAN, TR.en, "en", () => []);
  assert.equal(hint.href, "/dashboard/home");
  assert.equal(NS.nextStepAfterSave(complete, PAID_PLAN, TR.en, "en", () => ["shareProfile"]), null);
});
await test("EditorSection computes the hint after the rows are swapped in, clears it on reopen, and the feedback links correctly", () => {
  const section = fs.readFileSync(path.join(SRC, "components/dashboard/EditorSection.tsx"), "utf8").replace(/\r\n/g, "\n");
  const timer = section.slice(section.indexOf("window.setTimeout(() => {\n        setSaveState(\"idle\");"), section.indexOf("} else if (outcome === \"error\")"));
  assert.match(timer, /setNextHint\(nextStepAfterSave\(draftRef\.current, preview\.plan, t, locale\)\)/);
  assert.match(section, /setNextHint\(null\);\n\s+return;/, "cleared when the section opens again");
  const fb = fs.readFileSync(path.join(SRC, "components/dashboard/SectionFeedback.tsx"), "utf8");
  assert.match(fb, /startsWith\("\/dashboard\?section="\)/, "section links are real page loads (the accordion reads its open section only on mount)");
});

// ------------------------------------------------------------------ accessibility semantics (2D.2, 2D.3)
const src = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8").replace(/\r\n/g, "\n");
await test("the unsaved-changes dialog is a real modal: role, aria-modal, labelled and described, focus trapped, 44px actions", () => {
  // comments stripped: a comment that merely mentions role="dialog" must not satisfy the check
  const d = src("components/dashboard/UnsavedChangesDialog.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.match(d, /role="dialog"/);
  assert.match(d, /aria-modal="true"/);
  assert.match(d, /aria-labelledby=\{titleId\}/);
  assert.match(d, /aria-describedby=\{bodyId\}/);
  assert.match(d, /useModalA11y/);
  assert.equal((d.match(/min-h-\[44px\]/g) || []).length, 2);
});
await test("the mobile preview sheet is a real modal with Escape, focus return, a labelled 44px close button, and a labelled opener", () => {
  const p = src("components/editor/LivePreviewPanel.tsx");
  assert.match(p, /role="dialog"/);
  assert.match(p, /aria-modal="true"/);
  assert.match(p, /useModalA11y/);
  assert.match(p, /aria-label=\{t\.editor\.closePreview\}/);
  assert.match(p, /w-11 h-11[^"]*"[\s\S]{0,40}>\s*<X /);
  assert.match(p, /aria-haspopup="dialog"/);
});
await test("section feedback is announced: a polite status region that is always mounted, and an alert region for failures", () => {
  const f = src("components/dashboard/SectionFeedback.tsx");
  assert.match(f, /role="status"\s+aria-live="polite"/);
  assert.match(f, /role="alert"/);
  assert.match(f, /min-h-\[44px\]/);
});
await test("reduced motion: accordion, editor shell, durations and global CSS all respect prefers-reduced-motion", () => {
  assert.match(src("components/ui/Accordion.tsx"), /useReducedMotion\(\)/);
  assert.match(src("components/Editor.tsx"), /<MotionConfig reducedMotion="user">/);
  assert.match(src("components/ui/useMotionDuration.ts"), /reduce \? 0 : seconds/);
  for (const f of ["LinkRow", "MenuItemRow", "ProductRow", "TrackRow"]) assert.match(src(`components/editor/${f}.tsx`), /duration: dur\(0\.2\)/, f);
  const css = src("app/globals.css");
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(block, /\.animate-fade-up/);
  assert.match(block, /\.animate-fade-in/);
  assert.match(block, /\.animate-dropdown-in/);
});
await test("touch targets: the icon-only controls that were 28-32px are now at least 44px", () => {
  for (const [file, bad] of [["editor/AudioUploadField.tsx", "w-8 h-8"], ["editor/ProtectedAudioUploadField.tsx", "w-8 h-8"], ["editor/AvatarCropperField.tsx", "w-7 h-7 rounded-lg"], ["editor/SocialLinksCard.tsx", "w-8 h-8"]]) {
    assert.ok(!src(`components/${file}`).includes(bad), `${file} still has ${bad}`);
  }
  assert.match(src("components/editor/MenuCategorySection.tsx"), /w-11 h-11/);
  assert.match(src("components/editor/TablesCard.tsx"), /w-11 h-11 flex items-center justify-center rounded-lg/);
});
await test("icon-only delete buttons have an accessible name", () => {
  assert.match(src("components/editor/MusicReleasesCard.tsx"), /aria-label=\{t\.editor\.delete\}/);
  assert.match(src("components/editor/TablesCard.tsx"), /aria-label=\{t\.editor\.delete\}/);
  assert.doesNotMatch(src("components/editor/MenuCategorySection.tsx"), /aria-label="toggle"/);
});
await test("advanced groups use a native <details> (keyboard operable, announced) and keep their fields mounted so Save still reads them", () => {
  const d = src("components/ui/Disclosure.tsx");
  assert.match(d, /<details/);
  assert.match(d, /<summary/);
  assert.match(d, /min-h-\[44px\]/);
  for (const f of ["AboutCard", "PixelsCard", "ThemeCard"]) assert.match(src(`components/editor/${f}.tsx`), /<Disclosure/, f);
});

// ------------------------------------------------------------------ strings: complete in EN + FR, no hard-coded English (2G)
function walk(v, p, out) {
  if (typeof v === "function") out[p] = "fn" + v.length;
  else if (v && typeof v === "object") for (const k of Object.keys(v)) walk(v[k], p ? `${p}.${k}` : k, out);
  else out[p] = typeof v;
  return out;
}
await test("the ENTIRE translation file has identical keys and function signatures in English and French", () => {
  const en = walk(TR.en, "", {});
  const fr = walk(TR.fr, "", {});
  assert.deepEqual(Object.keys(en).filter((k) => !(k in fr)), []);
  assert.deepEqual(Object.keys(fr).filter((k) => !(k in en)), []);
  assert.deepEqual(Object.keys(en).filter((k) => en[k] !== fr[k]), []);
});
const newKeys = [
  ["editor", "autosave"], ["editor", "validation"], ["editor", "postSave"], ["editor", "linksEmptyHint"], ["editor", "noProductsHint"], ["editor", "previewUnsavedNote"], ["editor", "previewThemeNote"],
  ["editor", "advancedServerTracking"], ["editor", "advancedServerTrackingHint"], ["editor", "theme", "moreOptions"], ["editor", "theme", "moreOptionsHint"],
  ["editor", "about", "allOptionalHint"], ["editor", "about", "moreDetails"], ["editor", "about", "moreDetailsHint"],
  ["restaurant", "newCategoryName"], ["restaurant", "deleteCategoryConfirm"], ["restaurant", "menuEmptyHint"], ["restaurant", "toggleCategory"], ["restaurant", "moveCategoryUp"], ["restaurant", "moveCategoryDown"], ["restaurant", "deleteCategory"], ["restaurant", "deleteTableConfirm"],
  ["music", "deleteReleaseConfirm"],
];
const at = (tree, keys) => keys.reduce((o, k) => o?.[k], tree);
await test("every string added in Phase 2 exists in both languages, is non-empty, and French is not a copy of English", () => {
  const flat = (v, out = []) => (typeof v === "string" ? (out.push(v), out) : typeof v === "function" ? (out.push(String(v(3, 5))), out) : (Object.values(v).forEach((x) => flat(x, out)), out));
  for (const keys of newKeys) {
    const en = at(TR.en, keys);
    const fr = at(TR.fr, keys);
    assert.ok(en !== undefined && fr !== undefined, keys.join("."));
    const enText = flat(en);
    const frText = flat(fr);
    assert.ok(enText.every((s) => s.trim().length > 0) && frText.every((s) => s.trim().length > 0), `${keys.join(".")} has an empty string`);
    assert.notDeepEqual(frText, enText, `${keys.join(".")} is not translated`);
  }
});
await test("no English-only text in the new components: no JSX text and no literal aria-label / title / placeholder", () => {
  for (const f of ["components/dashboard/SectionFeedback.tsx", "components/dashboard/UnsavedNavigationGuard.tsx", "components/dashboard/UnsavedChangesDialog.tsx", "components/ui/Disclosure.tsx", "components/editor/LivePreviewPanel.tsx", "components/editor/ProfileCompletionCard.tsx"]) {
    const code = src(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const jsxText = [...code.matchAll(/>\s*([A-Za-z][A-Za-z ,.'’!?:-]{2,})\s*</g)].map((m) => m[1]);
    assert.deepEqual(jsxText, [], `${f} has literal text`);
    assert.doesNotMatch(code, /(aria-label|title|placeholder)="[A-Za-z]/, `${f} has a literal label`);
  }
});
await test("no editor card passes a hard-coded string to window.confirm (all confirmations are translated)", () => {
  const dir = path.join(SRC, "components/editor");
  const bad = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".tsx"))) {
    if (f === "EventTicketTypesEditor.tsx") continue; // Tickets pages
    if (/window\.confirm\(\s*["'`]/.test(src(`components/editor/${f}`))) bad.push(f);
  }
  assert.deepEqual(bad, []);
});

// ------------------------------------------------------------------ editor, preview, Profile Health and Home agree (2E.2)
await test("continuity: whatever Save will create, Profile Health counts; whatever it drops or refuses, Profile Health ignores", () => {
  const rows = [
    { id: "new:1", title: "", url: "https://" },
    { id: "new:2", title: "", url: "" },
    { id: "new:3", title: "Shop", url: "shop.example.cm" },
    { id: "l1", title: "Old", url: "https://old.co" },
  ];
  const plan = L.planLinksSave(rows, norm);
  const saved = [...plan.inserts.map((i) => i.row), ...plan.updates.map((u) => u.row)].map((r) => r.id).sort();
  const counted = HH.meaningfulRows({ links: rows }).links.map((r) => r.id).sort();
  assert.deepEqual(saved, ["l1", "new:3"]);
  assert.deepEqual(counted, saved);
});
await test("continuity: the offering count that feeds the 'first item' milestone ignores exactly what Save drops", () => {
  const products = [{ id: "new:1", name: "" }, { id: "new:2", name: "Braids" }, { id: "p1", name: "Gel" }];
  const plan = P.planProductsSave(products);
  assert.deepEqual(plan.drop, ["new:1"]);
  assert.equal(HH.countOffering({ products }), plan.inserts.length + plan.updates.length);
  const dishes = [{ id: "new:1", name: "" }, { id: "m1", name: "Soya" }];
  assert.equal(HH.countOffering({ menu_items: dishes }), MS.planMenuItemsSave(dishes).updates.length);
});

// ------------------------------------------------------------------ wiring that has no pure seam: leaving waits for auto-saves; the hook rolls back (2B)
await test("leaving a section waits for pending auto-saves BEFORE deciding whether to warn (no race with a debounced write)", () => {
  const section = src("components/dashboard/EditorSection.tsx");
  const guard = section.slice(section.indexOf("const guard = async () => {"), section.indexOf("const handleSave"));
  assert.ok(guard.indexOf("await engine.flush()") > -1 && guard.indexOf("await engine.flush()") < guard.indexOf("sectionWarnsOnLeave("), "flush first, then decide");
  assert.match(guard, /if \(!mustWarn\) return true;/);
  assert.match(guard, /s\.retryable > 0 \|\| s\.uncommitted > 0 \? "autosave" : "buffered"/);
});
await test("a section reports real unsaved work to the page (and clears it on unmount) so refresh / close / links are protected only when needed", () => {
  const section = src("components/dashboard/EditorSection.tsx");
  assert.match(section, /reportUnsaved\(id, warn\);\s*return \(\) => reportUnsaved\(id, false\);/);
  assert.match(section, /const warn = sectionWarnsOnLeave\(\{ saverCount, dirty, autoRetryable: auto\.retryable, uncommitted: auto\.uncommitted \}\);/);
});
await test("Discard resets the engine, the draft keys and the saved-failure note", () => {
  const section = src("components/dashboard/EditorSection.tsx");
  const discard = section.slice(section.indexOf("const handleDiscard"), section.indexOf("return (\n    <>"));
  for (const needle of ["setDirty(false)", "setSaveFailedNote(false)", "engine.reset()", "touchedKeysRef.current.clear()"]) assert.ok(discard.includes(needle), needle);
});
await test("the rows hook: add waits for the database, remove and reorder roll back, field saves are keyed and retryable, temp rows never reach the database", () => {
  const hook = src("components/editor/useAutosavedRows.ts");
  const part = (from, to) => hook.slice(hook.indexOf(from), hook.indexOf(to));
  assert.match(part("const add = async", "const remove = async"), /rollback: \(\) => \{\}/);
  assert.match(part("const add = async", "const remove = async"), /res\.error \|\| !res\.data \? \{ error:/);
  assert.match(part("const remove = async", "const reorder = "), /rollback: \(\) => \{[\s\S]*next\.splice\(Math\.min\(index, next\.length\), 0, removed\)/);
  assert.match(part("const remove = async", "const reorder = "), /if \(isTempId\(id\)\) return true;/);
  assert.match(part("const reorder = ", "const replace = "), /autosave\.schedule\(/);
  assert.match(part("const reorder = ", "const replace = "), /rollback: \(\) => \{[\s\S]*savedSort\.current\.get\(r\.id\)/);
  assert.match(part("const reorder = ", "const replace = "), /!isTempId\(r\.id\)/);
  assert.match(part("const persist = ", "const add = async"), /isTempId\(id\)\s*\?\s*Promise\.resolve\(true\)/);
  assert.match(part("const persist = ", "const add = async"), /key: `\$\{table\}:\$\{id\}:/);
});
await test("rows added with 'Add' in Links, Products, Menu dishes and extra phones exist on screen only (addLocal), never as a database insert", () => {
  for (const f of ["LinksCard", "CatalogCard", "MenuCard", "AboutCard"]) assert.match(src(`components/editor/${f}.tsx`), /addLocal\(/, f);
  assert.doesNotMatch(src("components/editor/LinksCard.tsx"), /\.insert\(\{[^}]*title: ""/);
  assert.match(src("components/editor/MenuCard.tsx"), /name: t\.restaurant\.newCategoryName/, "a new category gets a real name, never a blank one");
});
await test("Save refuses rows with errors BEFORE writing anything (no partial save from a form with a visible error)", () => {
  for (const [f, fn] of [["LinksCard", "const saveAll = async"], ["CatalogCard", "const saveAll = async"], ["MenuCard", "const saveAllItems = async"]]) {
    const whole = src(`components/editor/${f}.tsx`);
    const body = whole.slice(whole.indexOf(fn));
    const at = body.indexOf("if (Object.keys(messages).length > 0) return false;");
    assert.ok(at > 0, f);
    assert.ok(at < body.indexOf(".update("), `${f}: validation precedes the first update`);
    assert.ok(at < body.indexOf(".insert("), `${f}: validation precedes the first insert`);
  }
});
await test("a retried Save cannot create a row twice: every created row is swapped in as soon as it exists", () => {
  for (const f of ["LinksCard", "CatalogCard", "MenuCard"]) assert.match(src(`components/editor/${f}.tsx`), /swapIn\(ins\.row\.id,/, f);
  assert.match(src("components/editor/AboutCard.tsx"), /created\.set\(p\.id, data\)/);
});
await test("the public page and preview both render link addresses through displayHref (older bare addresses are no longer relative links)", () => {
  assert.match(src("components/ProfileView.tsx"), /href=\{displayHref\(link\.url\)\}/);
  assert.equal((src("components/SocialIcon.tsx").match(/href=\{displayHref\(url\)\}/g) || []).length, 2);
});

// ------------------------------------------------------------------ audit fixes: music blank rows, AI knowledge, accordion
const MB = jiti(path.join(SRC, "components/editor/musicBlank.ts"));
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
await test("music: a track with ANY user content is never treated as abandoned; a genuinely empty one still is", () => {
  const fresh = { id: "t", profile_id: "p", title: "", sort_order: 0 };
  assert.equal(MB.isBlankTrack(fresh), true, "a just-added row is blank");
  assert.equal(MB.isBlankTrack({ ...fresh, title: "   ", artist_name: " ", genre: "", duration: "", price: "", buy_url: "", release_id: null, available: true, download_enabled: true }), true, "whitespace / defaults only");
  const single = {
    title: "Song", artist_name: "Ada", genre: "Afrobeats", duration: "3:20", description: "d", release_id: "r1", audio_url: "https://a/x.mp3",
    protected_audio_path: "u/x.mp3", preview_audio_url: "https://a/p.mp3", external_url: "https://y.be/1", buy_url: "https://pay/1", cover_image_url: "https://a/c.jpg",
    price: "1500",
  };
  for (const [k, v] of Object.entries(single)) assert.equal(MB.isBlankTrack({ ...fresh, [k]: v }), false, `${k}-only track must be kept`);
  assert.equal(MB.isBlankTrack({ ...fresh, price: 500 }), false, "numeric price");
  assert.equal(MB.isBlankTrack({ ...fresh, price: 0 }), true, "price 0 is the empty default");
  assert.equal(MB.isBlankTrack({ ...fresh, title: "" , artist_name: "Ada" }), false, "metadata-only with empty title is kept");
});
await test("music: a release with ANY user content is never treated as abandoned; one created empty still is", () => {
  const fresh = { id: "r", profile_id: "p", title: "", release_type: "ep", price: 0, sort_order: 0 };
  assert.equal(MB.isBlankRelease(fresh), true);
  assert.equal(MB.isBlankRelease({ ...fresh, title: "  ", description: " ", cover_image_url: "", price: "" }), true);
  for (const [k, v] of Object.entries({ title: "EP", description: "about", cover_image_url: "https://a/c.jpg", price: 2000 })) {
    assert.equal(MB.isBlankRelease({ ...fresh, [k]: v }), false, `${k}-only release must be kept`);
  }
  assert.equal(MB.isBlankRelease({ ...fresh, price: "2000" }), false);
});
await test("music: both cards clean up through the shared helper, and every persisted TrackRow field is covered by it", () => {
  assert.match(stripComments(src("components/editor/TracksCard.tsx")), /isBlank: isBlankTrack,/);
  assert.match(stripComments(src("components/editor/MusicReleasesCard.tsx")), /isBlank: isBlankRelease,/);
  const row = stripComments(src("components/editor/TrackRow.tsx"));
  const helper = stripComments(src("components/editor/musicBlank.ts"));
  const persisted = new Set([...row.matchAll(/onPersist\(\{\s*([a-z_]+)/g)].map((m) => m[1]));
  for (const f of persisted) {
    if (["available", "download_enabled"].includes(f)) continue; // on/off switches that start on, not content
    assert.match(helper, new RegExp(`tr\\?\\.${f}\\b`), `TrackRow saves ${f} but isBlankTrack ignores it`);
  }
  const rel = stripComments(src("components/editor/MusicReleasesCard.tsx"));
  for (const f of [...rel.matchAll(/persistRelease\(release\.id, \{\s*([a-z_]+)/g)].map((m) => m[1])) {
    if (f === "available") continue;
    assert.match(helper, new RegExp(`r\\?\\.${f}\\b`), `releases save ${f} but isBlankRelease ignores it`);
  }
});
await test("AI knowledge: tables are not described as 'uploads need it'; phone removal and blank-track keeping are stated", () => {
  const k = stripComments(src("lib/ai/knowledge/modules/editorSaving.ts"));
  assert.doesNotMatch(k, /restaurant tables the item is created as soon as you press Add \(uploads need it\)/);
  assert.match(k, /Restaurant tables are also created as soon as you press Add/);
  assert.match(k, /Removing a saved extra phone number takes effect at once/);
  assert.match(k, /one with any detail \(artist, genre, price, link, audio, cover/);
});
await test("accordion: a section's status line renders INSIDE its row, so the last row is still the container's last child", () => {
  const acc = stripComments(src("components/ui/Accordion.tsx"));
  assert.match(acc, /footer\?: React\.ReactNode;/);
  assert.match(acc, /<\/AnimatePresence>\s*\{footer\}\s*<\/div>/);
  const sec = stripComments(src("components/dashboard/EditorSection.tsx"));
  const afterItem = sec.slice(sec.indexOf("</AccordionItem>"));
  assert.doesNotMatch(afterItem.slice(0, afterItem.indexOf("showUnsavedDialog")), /<SectionFeedback/, "SectionFeedback must not be a sibling after the row");
  assert.match(sec, /footer=\{\s*<SectionFeedback/);
});
// ------------------------------------------------------------------ audit: placeholders must not use up plan slots
await test("plan limit: empty placeholder links do NOT use a visible slot; real links do; a real link after placeholders is shown", () => {
  const links = [
    { id: "h1", url: "https://", title: "", sort_order: 0 },
    { id: "h2", url: "", title: "x", sort_order: 1 },
    { id: "r1", url: "https://one.co", title: "One", sort_order: 2 },
    { id: "h3", url: "javascript:alert(1)", title: "bad", sort_order: 3 },
    { id: "r2", url: "two.co", title: "Two", sort_order: 4 },
    { id: "r3", url: "https://three.co", title: "Three", sort_order: 5 },
  ];
  const out = PV.applyPlanToPreview({ links, products: [] }, { max_links: 2, max_products: null, custom_theme_enabled: true });
  assert.deepEqual(out.profile.links.map((l) => l.id), ["r1", "r2"], "the first TWO real links are visible, whatever sits before them");
  assert.equal(out.hiddenLinks, 1, "only the real link over the limit is reported hidden");
  assert.equal(links.length, 6, "the draft still has every row");
  const none = PV.applyPlanToPreview({ links, products: [] }, { max_links: 3, max_products: null, custom_theme_enabled: true });
  assert.deepEqual(none.profile.links.map((l) => l.id), ["r1", "r2", "r3"]);
  assert.equal(none.hiddenLinks, 0);
});
await test("plan limit: nameless products do NOT use a visible slot; named ones do", () => {
  const products = [
    { id: "p0", name: "", price: 500, sort_order: 0 },
    { id: "p1", name: "Shirt", sort_order: 1 },
    { id: "p2", name: "  ", sort_order: 2 },
    { id: "p3", name: "Cap", sort_order: 3 },
    { id: "p4", name: "Bag", sort_order: 4 },
  ];
  const out = PV.applyPlanToPreview({ links: [], products }, { max_links: null, max_products: 2, custom_theme_enabled: true });
  assert.deepEqual(out.profile.products.map((p) => p.id), ["p1", "p3"]);
  assert.equal(out.hiddenProducts, 1);
});
await test("plan limit: unlimited plans and exactly-at-limit lists behave as before (hollow rows are simply not shown)", () => {
  const links = [{ id: "a", url: "https://a.co", sort_order: 0 }, { id: "h", url: "https://", sort_order: 1 }, { id: "b", url: "https://b.co", sort_order: 2 }];
  const unlimited = PV.applyPlanToPreview({ links, products: [] }, { max_links: null, max_products: null, custom_theme_enabled: true });
  assert.deepEqual(unlimited.profile.links.map((l) => l.id), ["a", "b"]);
  assert.equal(unlimited.hiddenLinks, 0);
  const exact = PV.applyPlanToPreview({ links, products: [] }, { max_links: 2, max_products: null, custom_theme_enabled: true });
  assert.deepEqual(exact.profile.links.map((l) => l.id), ["a", "b"]);
  assert.equal(exact.hiddenLinks, 0, "two real links on a two-link plan: nothing hidden (the placeholder is not counted)");
  const zero = PV.applyPlanToPreview({ links, products: [] }, { max_links: 0, max_products: null, custom_theme_enabled: true });
  assert.deepEqual(zero.profile.links, [], "a plan with no links shows none");
});
await test("plan limit: the public profile and the preview both use the SAME helper, in the same order", () => {
  const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const rd = (r) => strip(fs.readFileSync(path.join(SRC, r), "utf8").replace(/\r\n/g, "\n"));
  const page = rd("app/[username]/page.tsx");
  assert.match(page, /limitPublicRows<any>\(profile\.links, isPublicLink, ownerPlan\?\.max_links \?\? null\)/);
  assert.match(page, /limitPublicRows<any>\(profile\.products, isPublicProduct, ownerPlan\?\.max_products \?\? null\)/);
  assert.doesNotMatch(page, /splitByPlanLimit\(/, "no limit applied to raw rows");
  // the music storefront (/m) is a protected music-commerce file and is deliberately not touched
  const prev = rd("lib/previewPlan.ts");
  assert.match(prev, /limitPublicRows<any>\(links, isPublicLink, maxLinks\)\.visible/);
  assert.match(prev, /limitPublicRows<any>\(products, isPublicProduct, maxProducts\)\.visible/);
  assert.doesNotMatch(prev, /splitByPlanLimit\(/);
  const helper = rd("lib/publicContent.ts");
  assert.match(helper, /return splitByPlanLimit\(publicRows<T>\(rows, test\), maxCount\);/, "filter first, then the existing limit helper");
});
await test("plan limit: the page and the preview give the same visible rows for the same data", () => {
  const PC = jiti(path.join(SRC, "lib/publicContent.ts"));
  const rows = [
    { id: "x", url: "", sort_order: 0 },
    { id: "a", url: "https://a.co", sort_order: 2 },
    { id: "y", url: "https://", sort_order: 3 },
    { id: "b", url: "https://b.co", sort_order: 1 },
    { id: "c", url: "https://c.co", sort_order: 4 },
  ];
  for (const max of [null, 0, 1, 2, 3, 10]) {
    const page = PC.limitPublicRows(rows, PC.isPublicLink, max).visible.map((r) => r.id);
    const preview = PV.applyPlanToPreview({ links: rows, products: [] }, { max_links: max, max_products: null, custom_theme_enabled: true }).profile.links.map((r) => r.id);
    assert.deepEqual(preview, page, "max " + max);
  }
});
await test("an advanced group opens by default only ONCE: later changes of the parent value never collapse it while the user is editing", () => {
  const d = src("components/ui/Disclosure.tsx");
  assert.match(d, /"use client"/);
  assert.match(d, /const \[initiallyOpen\] = useState\(defaultOpen\);/);
  assert.match(d, /<details open=\{initiallyOpen\}/);
  assert.doesNotMatch(d.replace(/\/\/.*$/gm, ""), /<details open=\{defaultOpen\}/, "the prop itself must not drive the element on every render");
});

if (failures.length) {
  console.log(`FAIL: ${failures.length} failed, ${passed} passed`);
  failures.forEach((f) => console.log(" - " + f));
  process.exit(1);
}
console.log(`PASS: ${passed} tests passed`);
