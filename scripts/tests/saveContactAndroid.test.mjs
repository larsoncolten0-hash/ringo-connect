// Save Contact on Android: the Contacts "create contact" intent, its safe encoding, the vCard fallback, and proof that iPhone / desktop / the vCard itself are unchanged.
// Run: node scripts/tests/saveContactAndroid.test.mjs
// These tests exercise the real code with fake browser dependencies. They do NOT prove how a physical Android phone behaves: that still needs a device (see the report).
import fs from "fs";
import path from "path";
import assert from "assert";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { CHURCH_SERVICE_SCHEDULE_FILES } from "./churchServiceScheduleFiles.mjs"; // the church weekly-services phase sits on top of this one: its exact files are exempt
import { CUSTOMER_CONSENT_FILES } from "./customerConsentFiles.mjs"; // the Phase 3A consent work sits on top of this one: its exact files are exempt
import { CUSTOMER_RETENTION_FILES } from "./customerRetentionFiles.mjs"; // the Phase 3 retention work likewise

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const raw = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true, cache: false });
const v = jiti(path.join(REPO, "src/lib/vcard.ts"));

let passed = 0;
const failures = [];
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};

// ---- helpers ----
const PREFIX = "intent:#Intent;action=android.intent.action.INSERT;type=vnd.android.cursor.dir/contact;";
// Parses an intent link the way Android does: split on ";" first, then decode each value.
function parseIntent(url) {
  assert.ok(url.startsWith(PREFIX), "prefix");
  assert.ok(url.endsWith(";end"), "ends with ;end");
  const body = url.slice(PREFIX.length, -";end".length);
  const extras = [];
  for (const part of body.split(";")) {
    const m = /^S\.([a-z_]+)=(.*)$/.exec(part);
    assert.ok(m, "every segment is one S.<key>=<value> extra, got: " + part);
    extras.push([m[1], decodeURIComponent(m[2])]);
  }
  return extras;
}
const keys = (extras) => extras.map(([k]) => k);
const get = (extras, k) => extras.find(([x]) => x === k)?.[1];

const FULL = {
  name: "Maria Boutique, Ltd",
  about_position: "Owner; Chef",
  about_company: "Maria & Co",
  whatsapp_number: "237677123456",
  about_phone: "237677123456",
  profile_phone_numbers: [{ phone_number: "237 699 000 111" }, { phone_number: " " }],
  about_email: "maria@example.com",
  about_location: "Douala, Cameroon",
};
const URL_ = "https://ringoconnectltd.com/maria?x=1,2&y=a;b#frag";

const UA = {
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
  webview: "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36",
  instagram: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 300.0.0.0.0 Android",
  facebook: "Mozilla/5.0 (Linux; Android 12; SM-A52) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.0;]",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  desktopChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

// ---- the vCard itself is unchanged (golden strings captured from the code BEFORE this change) ----
test("vCard: output is byte-for-byte what it was (full profile, dedupe, escaping, URL, blank phone ignored)", () => {
  assert.equal(
    v.buildVCard(FULL, "https://ringoconnectltd.com/maria?x=1,2"),
    "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Maria Boutique\\, Ltd\r\nN:Boutique\\, Ltd;Maria;;;\r\nTITLE:Owner\\; Chef\r\nORG:Maria & Co\r\nTEL;TYPE=CELL:237677123456\r\nTEL;TYPE=CELL:237 699 000 111\r\nEMAIL:maria@example.com\r\nADR;TYPE=WORK:;;Douala\\, Cameroon;;;;\r\nURL:https://ringoconnectltd.com/maria?x=1\\,2\r\nEND:VCARD"
  );
});
test("vCard: minimal profile and the file name are unchanged", () => {
  assert.equal(v.buildVCard({ name: "Solo", whatsapp_number: "123" }), "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Solo\r\nN:;Solo;;;\r\nTEL;TYPE=CELL:123\r\nEND:VCARD");
  assert.equal(v.vCardFileName(FULL), "Maria-Boutique-Ltd.vcf");
  assert.equal(v.vCardFileName({}), "contact.vcf");
});

// ---- intent construction ----
test("intent: pre-fills name, phones (deduped), e-mail, company, job title, address and the page link", () => {
  const url = v.buildAndroidContactIntent(FULL, URL_);
  const ex = parseIntent(url);
  assert.deepEqual(keys(ex), ["name", "phone", "secondary_phone", "email", "company", "job_title", "postal", "notes"]);
  assert.equal(get(ex, "name"), "Maria Boutique, Ltd");
  assert.equal(get(ex, "phone"), "237677123456");
  assert.equal(get(ex, "secondary_phone"), "237 699 000 111", "the whatsapp/about duplicate is one number, in the same order as the vCard");
  assert.equal(get(ex, "email"), "maria@example.com");
  assert.equal(get(ex, "company"), "Maria & Co");
  assert.equal(get(ex, "job_title"), "Owner; Chef");
  assert.equal(get(ex, "postal"), "Douala, Cameroon");
  assert.equal(get(ex, "notes"), URL_);
});
test("intent: uses the same phone list as the vCard (same numbers, same order)", () => {
  const p = { name: "X", whatsapp_number: "111", about_phone: "222", profile_phone_numbers: [{ phone_number: "333" }, { phone_number: "111" }] };
  const vcardPhones = [...v.buildVCard(p).matchAll(/TEL;TYPE=CELL:(.*)\r?\n?/g)].map((m) => m[1].replace(/\r$/, ""));
  const ex = parseIntent(v.buildAndroidContactIntent(p));
  assert.deepEqual([get(ex, "phone"), get(ex, "secondary_phone"), get(ex, "tertiary_phone")], vcardPhones);
});
test("intent: at most three phones; the rest stay in the vCard fallback", () => {
  const p = { name: "X", whatsapp_number: "1", about_phone: "2", profile_phone_numbers: [{ phone_number: "3" }, { phone_number: "4" }] };
  const ex = parseIntent(v.buildAndroidContactIntent(p));
  assert.deepEqual(keys(ex).filter((k) => /phone/.test(k)), ["phone", "secondary_phone", "tertiary_phone"]);
  assert.equal(v.buildVCard(p).split("TEL;").length - 1, 4, "the vCard still has all four");
});
test("intent: optional fields are left out, the name falls back to 'Contact'", () => {
  const ex = parseIntent(v.buildAndroidContactIntent({ whatsapp_number: "237600000000" }));
  assert.deepEqual(ex, [["name", "Contact"], ["phone", "237600000000"]]);
});
test("intent: null when there is no phone and no e-mail (nothing to pre-fill); e-mail alone is enough", () => {
  assert.equal(v.buildAndroidContactIntent({ name: "Only Name" }), null);
  assert.equal(v.buildAndroidContactIntent(null), null);
  assert.equal(v.buildAndroidContactIntent(undefined), null);
  assert.ok(v.buildAndroidContactIntent({ name: "Mail", about_email: "a@b.co" }));
});
test("intent: hostile values cannot break out of their extra or add one (';' '=' '#' 'end', injected extras)", () => {
  const evil = "A;end;S.phone=999;S.package=com.evil;action=android.intent.action.CALL#Intent;end";
  const url = v.buildAndroidContactIntent({ name: evil, whatsapp_number: "1;S.phone=999", about_email: "x@y.z;end", about_company: ";;;=", about_location: "end;end" }, "https://x.test/?a=b;c=d#e");
  const ex = parseIntent(url); // parseIntent itself fails if any segment is not exactly one S.<key>=<value>
  assert.deepEqual(keys(ex), ["name", "phone", "email", "company", "postal", "notes"]);
  assert.equal(get(ex, "name"), evil, "kept as plain text");
  assert.equal(url.split(";").length, 3 + keys(ex).length + 1, "the only ';' are the structural ones");
  assert.equal((url.match(/;end/g) || []).length, 1, "'end' appears once, at the very end");
  for (const bad of ["package", "component", "selector", "launchFlags", "browser_fallback_url"]) assert.ok(!keys(ex).includes(bad), bad);
});
test("intent: control characters and line breaks are flattened, length is capped, unicode round-trips", () => {
  const ex = parseIntent(v.buildAndroidContactIntent({ name: "Li\r\nne\tTwo\u0000", whatsapp_number: "1", about_company: "é王😀 Café", about_location: "x".repeat(500) }));
  assert.equal(get(ex, "name"), "Li ne Two");
  assert.equal(get(ex, "company"), "é王😀 Café");
  assert.equal(get(ex, "postal").length, 200);
  const url = v.buildAndroidContactIntent({ name: "a\nb", whatsapp_number: "1" });
  assert.ok(!/[\s\u0000-\u001f]/.test(url), "no raw whitespace or control characters in the link");
});
test("intent: pure and does not mutate its input", () => {
  const p = JSON.parse(JSON.stringify(FULL));
  const a = v.buildAndroidContactIntent(p, URL_);
  assert.deepEqual(p, FULL);
  assert.equal(v.buildAndroidContactIntent(p, URL_), a);
});

// ---- which browsers try the intent ----
test("support: only plain Chrome on Android tries the intent", () => {
  assert.equal(v.supportsAndroidContactIntent({ userAgent: UA.chromeAndroid }), true);
  assert.equal(v.ANDROID_CONTACT_INTENT_ENABLED, true);
});
test("support: Samsung Internet and Firefox are NOT assumed to work (no evidence) - they keep the vCard download", () => {
  for (const ua of [UA.samsung, UA.firefoxAndroid]) assert.equal(v.supportsAndroidContactIntent({ userAgent: ua }), false, ua);
});
test("support: other Android browsers (Edge, Opera, UC, Xiaomi, Brave marker, DuckDuckGo) keep the vCard download", () => {
  const base = UA.chromeAndroid;
  for (const extra of [" EdgA/126.0.0.0", " OPR/80.0.0.0", " UCBrowser/13.4.0.1306", " MiuiBrowser/14.0", " Brave/1.0", " DuckDuckGo/5", " Vivaldi/6.0", " YaBrowser/24.1"]) {
    assert.equal(v.supportsAndroidContactIntent({ userAgent: base + extra }), false, extra);
  }
});
test("support: Android WebViews and in-app browsers keep the vCard download", () => {
  for (const ua of [UA.webview, UA.instagram, UA.facebook]) assert.equal(v.supportsAndroidContactIntent({ userAgent: ua }), false, ua);
});
test("support: client-hint brands are honoured - only genuine 'Google Chrome' qualifies", () => {
  const ua = UA.chromeAndroid;
  const chromeBrands = ["Not)A;Brand", "Google Chrome", "Chromium"];
  assert.equal(v.supportsAndroidContactIntent({ userAgent: ua, userAgentDataPlatform: "Android", userAgentDataBrands: chromeBrands }), true);
  for (const other of ["Microsoft Edge", "Opera", "Samsung Internet", "Brave", "Vivaldi"]) {
    assert.equal(v.supportsAndroidContactIntent({ userAgent: ua, userAgentDataPlatform: "Android", userAgentDataBrands: [...chromeBrands, other] }), false, other);
  }
  assert.equal(v.supportsAndroidContactIntent({ userAgent: ua, userAgentDataPlatform: "Android", userAgentDataBrands: ["Not)A;Brand", "Chromium"] }), false, "plain Chromium without Google Chrome is not enough");
});
test("support: iPhone, iPad and desktop never use it", () => {
  for (const ua of [UA.iphoneSafari, UA.iphoneChrome, UA.ipad, UA.desktopChrome, "", undefined]) assert.equal(v.supportsAndroidContactIntent({ userAgent: ua }), false, String(ua));
});
test("support: the browser-reported platform wins over the user-agent string", () => {
  assert.equal(v.supportsAndroidContactIntent({ userAgent: UA.desktopChrome, userAgentDataPlatform: "Android" }), true, "client hints say Android");
  assert.equal(v.supportsAndroidContactIntent({ userAgent: UA.chromeAndroid, userAgentDataPlatform: "Windows" }), false, "client hints say Windows (desktop mode)");
  assert.equal(v.supportsAndroidContactIntent({ userAgent: UA.iphoneSafari, userAgentDataPlatform: "Android" }), false, "an iPhone is never treated as Android");
});

// ---- click behaviour with fake browser dependencies ----
function harness({ ua = UA.chromeAndroid, platform, visible = true, focused = true, shared = true } = {}) {
  const log = { navigated: [], downloads: 0, prevented: 0, timers: [], listeners: new Set(), cleared: [] };
  let now = 0;
  const deps = {
    env: { userAgent: ua, userAgentDataPlatform: platform },
    navigate: (u) => log.navigated.push(u),
    downloadVCard: () => log.downloads++,
    isPageActive: () => visible && focused,
    inFlight: shared ? { current: false } : undefined,
    onLeave: (cb) => {
      log.listeners.add(cb);
      return () => log.listeners.delete(cb);
    },
    setTimer: (cb, ms) => {
      const t = { cb, at: now + ms, id: log.timers.length };
      log.timers.push(t);
      return t.id;
    },
    clearTimer: (id) => {
      log.cleared.push(id);
      log.timers[id].dead = true;
    },
  };
  const event = { preventDefault: () => log.prevented++ };
  const advance = (ms) => {
    now += ms;
    for (const t of log.timers) if (!t.dead && !t.done && t.at <= now) ((t.done = true), t.cb());
  };
  return { deps, event, log, advance, leave: () => [...log.listeners].forEach((cb) => cb()), hide: () => (visible = false), blurFocus: () => (focused = false) };
}

test("click: Android Chrome takes over - preventDefault once, one navigation to the intent, no download yet", () => {
  const h = harness();
  assert.equal(v.handleSaveContactClick(h.event, FULL, URL_, h.deps), true);
  assert.equal(h.log.prevented, 1);
  assert.deepEqual(h.log.navigated, [v.buildAndroidContactIntent(FULL, URL_)]);
  assert.equal(h.log.downloads, 0);
});
test("click: if the page is still showing after the wait, the vCard download runs once (the fallback)", () => {
  const h = harness();
  v.handleSaveContactClick(h.event, FULL, URL_, h.deps);
  h.advance(1999);
  assert.equal(h.log.downloads, 0, "not before the wait");
  h.advance(1);
  assert.equal(h.log.downloads, 1);
  h.advance(10000);
  assert.equal(h.log.downloads, 1, "only once");
  assert.equal(h.log.listeners.size, 0, "listeners are removed");
});
test("click: if the Contacts app took over (page hidden / left), there is no download", () => {
  const h = harness();
  v.handleSaveContactClick(h.event, FULL, URL_, h.deps);
  h.leave();
  h.advance(10000);
  assert.equal(h.log.downloads, 0);
  assert.equal(h.log.listeners.size, 0);
  assert.equal(h.log.cleared.length, 1, "the pending timer is cancelled");
});
test("click: if the page is hidden when the timer fires, there is no download", () => {
  const h = harness();
  v.handleSaveContactClick(h.event, FULL, URL_, h.deps);
  h.hide();
  h.advance(2000);
  assert.equal(h.log.downloads, 0);
});
test("click: the page is visible but has lost focus when the wait ends (an editor opened on top) - NO download", () => {
  const h = harness();
  v.handleSaveContactClick(h.event, FULL, URL_, h.deps);
  h.blurFocus();
  h.advance(2000);
  assert.equal(h.log.downloads, 0);
  assert.equal(h.deps.inFlight.current, false, "the attempt is over, so the visitor can tap again");
});
test("click: repeated taps during one attempt start one intent and at most one download", () => {
  const h = harness();
  assert.equal(v.handleSaveContactClick(h.event, FULL, URL_, h.deps), true);
  assert.equal(v.handleSaveContactClick(h.event, FULL, URL_, h.deps), true);
  assert.equal(v.handleSaveContactClick(h.event, FULL, URL_, h.deps), true);
  assert.equal(h.log.prevented, 3, "every tap is swallowed so the browser's own download cannot also start");
  assert.equal(h.log.navigated.length, 1, "one intent");
  assert.equal(h.log.timers.length, 1, "one timer");
  assert.equal(h.log.listeners.size, 1, "one set of listeners");
  h.advance(5000);
  assert.equal(h.log.downloads, 1, "one fallback download");
  assert.equal(h.log.listeners.size, 0);
});
test("click: after an attempt finishes, a new tap starts a fresh attempt", () => {
  const h = harness();
  v.handleSaveContactClick(h.event, FULL, URL_, h.deps);
  h.leave();
  assert.equal(h.deps.inFlight.current, false);
  v.handleSaveContactClick(h.event, FULL, URL_, h.deps);
  assert.equal(h.log.navigated.length, 2);
  h.advance(2000);
  assert.equal(h.log.downloads, 1, "only the second (unanswered) attempt falls back");
});
test("click: a leave event after the fallback already ran cannot trigger anything further", () => {
  const h = harness();
  v.handleSaveContactClick(h.event, FULL, URL_, h.deps);
  h.advance(2000);
  h.leave();
  h.advance(5000);
  assert.equal(h.log.downloads, 1);
});
test("click: Samsung Internet and Firefox on Android are untouched (the link downloads the vCard as before)", () => {
  for (const ua of [UA.samsung, UA.firefoxAndroid]) {
    const h = harness({ ua });
    assert.equal(v.handleSaveContactClick(h.event, FULL, URL_, h.deps), false, ua);
    assert.equal(h.log.prevented, 0);
    assert.equal(h.log.navigated.length, 0);
  }
});
test("click: the wait is configurable", () => {
  const h = harness();
  h.deps.waitMs = 500;
  v.handleSaveContactClick(h.event, FULL, URL_, h.deps);
  h.advance(500);
  assert.equal(h.log.downloads, 1);
});
test("click: iPhone Safari / iPhone Chrome / iPad / desktop are untouched - no preventDefault, no navigation, no timer, no listener, no download", () => {
  for (const ua of [UA.iphoneSafari, UA.iphoneChrome, UA.ipad, UA.desktopChrome]) {
    const h = harness({ ua });
    assert.equal(v.handleSaveContactClick(h.event, FULL, URL_, h.deps), false, ua);
    assert.equal(h.log.prevented, 0);
    assert.equal(h.log.navigated.length, 0);
    assert.equal(h.log.timers.length, 0);
    assert.equal(h.log.listeners.size, 0);
    assert.equal(h.log.downloads, 0);
  }
});
test("click: Android WebViews / in-app browsers are untouched (the link downloads the vCard as before)", () => {
  for (const ua of [UA.webview, UA.instagram, UA.facebook]) {
    const h = harness({ ua });
    assert.equal(v.handleSaveContactClick(h.event, FULL, URL_, h.deps), false, ua);
    assert.equal(h.log.prevented, 0);
    assert.equal(h.log.navigated.length, 0);
  }
});
test("click: a profile with nothing to pre-fill is left to the normal link", () => {
  const h = harness();
  assert.equal(v.handleSaveContactClick(h.event, { name: "No phone" }, URL_, h.deps), false);
  assert.equal(h.log.prevented, 0);
});

// ---- wiring in the components (iPhone link and look preserved) ----
const btn = raw("src/components/SaveContactButton.tsx");
const music = raw("src/components/music/profile/MusicArtistView.tsx");
test("button: the link is still the same data: vCard link with the same download name, classes and style", () => {
  assert.ok(btn.includes("const href = `data:text/vcard;charset=utf-8,${encodeURIComponent(vcard)}`;"));
  assert.ok(btn.includes("href={href}") && btn.includes("download={vCardFileName(profile)}"));
  assert.ok(btn.includes('compact ? "flex-1 py-1.5" : "px-4 py-2.5 text-sm font-medium"') && btn.includes("style={style}"));
  assert.ok(btn.includes("if (!profile?.whatsapp_number && !profile?.about_phone) return null;"), "same visibility rule");
});
test("button: the caller's onClick still runs, then the Android handler; the handler only prevents default when it takes over", () => {
  assert.ok(/onClick=\{\(e\) => \{\s*onClick\?\.\(\);\s*saveContactClick\(e, profile\);\s*\}\}/.test(btn));
  assert.ok(!btn.includes(".preventDefault("),"the component never calls preventDefault itself; only handleSaveContactClick does, and only on Android");
});
test("button: the browser wiring uses real events and never claims the contact was saved", () => {
  assert.ok(btn.includes('"visibilitychange"') && btn.includes('"pagehide"') && btn.includes('"blur"'));
  assert.ok(btn.includes("userAgentData") && btn.includes("isPageActive") && btn.includes("document.hasFocus()") && btn.includes("inFlight"));
  assert.ok(!/saved|added to your contacts|success/i.test(btn.replace(/\/\/.*$/gm, "").replace(/saveContact/g, "")), "no 'saved' wording in the UI code");
});
test("music artist page: its duplicate link uses the same handler and keeps its href, download name and styling", () => {
  assert.ok(music.includes('import { saveContactClick } from "@/components/SaveContactButton";'));
  assert.ok(music.includes("<a href={vcardHref} download={vCardFileName(profile)} onClick={(e) => saveContactClick(e, profile)} className={tile} style={tileStyle}>"));
});
test("i18n: no new strings were needed (EN/FR dictionaries untouched by this change)", () => {
  const changed = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
  // a later registered phase may ADD strings (no existing string removed or edited); any other change to a dictionary still fails
  const stat = execFileSync("git", ["diff", "--numstat", "HEAD"], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean).map((l) => l.split("\t"));
  const edited = (f) => stat.some(([, del, name]) => name === f && Number(del) !== 0);
  assert.ok(!changed.some((f) => /translations\.(en|fr)\.ts$/.test(f) && ((!CHURCH_SERVICE_SCHEDULE_FILES.has(f) && !CUSTOMER_CONSENT_FILES.has(f) && !CUSTOMER_RETENTION_FILES.has(f)) || (edited(f) && !CUSTOMER_RETENTION_FILES.has(f)))));
});

// ---- scope ----
test("scope: only Save Contact files (and this test) changed", () => {
  const git = (a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
  const changed = [...git(["diff", "--name-only", "HEAD"]), ...git(["ls-files", "--others", "--exclude-standard"])];
  // the four Save Contact files, this test, and the exact test-registry files phase36Files.mjs lists (the repo's scope-guard convention)
  const allowed = new Set(["src/components/SaveContactButton.tsx", "src/lib/vcard.ts", "src/components/music/profile/MusicArtistView.tsx", "scripts/tests/saveContactAndroid.test.mjs", "scripts/tests/phase36Files.mjs", "scripts/tests/ownerWorkspaceFiles.mjs", "scripts/tests/avatarShape.test.mjs", "scripts/tests/performance.test.mjs"]);
  assert.deepEqual(changed.filter((f) => !allowed.has(f) && !CHURCH_SERVICE_SCHEDULE_FILES.has(f) && !CUSTOMER_CONSENT_FILES.has(f) && !CUSTOMER_RETENTION_FILES.has(f)), []);
});

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL:", f);
process.exit(failures.length ? 1 : 0);
