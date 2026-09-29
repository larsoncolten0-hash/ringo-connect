// MANUAL, COSTS REAL MONEY: one real OpenAI image generation + real Supabase Storage write.
//
// SCOPE NOTE: the Ringo AI Image Generation migration
// (supabase/migrations/2026-11-16_ringo_ai_image_generation_foundation.sql) has NOT been run
// yet, so plans.ai_image_enabled, ai_settings' image_* columns, ai_image_usage_events and the
// quota RPCs do not exist in the live database. This script therefore cannot exercise the full
// resolveAiImageAccess() -> reserveAiImageQuota() -> generateAndStoreImage() -> recordImageUsageEvent()
// path (steps 1/2/8 of the Phase 14 plan) — only the provider call and storage write, which are
// independent of that schema. Once the migration is applied, this can be extended (or the real
// route/tool exercised directly) to cover the DB-backed steps too.
//
//   Needs OPENAI_API_KEY (for generation) and SUPABASE_SERVICE_ROLE_KEY +
//   NEXT_PUBLIC_SUPABASE_URL (for the storage write) in the environment or .env.local — read
//   locally, never printed.
//   Run:  node scripts/tests/ringo_ai_image_live_model.manual.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const envFile = path.join(REPO, ".env.local");
const envLine = (name) => (fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`)) : null);
for (const name of ["OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"]) {
  if (!process.env[name]) {
    const line = envLine(name);
    if (line) process.env[name] = line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
  }
}
const missing = ["OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"].filter((n) => !process.env[n]);
if (missing.length) {
  console.log(`Missing (environment or .env.local): ${missing.join(", ")} — nothing run.`);
  process.exit(2);
}

const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const load = (p) => jiti(path.join(REPO, "src", p));

const { generateOpenAiImage } = load("lib/ai/providers/openai.ts");
const { aiGeneratedImagePath } = load("lib/ai/uploads.ts");
const serverMod = load("lib/supabase/server.ts");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${!cond && detail ? ` | ${detail}` : ""}`);
};

// A fixed, low-cost, low-quality, default-size, deliberately simple prompt — minimal-cost per
// the Phase 14 instructions. A test-scoped fake user id keeps the storage path clearly
// identifiable and separate from any real user's ai-generated/ folder.
const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";
const MODEL = process.env.RINGO_AI_IMAGE_TEST_MODEL || "gpt-image-2.5-flare";
const PROMPT = "A simple flat-color icon of a coffee cup, minimal line art, white background.";

console.log(`Model: ${MODEL} (override with RINGO_AI_IMAGE_TEST_MODEL=<id>) | quality: low | size: 1024x1024\n`);

let result;
try {
  result = await generateOpenAiImage({ model: MODEL, prompt: PROMPT, size: "1024x1024", quality: "low" });
  check("generateOpenAiImage: real API call succeeded", true);
  check("generateOpenAiImage: returned real image bytes", result.bytes.length > 0, `${result.bytes.length} bytes`);
  console.log(`  [info] contentType=${result.contentType} model=${result.model} size=${result.size} quality=${result.quality} providerRequestId=${result.providerRequestId ?? "(none)"}`);
  console.log(`  [info] usage=${result.usage ? JSON.stringify(result.usage) : "(not returned by the provider for this model)"}`);
} catch (err) {
  check("generateOpenAiImage: real API call succeeded", false, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
}

let storagePath = null;
let publicUrl = null;
if (result) {
  const ext = result.contentType === "image/webp" ? "webp" : result.contentType === "image/jpeg" ? "jpg" : "png";
  storagePath = aiGeneratedImagePath(TEST_USER_ID, ext);
  const storage = serverMod.createAdminClient();
  const { error: uploadError } = await storage.storage.from("uploads").upload(storagePath, result.bytes, { upsert: false, cacheControl: "3600", contentType: result.contentType });
  check("storage: uploaded to the real 'uploads' bucket under ai-generated/", !uploadError, uploadError?.message);
  if (!uploadError) {
    const { data } = storage.storage.from("uploads").getPublicUrl(storagePath);
    publicUrl = data.publicUrl;
    console.log(`  [info] storagePath=${storagePath}`);
    console.log(`  [info] publicUrl=${publicUrl}`);

    try {
      const res = await fetch(publicUrl);
      const bytes = new Uint8Array(await res.arrayBuffer());
      check("storage: the public URL is fetchable and returns real image bytes (what an <img> tag would render)", res.ok && bytes.length > 0, `status=${res.status} bytes=${bytes.length}`);
    } catch (err) {
      check("storage: the public URL is fetchable and returns real image bytes (what an <img> tag would render)", false, err instanceof Error ? err.message : String(err));
    }
  }
}

console.log(
  "\n[scope] NOT exercised (requires the migration to be run first): resolveAiImageAccess() plan/beta/kill-switch gating, " +
    "reserveAiImageQuota()/checkAiImageQuota() atomic reservation and daily/monthly/budget enforcement, and recordImageUsageEvent() " +
    "writing to ai_image_usage_events. These are covered by the automated unit tests (ringo_ai_unit.test.mjs, ringo_ai_image_unit.test.mjs) " +
    "against a fake database instead."
);
if (storagePath) console.log(`\n[cleanup] This test left one real file in Storage at uploads/${storagePath} (a leftover from this manual run — delete it from the Supabase dashboard if you don't want to keep it).`);

const failed = results.filter((x) => !x.pass);
console.log(`\nringo_ai_image_live_model: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
