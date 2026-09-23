// Unit checks for Ringo AI's server logic (src/lib/ai/**). No network, no database, no API key:
// it loads the real TypeScript modules through jiti (already present in node_modules as a
// transitive dependency — nothing is added to package.json) and exercises the pure parts:
//   * diagnostics produce exactly the expected findings for fixture workspaces (and none for a
//     complete one), and never report the two deliberately excluded "problems"
//   * admin settings validation rejects out-of-range / malformed values
//   * the tool registry only exposes read tools, hides tools for missing features, refuses
//     unknown tools and invalid input, caps output size, and never leaks error details
//   * knowledge / diagnostics / tools / translations stay consistent with each other
//   * the cached prompt prefix contains no per-user data
//   * unverifiable (null) counts never become findings; quota reservation estimate
//   * the real orchestrator records usage exactly once, including partial usage on abort/failure,
//     and the real Anthropic adapter extracts partial usage from an interrupted stream (stubbed fetch)
//
//   Run:  node scripts/tests/ringo_ai_unit.test.mjs
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

const { runDiagnostics } = load("lib/ai/diagnostics/index.ts");
const { DIAGNOSTIC_CHECKS } = load("lib/ai/diagnostics/checks.ts");
const { parseAiSettingsPatch, mapAiSettingsRow } = load("lib/ai/settings.ts");
const { KNOWLEDGE_MODULES, KNOWLEDGE_TOPIC_IDS, getCategoryModules } = load("lib/ai/knowledge/index.ts");
const { renderNavigationMap } = load("lib/ai/knowledge/navigation.ts");
const { buildStableSystemPrompt } = load("lib/ai/prompts/system.ts");
const { getAvailableTools, executeTool } = load("lib/ai/tools/registry.ts");
const { AI_TOOLS } = load("lib/ai/tools/index.ts");
const { translations } = load("lib/i18n/translations.ts");
const { AI_DENY_REASONS, AI_LIMIT_REASONS, AI_RUNTIME_ERRORS } = load("lib/ai/codes.ts");

// ------------------------------------------------------------------ fixtures
const base = () => ({
  loadedAt: new Date().toISOString(),
  profile: {
    username: "demo", displayName: "Demo", location: "Douala", category: "business_ecommerce", categories: [],
    musicRole: null, restaurantSubcategory: null, published: true, verified: false, currency: "XAF",
    hasAvatar: true, hasBio: true, hasCoverImage: true, hasLongDescription: true, hasWhatsapp: true,
    hasAboutEmail: true, hasAboutPhone: true, bookingsEnabled: false, createdAt: null,
  },
  isMusic: false, isRestaurant: false, hasTicketing: false, restaurant: null,
  plan: { name: "pro", displayName: "Pro", maxLinks: null, maxProducts: null, pixelsEnabled: true, customThemeEnabled: true,
    fullAnalyticsEnabled: true, badgeRemoved: true, teamEnabled: false, maxTeamSeats: null, expiresAt: null },
  onboardingCompleted: true, loyaltyAvailability: "optional",
  counts: { links: 3, socialLinks: 2, products: 4, tracks: 0, sellableStandaloneTracks: 0, unpricedStandaloneTracks: 0, releases: 0,
    events: 0, upcomingPublishedEvents: 0, upcomingEventsWithoutTicketing: 0, menuCategories: 0, menuItems: 0, availableMenuItems: 0,
    restaurantTables: 0, bookingServices: 0, activeConnections: 5, activeCommunitySubscribers: 5, activeLoyaltyPrograms: 0 },
});
const ids = (s) => runDiagnostics(s).map((f) => f.id).sort();

// ------------------------------------------------------------------ diagnostics
check("complete business profile → no findings", ids(base()).length === 0, ids(base()).join());

let s = base();
s.profile.published = false;
check("unpublished → profile_unpublished (problem, no dashboard fix path)", (() => {
  const f = runDiagnostics(s).find((x) => x.id === "profile_unpublished");
  return f && f.severity === "problem" && f.fixPath === null;
})());

s = base();
s.profile.category = "restaurant_food"; s.isRestaurant = true;
s.restaurant = { orderingEnabled: false, dineInEnabled: true, takeawayEnabled: true, deliveryEnabled: false };
s.counts.menuItems = 5; s.counts.availableMenuItems = 5;
check("restaurant with ordering off → restaurant_ordering_disabled", ids(s).includes("restaurant_ordering_disabled"));
check("…and links to Restaurant settings", runDiagnostics(s).find((x) => x.id === "restaurant_ordering_disabled").fixPath === "/dashboard?section=restaurant-settings");
s.restaurant.orderingEnabled = true; s.restaurant.dineInEnabled = false; s.restaurant.takeawayEnabled = false;
check("all order types off → restaurant_no_order_types", ids(s).includes("restaurant_no_order_types"));
s.restaurant.takeawayEnabled = true; s.counts.availableMenuItems = 0;
check("menu with no available items → restaurant_no_available_items", ids(s).includes("restaurant_no_available_items"));
s.counts.menuItems = 0;
check("empty menu → restaurant_has_no_menu (and not 'no available items')", ids(s).includes("restaurant_has_no_menu") && !ids(s).includes("restaurant_no_available_items"));

s = base();
s.profile.category = "music_entertainment"; s.isMusic = true; s.hasTicketing = true; s.profile.currency = "USD";
s.counts.tracks = 3; s.counts.sellableStandaloneTracks = 1; s.counts.unpricedStandaloneTracks = 2;
const musicIds = ids(s);
check("music in USD with sellable tracks → music_store_not_configured", musicIds.includes("music_store_not_configured"));
check("unpriced tracks → tracks_without_price", musicIds.includes("tracks_without_price"));
s.profile.currency = "XAF";
check("music in XAF → no currency problem", !ids(s).includes("music_store_not_configured"));

s = base();
s.plan.maxLinks = 1; s.counts.links = 1; s.plan.maxProducts = 1; s.counts.products = 1;
check("plan limits reached → both limit findings", ids(s).includes("link_limit_reached") && ids(s).includes("product_limit_reached"));

s = base();
s.plan.expiresAt = new Date(Date.now() - 86400000).toISOString();
check("expired paid plan → plan_expiring (problem)", runDiagnostics(s).find((x) => x.id === "plan_expiring")?.severity === "problem");
s.plan.name = "free";
check("free plan never reports expiry", !ids(s).includes("plan_expiring"));

s = base();
s.counts.activeConnections = null;
check("unverifiable connections count (null) is not reported as zero", !ids(s).includes("no_connections_yet"));

check("no diagnostic claims Community is disabled", !DIAGNOSTIC_CHECKS.some((c) => /community_not_enabled|community_disabled/.test(c.id)));
check("no diagnostic claims plan blocks commerce/bookings", !DIAGNOSTIC_CHECKS.some((c) => /commerce|bookings_feature/.test(c.id)));
check("diagnostics are sorted problems → warnings → tips", (() => {
  const t = base(); t.profile.published = false; t.profile.hasWhatsapp = false; t.counts.links = 0;
  const order = runDiagnostics(t).map((f) => f.severity);
  return order.join() === [...order].sort((a, b) => ["problem", "warning", "tip"].indexOf(a) - ["problem", "warning", "tip"].indexOf(b)).join();
})());
check("diagnostic ids are unique", new Set(DIAGNOSTIC_CHECKS.map((c) => c.id)).size === DIAGNOSTIC_CHECKS.length);
check("every diagnostic points at an existing knowledge module", DIAGNOSTIC_CHECKS.every((c) => KNOWLEDGE_TOPIC_IDS.includes(c.knowledge)), DIAGNOSTIC_CHECKS.filter((c) => !KNOWLEDGE_TOPIC_IDS.includes(c.knowledge)).map((c) => c.id).join());

// ------------------------------------------------------------------ settings validation
check("valid patch accepted", JSON.stringify(parseAiSettingsPatch({ enabled: true, dailyMessageLimit: 20, effort: "low" })) === JSON.stringify({ enabled: true, effort: "low", daily_message_limit: 20 }));
check("non-boolean enabled rejected", parseAiSettingsPatch({ enabled: "yes" }) === null);
check("out-of-range tool rounds rejected", parseAiSettingsPatch({ maxToolRounds: 50 }) === null);
check("unknown effort rejected", parseAiSettingsPatch({ effort: "max" }) === null);
check("model id with spaces/injection rejected", parseAiSettingsPatch({ modelChat: "claude; drop table" }) === null);
check("negative price rejected", parseAiSettingsPatch({ priceInputPerMTok: -1 }) === null);
check("empty price clears it (null)", parseAiSettingsPatch({ priceInputPerMTok: "" }).price_input_per_mtok_usd === null);
check("unknown keys ignored, not written", Object.keys(parseAiSettingsPatch({ updated_by: "x", id: 9 })).length === 0);
check("missing settings row fails CLOSED", mapAiSettingsRow(null).enabled === false && mapAiSettingsRow(null).maxToolRounds === 0);

// ------------------------------------------------------------------ tool registry
const ctxFor = (snapshot, actor = { kind: "owner" }) => ({
  workspace: { userId: "u", profileId: "p", username: "demo", actor },
  snapshot,
  locale: "en",
});
const names = (ctx) => getAvailableTools(ctx).map((t) => t.name).sort();
check("every registered tool is read-only in Phase 1", AI_TOOLS.every((t) => t.kind === "read"));
check("tool names unique", new Set(AI_TOOLS.map((t) => t.name)).size === AI_TOOLS.length);
check("business owner: no music/restaurant/events tools", !names(ctxFor(base())).some((n) => /music|restaurant|events/.test(n)));
s = base(); s.isMusic = true; s.hasTicketing = true;
check("music owner: music + events tools available", names(ctxFor(s)).includes("get_my_music_summary") && names(ctxFor(s)).includes("get_my_events_summary"));
check(
  "future staff actor without permissions only gets permission-free tools",
  names(ctxFor(base(), { kind: "staff", roleName: "Cashier", permissions: [] })).join() === "lookup_ringo_help"
);
check("every tool schema is strict (additionalProperties:false, all props required)", AI_TOOLS.every((t) => {
  const props = Object.keys(t.inputSchema.properties || {});
  return t.inputSchema.additionalProperties === false && props.every((p) => (t.inputSchema.required || []).includes(p));
}));
check("no tool accepts an id-like input (profile/user ids are server-resolved)", AI_TOOLS.every((t) => !Object.keys(t.inputSchema.properties || {}).some((p) => /id$|_id|user|profile|sql|query/i.test(p))));

const ctx = ctxFor(base());
const available = getAvailableTools(ctx);
let r = await executeTool("drop_everything", {}, ctx, available);
check("unknown tool refused", r.isError && r.content.includes("tool_not_available"));
r = await executeTool("get_my_music_summary", {}, ctx, available);
check("tool for a missing feature refused even if the model names it", r.isError && r.content.includes("tool_not_available"));
r = await executeTool("get_my_profile_overview", { profileId: "someone-else" }, ctx, available);
check("unexpected input (e.g. a profileId) rejected", r.isError && r.content.includes("invalid_input"));
r = await executeTool("get_my_analytics_summary", { period: "10y" }, ctx, available);
check("out-of-enum input rejected", r.isError && r.content.includes("invalid_input"));
r = await executeTool("lookup_ringo_help", { topic: "../../etc/passwd" }, ctx, available);
check("unknown knowledge topic rejected", r.isError && r.content.includes("invalid_input"));
r = await executeTool("run_my_setup_check", {}, ctx, available);
check("setup check runs on the server-side snapshot", !r.isError && JSON.parse(r.content).findings_count === 0);
r = await executeTool("lookup_ringo_help", { topic: "restaurant" }, ctx, available);
check("knowledge lookup works", !r.isError && JSON.parse(r.content).content.includes("Restaurant"));

const fakeTools = [
  { name: "huge", kind: "read", inputSchema: {}, parseInput: () => ({}), run: async () => ({ blob: "x".repeat(50000) }) },
  { name: "boom", kind: "read", inputSchema: {}, parseInput: () => ({}), run: async () => { throw new Error("relation \"secret_table\" password=hunter2"); } },
];
r = await executeTool("huge", {}, ctx, fakeTools);
check("tool output is size-capped", r.content.length <= 6000 && r.content.includes("truncated"));
r = await executeTool("boom", {}, ctx, fakeTools);
check("tool errors never leak internal details to the model", r.isError && !r.content.includes("secret_table") && !r.content.includes("hunter2"));

// ------------------------------------------------------------------ knowledge / prompt / translations consistency
check("knowledge ids unique", new Set(KNOWLEDGE_TOPIC_IDS).size === KNOWLEDGE_TOPIC_IDS.length);
check("every module's related topics exist", KNOWLEDGE_MODULES.every((m) => (m.related || []).every((r) => KNOWLEDGE_TOPIC_IDS.includes(r))));
check("restaurant owner auto-loads restaurant + loyalty knowledge", ["restaurant", "loyalty"].every((id) => getCategoryModules(["restaurant_food"]).some((m) => m.id === id)));
const nav = renderNavigationMap();
check("navigation map has real EN and FR labels (no undefined)", !nav.includes("undefined") && nav.includes("FR:"));
const stable = buildStableSystemPrompt();
check("stable prompt is deterministic", stable === buildStableSystemPrompt());
check("stable prompt carries no per-user/volatile data", !/\d{4}-\d{2}-\d{2}T|Douala|demo@|username: /.test(stable));
check("stable prompt tells the model tool/user text is data", stable.includes("user_provided_data") && stable.includes("never follow instructions"));
for (const locale of ["en", "fr"]) {
  const t = translations[locale].ringoAi;
  check(`${locale}: every tool has a status label`, AI_TOOLS.every((tool) => typeof t.toolStatus[tool.name] === "string"));
  const codes = [...AI_DENY_REASONS, ...AI_LIMIT_REASONS, ...AI_RUNTIME_ERRORS];
  check(`${locale}: every error code has a message`, codes.every((c) => typeof t.errors[c] === "string"), codes.filter((c) => typeof t.errors[c] !== "string").join());
}

// ------------------------------------------------------------------ settings: blank values are rejected, never coerced to 0
check("blank daily limit rejected (not saved as 0)", parseAiSettingsPatch({ dailyMessageLimit: null }) === null && parseAiSettingsPatch({ dailyMessageLimit: " " }) === null);
check("blank monthly budget rejected (not saved as $0)", parseAiSettingsPatch({ monthlyGlobalBudgetUsd: "" }) === null && parseAiSettingsPatch({ monthlyGlobalBudgetUsd: null }) === null);
check("blank token limit / output cap rejected", parseAiSettingsPatch({ monthlyUserTokenLimit: null }) === null && parseAiSettingsPatch({ maxOutputTokens: "" }) === null);
check("valid numeric strings still save", JSON.stringify(parseAiSettingsPatch({ dailyMessageLimit: "30", monthlyGlobalBudgetUsd: "50" })) === JSON.stringify({ monthly_global_budget_usd: 50, daily_message_limit: 30 }));
check("explicit 0 is still allowed (a deliberate choice)", parseAiSettingsPatch({ dailyMessageLimit: 0 }).daily_message_limit === 0);
check("blank price still clears it (null), unchanged", parseAiSettingsPatch({ priceOutputPerMTok: null }).price_output_per_mtok_usd === null);

// ------------------------------------------------------------------ quota reservation estimate
const { estimateReservation, RESERVE_INPUT_TOKENS_PER_TURN } = load("lib/ai/usage.ts");
const settingsRow = (over = {}) =>
  mapAiSettingsRow({
    enabled: true, access_mode: "allowlist", provider: "anthropic", model_chat: "claude-sonnet-5", effort: "medium",
    daily_message_limit: 30, monthly_user_token_limit: 3000000, monthly_global_budget_usd: 50, max_tool_rounds: 4,
    max_output_tokens: 4096, history_message_limit: 12, price_input_per_mtok_usd: 2, price_output_per_mtok_usd: 10,
    price_cache_read_per_mtok_usd: 0.2, price_cache_write_per_mtok_usd: 2.5, ...over,
  });
let est = estimateReservation(settingsRow());
check("reservation covers every allowed turn (rounds + final) at input estimate + full output cap", est.tokens === 5 * (RESERVE_INPUT_TOKENS_PER_TURN + 4096), String(est.tokens));
check("reservation cost uses the dearer input/cache-write price", Math.abs(est.costUsd - (5 * 20000 * 2.5 + 5 * 4096 * 10) / 1e6) < 1e-6, String(est.costUsd));
check("no pricing → reservation cost null (budget not enforced, as before)", estimateReservation(settingsRow({ price_input_per_mtok_usd: null })).costUsd === null);
check("0 tool rounds → one turn reserved", estimateReservation(settingsRow({ max_tool_rounds: 0 })).tokens === RESERVE_INPUT_TOKENS_PER_TURN + 4096);

// ------------------------------------------------------------------ unverifiable (null) counts never become findings
s = base();
s.isMusic = true; s.isRestaurant = true; s.hasTicketing = true; s.profile.currency = "USD"; s.profile.bookingsEnabled = false;
s.plan.maxLinks = 3; s.plan.maxProducts = 4; s.loyaltyAvailability = "recommended";
for (const k of Object.keys(s.counts)) s.counts[k] = null;
check("all counts unknown → no count-based finding is invented", ids(s).length === 0, ids(s).join());
s = base();
s.counts.activeCommunitySubscribers = null; s.counts.activeConnections = null; s.counts.links = null; s.counts.socialLinks = null;
check("unknown customer/link counts are not reported as zero", !ids(s).some((id) => ["no_connections_yet", "profile_missing_information"].includes(id)), ids(s).join());
check("prompt forbids reporting a null count as zero", /null count or value[^\n]*never report it as zero/.test(stable));

// ------------------------------------------------------------------ orchestrator: usage recorded exactly once, partial usage counted
const providerTypes = load("lib/ai/providers/types.ts");
const { AiProviderError } = providerTypes;
const usageMod = load("lib/ai/usage.ts");
const convMod = load("lib/ai/conversations.ts");
const snapMod = load("lib/ai/context/snapshot.ts");
let recorded = [];
let msgSeq = 0;
let failAssistantAppend = false;
let recordThrows = false;
usageMod.recordUsageEvent = async (e) => {
  recorded.push(e);
  if (recordThrows) throw new Error("db down");
};
convMod.createConversation = async () => "conv-1";
convMod.getOwnConversation = async () => null;
convMod.listConversationMessages = async () => [];
convMod.appendMessage = async (_c, role) => {
  if (role === "assistant" && failAssistantAppend) throw new Error("insert failed");
  return `msg-${++msgSeq}`;
};
snapMod.loadWorkspaceSnapshot = async () => base();
const { runChat } = load("lib/ai/orchestrator.ts");

const U = (i, o, cr = 0, cw = 0) => ({ inputTokens: i, outputTokens: o, cacheReadTokens: cr, cacheWriteTokens: cw });
const textTurn = (text, usage) => ({ message: { role: "assistant", parts: [{ type: "text", text }] }, stopReason: "end", usage });
const toolTurn = (usage) => ({
  message: { role: "assistant", parts: [{ type: "tool_call", id: "t1", name: "lookup_ringo_help", input: { topic: KNOWLEDGE_TOPIC_IDS[0] } }] },
  stopReason: "tool_calls",
  usage,
});
const scripted = (steps) => {
  let i = 0;
  return {
    id: "fake",
    isConfigured: () => true,
    // Streams text parts through onTextDelta exactly like the real adapter does.
    runTurn: async (req, handlers) => {
      const step = steps[i++];
      const turn = typeof step === "function" ? await step(req) : step;
      for (const part of turn.message.parts) if (part.type === "text") handlers?.onTextDelta?.(part.text);
      return turn;
    },
  };
};
const chat = async (provider, extra = {}) => {
  recorded = [];
  const events = [];
  await runChat({
    access: { workspace: { userId: "u1", profileId: "p1", username: "demo", actor: { kind: "owner" } }, settings: settingsRow(), provider, dailyMessageLimit: 30, isPlatformAdmin: false },
    locale: "en",
    conversationId: null,
    message: "hi",
    emit: (e) => events.push(e),
    ...extra,
  });
  return events;
};
const tokensOf = (e) => [e.usage.inputTokens, e.usage.outputTokens, e.usage.cacheReadTokens, e.usage.cacheWriteTokens].join("/");

let ev = await chat(scripted([toolTurn(U(100, 10, 5, 1)), textTurn("Hello", U(200, 20, 7, 0))]));
check("success: exactly one usage row", recorded.length === 1, String(recorded.length));
check("success: usage is the sum of every turn's provider-reported usage", recorded[0] && tokensOf(recorded[0]) === "300/30/12/1" && recorded[0].toolRounds === 1, recorded[0] && tokensOf(recorded[0]));
check("success: status ok and done emitted", recorded[0]?.status === "ok" && ev.some((e) => e.type === "done"), JSON.stringify({ s: recorded[0]?.status, c: recorded[0]?.errorCode, ev }));

const client = new AbortController();
ev = await (async () => {
  const p = chat(
    scripted([
      (req) =>
        new Promise((_, reject) =>
          req.signal.addEventListener("abort", () => reject(new AiProviderError("unknown", "aborted", U(500, 7))), { once: true })
        ),
    ]),
    { signal: client.signal }
  );
  setTimeout(() => client.abort(), 20);
  return p;
})();
check("client abort: the provider call is actually aborted and one error row recorded", recorded.length === 1 && recorded[0].status === "error");
check("client abort: tokens reported before the abort are counted", recorded[0] && tokensOf(recorded[0]) === "500/7/0/0", recorded[0] && tokensOf(recorded[0]));

ev = await chat(scripted([toolTurn(U(100, 10)), () => Promise.reject(new AiProviderError("overloaded", "x", U(50, 3)))]));
check("provider failure mid-loop: earlier turns + partial usage both counted, once", recorded.length === 1 && tokensOf(recorded[0]) === "150/13/0/0" && recorded[0].errorCode === "provider_overloaded", recorded[0] && tokensOf(recorded[0]));
check("provider failure: user sees a stable code only", ev.some((e) => e.type === "error" && e.code === "provider_busy"));

await chat(scripted([() => Promise.reject(new AiProviderError("rate_limited", "x"))]));
check("provider failure with no usage reported: one row, zero tokens", recorded.length === 1 && tokensOf(recorded[0]) === "0/0/0/0");

recordThrows = true;
await chat(scripted([textTurn("Hello", U(10, 1))]));
recordThrows = false;
check("usage write throwing after success does not record twice", recorded.length === 1, String(recorded.length));

failAssistantAppend = true;
await chat(scripted([textTurn("Hello", U(10, 1))]));
failAssistantAppend = false;
check("storing the reply fails after the model ran: tokens still recorded, once", recorded.length === 1 && recorded[0].status === "error" && tokensOf(recorded[0]) === "10/1/0/0");

// ------------------------------------------------------------------ Anthropic adapter: partial usage extracted from an interrupted stream
// Stubbed fetch (no network, placeholder key). The stream sends message_start (with usage) and one text
// delta, then stalls until aborted — exactly what a timeout / closed tab looks like to the adapter.
const realFetch = globalThis.fetch;
const realKey = process.env.ANTHROPIC_API_KEY;
process.env.ANTHROPIC_API_KEY = "unit-test-placeholder-not-a-real-key";
globalThis.fetch = async (_url, init) => {
  const enc = new TextEncoder();
  const sse = (type, data) => enc.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(sse("message_start", { message: { id: "msg_test", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 1234, output_tokens: 1, cache_read_input_tokens: 800, cache_creation_input_tokens: 50 } } }));
      controller.enqueue(sse("content_block_start", { index: 0, content_block: { type: "text", text: "" } }));
      controller.enqueue(sse("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Partial" } }));
      init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_test" } });
};
try {
  const { anthropicProvider } = load("lib/ai/providers/anthropic.ts");
  const ac = new AbortController();
  let deltas = "";
  setTimeout(() => ac.abort(), 50);
  const err = await anthropicProvider
    .runTurn({ model: "m", system: { stable: "s", dynamic: "" }, messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }], tools: [], maxOutputTokens: 1024, effort: "medium", signal: ac.signal }, { onTextDelta: (d) => (deltas += d) })
    .then(() => null, (e) => e);
  check("adapter: interrupted stream throws AiProviderError (never a raw SDK error)", err instanceof AiProviderError, err && err.constructor.name);
  check("adapter: provider-reported usage before the interruption is attached", err?.partialUsage?.inputTokens === 1234 && err.partialUsage.cacheReadTokens === 800 && err.partialUsage.cacheWriteTokens === 50, JSON.stringify(err?.partialUsage));
  check("adapter: error message carries no key/secret", err && !String(err.message).includes("placeholder") && deltas === "Partial");
} finally {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = realKey;
}

const failed = results.filter((x) => !x.pass);
console.log(`\nringo_ai_unit: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
