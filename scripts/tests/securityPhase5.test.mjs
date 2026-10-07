// Security Phase 5 (infrastructure / secrets): the Next.js image optimizer stays off, no secret-shaped value is committed, nothing secret can reach the
// browser bundle, every cron route fails closed. Reads files only; never prints a secret value. No network.
//   Run:  node scripts/tests/securityPhase5.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
let passed = 0;
const failures = [];
const test = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}\n    ${String(e.message).split("\n").join("\n    ")}`); } };
const tracked = () => execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
const files = tracked();

test("next.config.js: the image optimizer is off and no wildcard remote host is configured", () => {
  const cfg = require(path.join(REPO, "next.config.js"));
  assert.equal(cfg.images?.unoptimized, true);
  assert.deepEqual(cfg.images?.remotePatterns ?? [], []);
  assert.ok(!JSON.stringify(cfg.images).includes("**"));
});
test("the app only passes platform logos to next/image (so switching the optimizer off changes no user-visible behaviour)", () => {
  const bad = [];
  for (const f of files.filter((x) => /^src\/.*\.tsx$/.test(x))) {
    const s = read(f);
    if (!/from "next\/image"/.test(s)) continue;
    for (const m of s.matchAll(/<Image\b[^>]*?\bsrc=\{([^}]+)\}/g)) if (!/^(logoUrl|SYMBOL_SRC|LIGHT_SRC|DARK_SRC)$/.test(m[1].trim())) bad.push(`${f}: ${m[1].trim()}`);
  }
  assert.deepEqual(bad, []);
});
test("no rewrites / redirects / custom server / server actions / pages router (the advisories that need them do not apply)", () => {
  assert.ok(!/\b(rewrites|redirects)\s*\(/.test(read("next.config.js")));
  assert.ok(!files.some((f) => /^(server|src\/pages\/|pages\/)/.test(f)));
  assert.deepEqual(files.filter((f) => /^src\/.*\.(ts|tsx)$/.test(f) && /^\s*["']use server["']/m.test(read(f))), []);
});
test("package.json still pins the reviewed Next.js version (a change must be a reviewed upgrade, not drift)", () => {
  assert.equal(JSON.parse(read("package.json")).dependencies.next, "14.2.35");
});

test("no .env file other than .env.example is tracked, and .env / .env.local stay ignored", () => {
  assert.deepEqual(files.filter((f) => /(^|\/)\.env(\.|$)/.test(f)), [".env.example"]);
  const gi = read(".gitignore");
  assert.ok(/^\.env\.local$/m.test(gi) && /^\.env$/m.test(gi));
});
test(".env.example holds placeholders only (nothing secret-shaped)", () => {
  for (const line of read(".env.example").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || !/(KEY|SECRET|TOKEN|PASSWORD)/.test(m[1]) || m[2] === "") continue;
    assert.ok(/(your|xxx|\.\.\.|changeme|placeholder|example|replace|<|>|generate|0000)/i.test(m[2]), `${m[1]} does not look like a placeholder`);
  }
});
test("no secret-shaped literal is committed (live / test provider keys, webhook secrets, JWTs, private keys)", () => {
  const SHAPES = [/sk_live_[A-Za-z0-9]{16,}/, /sk_test_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /rk_live_[A-Za-z0-9]{16,}/, /AKIA[0-9A-Z]{16}/, /\bre_[A-Za-z0-9]{20,}/, /sk-ant-[A-Za-z0-9_-]{20,}/, /\bsk-[A-Za-z0-9]{32,}/, /\bEAA[A-Za-z0-9]{40,}/, /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
  const hits = [];
  for (const f of files) {
    if (/(^|\/)(package-lock\.json|.*\.(png|jpe?g|webp|ico|woff2?|pdf|mp3|gif|svg))$/i.test(f)) continue;
    let s;
    try { s = fs.readFileSync(path.join(REPO, f), "utf8"); } catch { continue; }
    for (const re of SHAPES) if (re.test(s)) hits.push(`${f}  (${re.source.slice(0, 18)}...)`); // file + pattern family only, never the value
  }
  assert.deepEqual(hits, []);
});
test("the only NEXT_PUBLIC_ variables are public by design (no secret, service, private or token in the name)", () => {
  const names = new Set();
  for (const f of files.filter((x) => /^(src|scripts)\/.*\.(ts|tsx|mjs)$/.test(x) || x === ".env.example")) for (const m of read(f).matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) names.add(m[0]);
  assert.deepEqual([...names].filter((n) => /(SECRET|SERVICE|PRIVATE|TOKEN|PASSWORD|API_KEY)/.test(n)), []);
});
test("server secrets are never read in a file that is bundled for the browser", () => {
  const SECRET_ENV = /process\.env\.(SUPABASE_SERVICE_ROLE_KEY|SETTINGS_ENCRYPTION_KEY|CRON_SECRET|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|FAPSHI_[A-Z_]*KEY|VAPID_PRIVATE_KEY|RESEND_API_KEY|RESEND_WEBHOOK_SECRET|LOYALTY_QR_SECRET|ANTHROPIC_API_KEY|OPENAI_API_KEY|WHATSAPP_[A-Z_]*(SECRET|TOKEN))/;
  const bad = files.filter((f) => /^src\/.*\.tsx?$/.test(f) && /^\s*["']use client["']/m.test(read(f).split("\n").slice(0, 5).join("\n")) && SECRET_ENV.test(read(f)));
  assert.deepEqual(bad, []);
});
test("every cron route fails closed when CRON_SECRET is unset or empty, and every scheduled path exists", () => {
  const routes = files.filter((f) => /^src\/app\/api\/cron\/[^/]+\/route\.ts$/.test(f));
  assert.ok(routes.length >= 10);
  for (const f of routes) {
    const s = read(f);
    assert.ok(/!process\.env\.CRON_SECRET|!secret\b/.test(s) && /authorization/i.test(s), `${f} may not fail closed`);
  }
  for (const c of JSON.parse(read("vercel.json")).crons) assert.ok(files.includes(`src/app/api${c.path.replace(/^\/api/, "")}/route.ts`), `${c.path} has no route`);
});
test("debug / preview pages are not reachable in production with real data (only fixtures, gated or static)", () => {
  for (const f of files.filter((x) => /^src\/app\/dev-preview-[^/]+\/page\.tsx$/.test(x))) {
    const s = read(f);
    assert.ok(/NODE_ENV === "production"\) return notFound\(\)/.test(s) || (/^"use client"/.test(s) && !/(createAdminClient|createClient|supabase)/.test(s)), `${f} is neither gated nor static`);
  }
});

console.log(`securityPhase5: ${passed} checks passed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
