// Unit checks for Ringo AI Image Generation (src/lib/ai/providers/openai.ts's generateOpenAiImage,
// src/lib/ai/imageUsage.ts, src/lib/ai/tools/definitions/image.ts, src/lib/ai/uploads.ts's
// generated-image path helpers). No network beyond a stubbed fetch, no real database, no real API
// key — same jiti-loading / stubbed-fetch conventions as ringo_ai_openai_unit.test.mjs. The
// access/quota/reservation layer (resolveAiImageAccess, checkAiImageQuota, reserveAiImageQuota) is
// covered in ringo_ai_unit.test.mjs, which already has the fake-Supabase-client harness for it.
//
//   Run:  node scripts/tests/ringo_ai_image_unit.test.mjs
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const load = (p) => jiti(path.join(REPO, "src", p));

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

// ------------------------------------------------------------------ imageUsage.ts: pure cost calculation
{
  const { estimateImageCostUsd, EMPTY_IMAGE_USAGE } = load("lib/ai/imageUsage.ts");
  const settingsWithPricing = { imagePricing: { inputTextPerMTok: 5.0, inputImagePerMTok: 8.0, outputPerMTok: 30.0 } };
  const settingsNoPricing = { imagePricing: { inputTextPerMTok: null, inputImagePerMTok: null, outputPerMTok: null } };

  check("estimateImageCostUsd: null when pricing isn't configured (never guessed)", estimateImageCostUsd({ inputTextTokens: 100, inputImageTokens: 0, outputTokens: 1000 }, settingsNoPricing) === null);

  const cost = estimateImageCostUsd({ inputTextTokens: 100, inputImageTokens: 50, outputTokens: 1000 }, settingsWithPricing);
  // (100*5 + 50*8 + 1000*30) / 1e6 = (500 + 400 + 30000) / 1e6 = 0.0309
  check("estimateImageCostUsd: real token-based calculation using the configured per-1M-token prices", Math.abs(cost - 0.0309) < 1e-9, String(cost));
  check("EMPTY_IMAGE_USAGE costs exactly 0 when pricing is configured", estimateImageCostUsd(EMPTY_IMAGE_USAGE, settingsWithPricing) === 0);
}

// ------------------------------------------------------------------ generateOpenAiImage: real request/response handling against a stubbed fetch
{
  const realKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "unit-test-placeholder-not-a-real-key";
  const { generateOpenAiImage } = load("lib/ai/providers/openai.ts");
  const { AiProviderError } = load("lib/ai/providers/types.ts");
  const realFetch = globalThis.fetch;
  let fetchCallCount = 0;
  let lastRequestBody = null;
  // The `openai` client resolves fetch ONCE at construction (see the identical note in
  // ringo_ai_openai_unit.test.mjs) — a single dispatcher must be installed before the first
  // call, with each scenario swapping what it currently serves via `currentHandler`.
  let currentHandler = async () => new Response(null, { status: 500 });
  globalThis.fetch = (...args) => currentHandler(...args);

  // --- success, with usage ---
  currentHandler = async (_url, init) => {
    fetchCallCount++;
    lastRequestBody = init?.body ? JSON.parse(init.body) : null;
    const payload = {
      created: 1234567890,
      output_format: "png",
      quality: "low",
      size: "1024x1024",
      data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }],
      usage: { input_tokens: 50, input_tokens_details: { text_tokens: 40, image_tokens: 0 }, output_tokens: 1000, total_tokens: 1050 },
    };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  fetchCallCount = 0;
  const result = await generateOpenAiImage({ model: "gpt-image-2.5-flare", prompt: "a test prompt", size: "1024x1024", quality: "low" });
  check("generateOpenAiImage: returns decoded bytes from b64_json", result.bytes.toString() === "fake-png-bytes", result.bytes.toString());
  check("generateOpenAiImage: content type from output_format", result.contentType === "image/png");
  check("generateOpenAiImage: real token usage surfaced (never fabricated)", result.usage?.inputTextTokens === 40 && result.usage?.outputTokens === 1000, JSON.stringify(result.usage));
  check("generateOpenAiImage: sends exactly one image request (n is never a caller-configurable parameter)", lastRequestBody?.n === 1, JSON.stringify(lastRequestBody));
  check("generateOpenAiImage: requests a fixed output_format (png), not caller-configurable", lastRequestBody?.output_format === "png");
  check("generateOpenAiImage: only one fetch call for a successful request", fetchCallCount === 1, String(fetchCallCount));

  // --- provider error normalization (never a raw SDK error) ---
  currentHandler = async () => new Response(JSON.stringify({ error: { message: "slow down", type: "rate_limit_error" } }), { status: 429, headers: { "content-type": "application/json" } });
  const err = await generateOpenAiImage({ model: "gpt-image-2.5-flare", prompt: "x", size: "auto", quality: "auto" }).then(() => null, (e) => e);
  check("generateOpenAiImage: HTTP 429 → AiProviderError('rate_limited')", err instanceof AiProviderError && err.code === "rate_limited", err && `${err.constructor.name}:${err.code}`);

  // --- cost safety: a retryable 500 must NOT be silently retried multiple times (maxRetries: 0 override) ---
  fetchCallCount = 0;
  currentHandler = async () => {
    fetchCallCount++;
    return new Response(JSON.stringify({ error: { message: "boom", type: "server_error" } }), { status: 500, headers: { "content-type": "application/json" } });
  };
  const serverErr = await generateOpenAiImage({ model: "gpt-image-2.5-flare", prompt: "x", size: "auto", quality: "auto" }).then(() => null, (e) => e);
  check(
    "generateOpenAiImage: a 500 (normally retryable by the SDK's default maxRetries) is NOT retried — exactly one fetch call, protecting against multiplied cost",
    fetchCallCount === 1,
    `fetchCallCount=${fetchCallCount}`
  );
  check("generateOpenAiImage: the 500 still surfaces as a normalized AiProviderError('overloaded')", serverErr instanceof AiProviderError && serverErr.code === "overloaded", serverErr && `${serverErr.constructor.name}:${serverErr.code}`);

  // --- missing image data is treated as failure, never a fabricated success ---
  currentHandler = async () => new Response(JSON.stringify({ created: 1, data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  const noImageErr = await generateOpenAiImage({ model: "gpt-image-2.5-flare", prompt: "x", size: "auto", quality: "auto" }).then(() => null, (e) => e);
  check("generateOpenAiImage: no image data in a 200 response → throws rather than returning empty bytes as success", noImageErr instanceof AiProviderError, noImageErr && String(noImageErr));

  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = realKey;
}

// ------------------------------------------------------------------ generate_image tool: input validation (security boundary)
{
  const { generateImage } = load("lib/ai/tools/definitions/image.ts");
  check("generate_image: kind is 'image', not 'content' or 'draft'", generateImage.kind === "image");
  check("generate_image: schema only exposes 'prompt' — no model/size/quality/user/profile field a caller could set", Object.keys(generateImage.inputSchema.properties).join() === "prompt");
  check("generate_image: schema is strict (additionalProperties:false, prompt required)", generateImage.inputSchema.additionalProperties === false && generateImage.inputSchema.required.includes("prompt"));

  check("parseInput: rejects a non-string prompt", generateImage.parseInput({ prompt: 123 }) === null);
  check("parseInput: rejects an empty/whitespace-only prompt", generateImage.parseInput({ prompt: "   " }) === null);
  check("parseInput: rejects a prompt over 2000 characters", generateImage.parseInput({ prompt: "x".repeat(2001) }) === null);
  check("parseInput: rejects a missing prompt", generateImage.parseInput({}) === null);
  check("parseInput: rejects a non-object payload", generateImage.parseInput("a prompt") === null);
  const parsed = generateImage.parseInput({ prompt: "  a real prompt  " });
  check("parseInput: accepts and trims a valid prompt", parsed?.prompt === "a real prompt", JSON.stringify(parsed));
  // A caller can't smuggle a model/size/quality override through — parseInput only ever reads `prompt`.
  const withExtras = generateImage.parseInput({ prompt: "a prompt", model: "gpt-image-1-mini", size: "1024x1792", quality: "max" });
  check("parseInput: ignores any extra fields (model/size/quality can never be attacker-supplied)", Object.keys(withExtras || {}).join() === "prompt", JSON.stringify(withExtras));
}

// ------------------------------------------------------------------ uploads.ts: generated-image path helpers
{
  const { aiGeneratedImagePath, isOwnAiGeneratedImageUrl } = load("lib/ai/uploads.ts");
  const userId = "11111111-1111-1111-1111-111111111111";
  const otherUserId = "22222222-2222-2222-2222-222222222222";

  const p1 = aiGeneratedImagePath(userId, "png");
  const p2 = aiGeneratedImagePath(userId, "png");
  check("aiGeneratedImagePath: two calls never collide (unique uuid per generation)", p1 !== p2, `${p1} vs ${p2}`);
  check("aiGeneratedImagePath: scoped under the caller's own userId/ai-generated/ prefix", p1.startsWith(`${userId}/ai-generated/`), p1);
  check("aiGeneratedImagePath: server-controlled — never derived from any client input", /^[0-9a-f-]+\/ai-generated\/[0-9a-f-]+\.png$/.test(p1), p1);

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  const ownUrl = `https://example.supabase.co/storage/v1/object/public/uploads/${p1}`;
  check("isOwnAiGeneratedImageUrl: accepts the caller's own generated-image URL", isOwnAiGeneratedImageUrl(ownUrl, userId) === true);
  check("isOwnAiGeneratedImageUrl: rejects another user's generated-image URL", isOwnAiGeneratedImageUrl(ownUrl.replace(userId, otherUserId), userId) === false);
  check("isOwnAiGeneratedImageUrl: rejects a path-traversal attempt", isOwnAiGeneratedImageUrl(`https://example.supabase.co/storage/v1/object/public/uploads/${userId}/ai-generated/../../secret.png`, userId) === false);
  check("isOwnAiGeneratedImageUrl: rejects the ai-uploads/ prefix (a different, non-generated purpose)", isOwnAiGeneratedImageUrl(`https://example.supabase.co/storage/v1/object/public/uploads/${userId}/ai-uploads/x.png`, userId) === false);
}

const failed = results.filter((x) => !x.pass);
console.log(`\nringo_ai_image_unit: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
