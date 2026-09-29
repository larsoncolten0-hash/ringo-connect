// Unit checks for the OpenAI Ringo AI adapter (src/lib/ai/providers/openai.ts). No network, no
// database, no real API key: it loads the real TypeScript module through jiti (same convention as
// ringo_ai_unit.test.mjs) and drives the real `openai` package's Responses streaming client through
// a stubbed global fetch that serves hand-built SSE frames — the same technique the existing suite
// uses for the Anthropic adapter. Covers:
//   * provider id / isConfigured (present vs missing OPENAI_API_KEY)
//   * text response conversion + text delta streaming (handlers.onTextDelta)
//   * function/tool call conversion (name, call_id → id, JSON-parsed arguments)
//   * multiple simultaneous tool calls in one turn
//   * tool-result continuation: the request sent for the NEXT turn replays the original
//     function_call item(s) verbatim (providerState) plus a function_call_output per result
//   * stop-reason mapping: end, tool_calls, refusal, max_tokens (incomplete/max_output_tokens),
//     other (incomplete/content_filter)
//   * token usage conversion, including cache read/write from input_tokens_details
//   * error normalization: rate limit, auth, bad request, server error, network failure, abort
//   * a failed or cancelled response is never read as a successful final answer
//
//   Run:  node scripts/tests/ringo_ai_openai_unit.test.mjs
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

// ------------------------------------------------------------------ SSE fixture builders
// Minimal-but-valid Responses API event sequences — verified against the real installed
// `openai` package (v7.23.0) before being wired into these checks.
function sseFrame(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}
function skeleton(overrides = {}) {
  return {
    id: "resp_1", object: "response", created_at: 0, output_text: "", error: null, incomplete_details: null,
    instructions: null, metadata: {}, model: "gpt-6-luna", output: [], parallel_tool_calls: true, temperature: 1,
    tool_choice: "auto", tools: [], top_p: 1, status: "in_progress", ...overrides,
  };
}
function textEvents({ text = "Hello", usage } = {}) {
  const id = "msg_1";
  // Content part includes `parsed: null`, exactly like the real API (confirmed live) — also an
  // SDK-added, output-only field that must not be replayed back as input.
  const part = { type: "output_text", text, annotations: [], parsed: null };
  return [
    { type: "response.created", response: skeleton() },
    { type: "response.output_item.added", output_index: 0, item: { id, type: "message", role: "assistant", status: "in_progress", content: [] } },
    { type: "response.content_part.added", item_id: id, output_index: 0, content_index: 0, part: { ...part, text: "" } },
    { type: "response.output_text.delta", item_id: id, output_index: 0, content_index: 0, delta: text },
    { type: "response.output_text.done", item_id: id, output_index: 0, content_index: 0, text },
    { type: "response.content_part.done", item_id: id, output_index: 0, content_index: 0, part },
    { type: "response.output_item.done", output_index: 0, item: { id, type: "message", role: "assistant", status: "completed", content: [part] } },
    { type: "response.completed", response: skeleton({ status: "completed", output: [{ id, type: "message", role: "assistant", status: "completed", content: [part] }], usage }) },
  ];
}
function toolCallEvents(calls, usage) {
  // Includes `parsed_arguments`, exactly like the real API (confirmed live) — an SDK-added,
  // output-only convenience field that must NOT be replayed back as input (see openai.ts's
  // sanitizeProviderStateItem and the "tool-result continuation" checks below).
  const items = calls.map((c, i) => ({
    id: `fc_${i}`,
    type: "function_call",
    call_id: c.call_id,
    name: c.name,
    arguments: c.arguments,
    status: "completed",
    parsed_arguments: JSON.parse(c.arguments || "{}"),
  }));
  const events = [{ type: "response.created", response: skeleton() }];
  items.forEach((item, i) => {
    events.push({ type: "response.output_item.added", output_index: i, item: { ...item, status: "in_progress" } });
    events.push({ type: "response.function_call_arguments.done", item_id: item.id, output_index: i, arguments: item.arguments });
    events.push({ type: "response.output_item.done", output_index: i, item });
  });
  events.push({ type: "response.completed", response: skeleton({ status: "completed", output: items, usage }) });
  return events;
}
function refusalEvents(refusal) {
  const id = "msg_1";
  return [
    { type: "response.created", response: skeleton() },
    { type: "response.output_item.added", output_index: 0, item: { id, type: "message", role: "assistant", status: "in_progress", content: [] } },
    { type: "response.output_item.done", output_index: 0, item: { id, type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal }] } },
    { type: "response.completed", response: skeleton({ status: "completed", output: [{ id, type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal }] }] }) },
  ];
}
function incompleteEvents(reason) {
  return [
    { type: "response.created", response: skeleton() },
    { type: "response.incomplete", response: skeleton({ status: "incomplete", incomplete_details: { reason }, output: [] }) },
  ];
}
function failedEvents(error) {
  return [
    { type: "response.created", response: skeleton() },
    { type: "response.failed", response: skeleton({ status: "failed", error, output: [] }) },
  ];
}

// The `openai` client resolves `fetch` ONCE at construction (client.js: `this.fetch = options.fetch
// ?? Shims.getDefaultFetch()`), not per request — so reassigning `globalThis.fetch` after the
// adapter's cached client already exists has no effect on it. A single dispatcher is installed once,
// before the first request, and each test just swaps out what it currently serves.
let currentHandler = async () => new Response(null, { status: 500 });
const realFetch = globalThis.fetch;
globalThis.fetch = (...args) => currentHandler(...args);

// Points fetch at `events` as one SSE response (or an HTTP error / network failure), capturing the
// request body sent. If `stall` is set, the connection hangs (for abort/cancellation testing).
function stubFetch(events, { stall = false, httpStatus = null, httpBody = null, networkError = false } = {}) {
  let capturedBody = null;
  currentHandler = async (_url, init) => {
    if (init?.body) capturedBody = JSON.parse(init.body);
    if (networkError) throw new TypeError("fetch failed");
    if (httpStatus) return new Response(JSON.stringify(httpBody), { status: httpStatus, headers: { "content-type": "application/json" } });
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const e of events) controller.enqueue(enc.encode(sseFrame(e)));
        if (stall) init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
        else controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return { restore: () => {}, body: () => capturedBody };
}

// ------------------------------------------------------------------ provider registration / config
const realKey = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;
{
  const { openaiProvider } = load("lib/ai/providers/openai.ts");
  check("provider id is 'openai'", openaiProvider.id === "openai");
  check("isConfigured() false when OPENAI_API_KEY is unset", openaiProvider.isConfigured() === false);
  process.env.OPENAI_API_KEY = "unit-test-placeholder-not-a-real-key";
  check("isConfigured() true once OPENAI_API_KEY is set", openaiProvider.isConfigured() === true);
}
const { getAiProvider, listAiProviderIds } = load("lib/ai/providers/index.ts");
check("openai is registered in the provider index", getAiProvider("openai")?.id === "openai");
check("anthropic is still registered alongside it", getAiProvider("anthropic")?.id === "anthropic");
check("listAiProviderIds reports both", listAiProviderIds().sort().join() === "anthropic,openai");

const { openaiProvider } = load("lib/ai/providers/openai.ts");
const baseReq = (over = {}) => ({
  model: "gpt-6-luna",
  system: { stable: "You are Ringo AI.", dynamic: "" },
  messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
  tools: [],
  maxOutputTokens: 1024,
  effort: "medium",
  ...over,
});

// ------------------------------------------------------------------ text response + streaming
{
  const usage = { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 }, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 15 };
  const stub = stubFetch(textEvents({ text: "Hello world", usage }));
  let deltas = "";
  const result = await openaiProvider.runTurn(baseReq(), { onTextDelta: (d) => (deltas += d) });
  stub.restore();
  check("text response: reply text extracted", result.message.parts.some((p) => p.type === "text" && p.text === "Hello world"));
  check("text response: streamed via onTextDelta", deltas === "Hello world");
  check("text response: stop reason 'end'", result.stopReason === "end");
  check("text response: providerState carries the raw output items for replay", Array.isArray(result.message.providerState) && result.message.providerState[0].type === "message");
  check("usage: input/output tokens mapped", result.usage.inputTokens === 10 && result.usage.outputTokens === 5);
  check("usage: cache read/write mapped from input_tokens_details", result.usage.cacheReadTokens === 3 && result.usage.cacheWriteTokens === 2);
}

// ------------------------------------------------------------------ tool call conversion
{
  const stub = stubFetch(toolCallEvents([{ call_id: "call_abc", name: "lookup_ringo_help", arguments: '{"topic":"catalog"}' }]));
  const result = await openaiProvider.runTurn(baseReq());
  stub.restore();
  const call = result.message.parts.find((p) => p.type === "tool_call");
  check("tool call: present with id = call_id (not the item id)", call?.id === "call_abc");
  check("tool call: name preserved", call?.name === "lookup_ringo_help");
  check("tool call: arguments JSON-parsed into input", call?.input?.topic === "catalog");
  check("tool call: stop reason 'tool_calls'", result.stopReason === "tool_calls");
}

// ------------------------------------------------------------------ multiple simultaneous tool calls
{
  const stub = stubFetch(
    toolCallEvents([
      { call_id: "call_1", name: "get_my_profile_overview", arguments: "{}" },
      { call_id: "call_2", name: "get_my_catalog_summary", arguments: "{}" },
    ])
  );
  const result = await openaiProvider.runTurn(baseReq());
  stub.restore();
  const calls = result.message.parts.filter((p) => p.type === "tool_call");
  check("multiple tool calls: both present with distinct ids", calls.length === 2 && calls[0].id === "call_1" && calls[1].id === "call_2");
}

// ------------------------------------------------------------------ tool-result continuation (the request built for the NEXT turn)
{
  // Simulates exactly what orchestrator.ts does: push the assistant turn (with providerState)
  // then a user turn carrying the tool_result, and check what actually gets sent to the API.
  const stub = stubFetch(toolCallEvents([{ call_id: "call_abc", name: "lookup_ringo_help", arguments: "{}" }]));
  const first = await openaiProvider.runTurn(baseReq());
  stub.restore();

  const stub2 = stubFetch(textEvents({ text: "done" }));
  await openaiProvider.runTurn(
    baseReq({
      messages: [
        { role: "user", parts: [{ type: "text", text: "hi" }] },
        first.message,
        { role: "user", parts: [{ type: "tool_result", toolCallId: "call_abc", content: '{"ok":true}', isError: false }] },
      ],
    })
  );
  const sent = stub2.body();
  stub2.restore();
  const fnCall = sent.input.find((i) => i.type === "function_call");
  const fnOutput = sent.input.find((i) => i.type === "function_call_output");
  check("continuation: the replayed function_call item keeps its identity", fnCall?.call_id === "call_abc" && fnCall?.name === "lookup_ringo_help");
  check("continuation: a function_call_output with the matching call_id is sent", fnOutput?.call_id === "call_abc" && fnOutput?.output === '{"ok":true}');
  // Regression check for the live HTTP 400 this fixed: OpenAI rejects a replayed function_call
  // item that still carries the SDK's output-only `parsed_arguments` field ("Unknown parameter:
  // 'input[1].parsed_arguments'"). toolCallEvents() above deliberately includes that field, like
  // the real API does, so this fails again if sanitizeProviderStateItem regresses.
  check("continuation: SDK-only 'parsed_arguments' is NOT present on the replayed function_call", fnCall && !("parsed_arguments" in fnCall), JSON.stringify(fnCall));
  check("continuation: only the documented function_call fields are sent", fnCall && Object.keys(fnCall).sort().join() === "arguments,call_id,id,name,status,type", fnCall && Object.keys(fnCall).sort().join());
}

// ------------------------------------------------------------------ message providerState replay (same SDK-enrichment issue, different item type)
{
  const stub = stubFetch(textEvents({ text: "here you go" }));
  const first = await openaiProvider.runTurn(baseReq());
  stub.restore();

  const stub2 = stubFetch(textEvents({ text: "ok" }));
  await openaiProvider.runTurn(
    baseReq({
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }, first.message, { role: "user", parts: [{ type: "text", text: "thanks" }] }],
    })
  );
  const sent = stub2.body();
  stub2.restore();
  const replayedMessage = sent.input.find((i) => i.type === "message" && i.role === "assistant");
  const textPart = replayedMessage?.content?.find((c) => c.type === "output_text");
  check("message replay: SDK-only 'parsed' is NOT present on the replayed content part", textPart && !("parsed" in textPart), JSON.stringify(textPart));
  check("message replay: 'annotations' (a real, valid field) is preserved", textPart && Array.isArray(textPart.annotations));
  check("message replay: text content itself is preserved", textPart?.text === "here you go");
}

// ------------------------------------------------------------------ stop-reason mapping
{
  let stub = stubFetch(refusalEvents("I can't help with that."));
  let r = await openaiProvider.runTurn(baseReq());
  stub.restore();
  check("refusal → stop reason 'refusal'", r.stopReason === "refusal");

  stub = stubFetch(incompleteEvents("max_output_tokens"));
  r = await openaiProvider.runTurn(baseReq());
  stub.restore();
  check("incomplete/max_output_tokens → stop reason 'max_tokens'", r.stopReason === "max_tokens");

  stub = stubFetch(incompleteEvents("content_filter"));
  r = await openaiProvider.runTurn(baseReq());
  stub.restore();
  check("incomplete/content_filter → stop reason 'other' (not silently 'end')", r.stopReason === "other");
}

// ------------------------------------------------------------------ failed / cancelled responses are never read as success
{
  const stub = stubFetch(failedEvents({ code: "server_error", message: "boom" }));
  const err = await openaiProvider.runTurn(baseReq()).then(() => null, (e) => e);
  stub.restore();
  check("a failed response throws rather than returning a fabricated success", err && err.constructor.name === "AiProviderError", err && String(err));
}

// ------------------------------------------------------------------ error normalization
{
  const cases = [
    ["rate limit (429)", 429, "rate_limited"],
    ["auth (401)", 401, "auth"],
    ["bad request (400)", 400, "bad_request"],
    ["server error (500)", 500, "overloaded"],
  ];
  for (const [label, httpStatus, expectedCode] of cases) {
    const stub = stubFetch([], { httpStatus, httpBody: { error: { message: "x", type: "x" } } });
    const err = await openaiProvider.runTurn(baseReq()).then(() => null, (e) => e);
    stub.restore();
    check(`error normalization: ${label} → AiProviderError(${expectedCode})`, err?.constructor?.name === "AiProviderError" && err.code === expectedCode, err && `${err.constructor.name}:${err.code}`);
  }
  const stub = stubFetch([], { networkError: true });
  const err = await openaiProvider.runTurn(baseReq()).then(() => null, (e) => e);
  stub.restore();
  check("error normalization: network failure → AiProviderError(unavailable)", err?.code === "unavailable", err && err.code);
}

// ------------------------------------------------------------------ cancellation
{
  const stub = stubFetch([{ type: "response.created", response: skeleton() }], { stall: true });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  const err = await openaiProvider.runTurn(baseReq({ signal: ac.signal })).then(() => null, (e) => e);
  stub.restore();
  check("cancellation: aborted request throws AiProviderError (never a raw SDK error)", err?.constructor?.name === "AiProviderError", err && String(err));
  check("cancellation: error message carries no key/secret", err && !String(err.message).includes("placeholder"));
}

if (realKey === undefined) delete process.env.OPENAI_API_KEY;
else process.env.OPENAI_API_KEY = realKey;
globalThis.fetch = realFetch;

const failed = results.filter((x) => !x.pass);
console.log(`\nringo_ai_openai_unit: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
