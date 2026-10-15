// Regression guard for the two Android fixes (phase34Files.mjs):
//   1. "Write Your Ringo Card": the NFC write must be started INSIDE the tap, before any network call. Chrome on Android only shows its NFC permission prompt while the tap is still fresh;
//      doing the card-record request first let a slow connection use it up, and the write then failed with "NFC permission is required" although nothing was refused.
//   2. Dashboard "Add to Home Screen": the menu item mounts only when the avatar menu is opened, but Chrome fires `beforeinstallprompt` once, right after the page loads. The item must read the
//      event from the module-level listener (useInstallPrompt), not add its own listener at mount, or it never hears it and the install option never appears.
// Source-level checks (the hardware / browser behaviour itself needs a real Android phone). Nothing here touches a network or database.
//   Run:  node scripts/tests/androidInstallAndNfc.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
let passed = 0;
const failures = [];
const test = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };

const writer = strip(read("src/components/dashboard/RingoCardWriter.tsx"));
const handle = writer.slice(writer.indexOf("const handleWrite = async"), writer.indexOf("const handleReadCard"));

test("write card: the NFC write is started before the card-record request, inside the same tap", () => {
  const w = handle.indexOf("writeRingoCard(destinationUrl, contact, controller.signal)");
  const f = handle.indexOf('fetch("/api/ringo-cards"');
  assert.ok(w > 0 && f > 0 && w < f, "writeRingoCard must be called before the create fetch");
  assert.ok(!/await fetch/.test(handle.slice(0, w)), "no await fetch before the write starts");
});
test("write card: a failed record request stops the wait for a card, and the write result is checked before anything is committed", () => {
  assert.ok(/controller\.abort\(\); \/\/ no record to attach the write to/.test(read("src/components/dashboard/RingoCardWriter.tsx")) || /controller\.abort\(\)/.test(handle));
  const afterWrite = handle.indexOf("const writeError = await writeOutcome");
  const commit = handle.indexOf("/write`");
  assert.ok(afterWrite > 0 && commit > afterWrite && /if \(writeError\) throw writeError/.test(handle), "the commit only happens after the write succeeded");
});
test("write card: unchanged behaviour — one card record per physical card (a retry reuses cardId), busy guard, commit route and verify untouched", () => {
  assert.ok(/if \(busy \|\| !flow\) return;/.test(handle) && /let cardId = flow\.cardId;/.test(handle) && /if \(!cardId\) \{/.test(handle));
  assert.ok(/fetch\(`\/api\/ringo-cards\/\$\{cardId\}\/write`/.test(handle) && /setStage\("success"\)/.test(handle) && /setErrorKey\(err instanceof RingoCardError \? err\.code : "server"\)/.test(handle));
});

const item = read("src/components/dashboard/AddToHomeScreenMenuItem.tsx");
test("install: the dashboard menu item gets the install event from the module-level listener, not a listener added when the menu opens", () => {
  const code = strip(item);
  assert.ok(/import \{ useInstallPrompt \} from "@\/components\/my-ringo\/useInstallPrompt";/.test(code) && /useInstallPrompt\(\)/.test(code));
  assert.ok(!/addEventListener\("beforeinstallprompt"/.test(code), "no mount-time beforeinstallprompt listener in the item itself");
  assert.ok(/state !== "available" && state !== "ios"\) return null/.test(code), "still renders nothing when installing is not possible (no dead menu item)");
});
test("install: the early listener really is at module level and keeps the event (so a late-mounting consumer still gets it)", () => {
  const hook = read("src/components/my-ringo/useInstallPrompt.ts");
  assert.ok(/if \(typeof window !== "undefined"\) \{\s*window\.addEventListener\("beforeinstallprompt"/.test(hook) && /deferred = e as unknown as Deferred;/.test(hook));
});
test("install: the item is still reached by the avatar menu and the onboarding step, and the service worker / manifest are untouched", () => {
  assert.ok(/<AddToHomeScreenMenuItem onNavigate=\{\(\) => setOpen\(false\)\} \/>/.test(read("src/components/dashboard/AvatarMenu.tsx")));
  assert.ok(/AddToHomeScreenMenuItem/.test(read("src/components/dashboard/OnboardingInstallStep.tsx")));
  assert.ok(/self\.addEventListener\("fetch", \(\) => \{\}\);/.test(read("public/pwa-sw.js")));
  assert.ok(/display: "standalone"/.test(read("src/app/dashboard/manifest.webmanifest/route.ts")));
});

console.log(`androidInstallAndNfc: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(" FAIL:", f.slice(0, 500));
process.exit(failures.length ? 1 : 0);
