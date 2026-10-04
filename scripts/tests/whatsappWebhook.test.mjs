// WhatsApp webhook Phase 3: signature verification, GET handshake, event parsing, account validation,
// idempotency keys, safe logging. No database, no network.
//   Run:  node scripts/tests/whatsappWebhook.test.mjs
import crypto from "crypto";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", detail); };

// Phase 4: accepted events are now persisted through the admin client. This suite stays database-free, so the server module is
// replaced by an in-memory client whose RPCs always answer "created" (real persistence behaviour: scripts/tests/whatsappIngest.test.mjs).
import fs from "fs";
import os from "os";
const serverStub = path.join(os.tmpdir(), `wa_webhook_server_${process.pid}.cjs`);
fs.writeFileSync(serverStub, "module.exports = { createAdminClient: () => ({ rpc: async () => ({ data: 'created', error: null }) }) };");
process.on("exit", () => { try { fs.unlinkSync(serverStub); } catch {} });
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": serverStub, "@": SRC }, interopDefault: true, cache: false, requireCache: false });
const route = jiti(path.join(SRC, "app/api/integrations/whatsapp/webhook/route.ts"));
const { verifyWhatsAppSignature, getWhatsAppAppSecret } = jiti(path.join(SRC, "lib/whatsapp/signature.ts"));
const { parseWhatsAppWebhook } = jiti(path.join(SRC, "lib/whatsapp/parseWebhook.ts"));
const { isProductionAccountEvent, partitionByAccount, getWhatsAppAccountConfig } = jiti(path.join(SRC, "lib/whatsapp/config.ts"));
const { dedupeEvents, messageIdempotencyKey, statusIdempotencyKey } = jiti(path.join(SRC, "lib/whatsapp/idempotency.ts"));

const SECRET = "test-app-secret";
const PHONE_ID = "1412365981960191";
const WABA_ID = "2613391429109745";
const sign = (body, secret = SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

const textPayload = (over = {}) => ({
  object: "whatsapp_business_account",
  entry: [{
    id: WABA_ID,
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "000", phone_number_id: PHONE_ID },
        contacts: [{ profile: { name: "Test Customer" }, wa_id: "237600000001" }],
        messages: [{ from: "237600000001", id: "wamid.AAA", timestamp: "1700000000", type: "text", text: { body: "SECRET BODY TEXT" } }],
        ...over,
      },
    }],
  }],
});
const statusPayload = (status = "delivered") => ({
  object: "whatsapp_business_account",
  entry: [{ id: WABA_ID, changes: [{ field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: { phone_number_id: PHONE_ID },
    statuses: [{ id: "wamid.OUT1", status, timestamp: "1700000050", recipient_id: "237600000001", errors: status === "failed" ? [{ code: 131047 }] : undefined }],
  } }] }],
});

// ---- signature unit ----
const body = JSON.stringify(textPayload());
check("signature: valid", verifyWhatsAppSignature(body, sign(body), SECRET));
check("signature: wrong secret rejected", !verifyWhatsAppSignature(body, sign(body, "other"), SECRET));
check("signature: tampered body rejected", !verifyWhatsAppSignature(body + " ", sign(body), SECRET));
check("signature: missing header rejected", !verifyWhatsAppSignature(body, null, SECRET));
check("signature: malformed header rejected", !verifyWhatsAppSignature(body, "sha256=zz", SECRET) && !verifyWhatsAppSignature(body, sign(body).slice(7), SECRET));
check("signature: wrong length rejected", !verifyWhatsAppSignature(body, "sha256=abcd", SECRET));
check("signature: no secret never verifies", !verifyWhatsAppSignature(body, sign(body, ""), "") && !verifyWhatsAppSignature(body, sign(body, ""), null));
check("secret: WHATSAPP_APP_SECRET preferred, META_APP_SECRET alias, blank -> null",
  getWhatsAppAppSecret({ WHATSAPP_APP_SECRET: "a", META_APP_SECRET: "b" }) === "a" &&
  getWhatsAppAppSecret({ META_APP_SECRET: "b" }) === "b" &&
  getWhatsAppAppSecret({ WHATSAPP_APP_SECRET: "  " }) === null);

// ---- parsing ----
{
  const { events, skipped } = parseWhatsAppWebhook(textPayload());
  const e = events[0];
  check("parse: inbound text", events.length === 1 && skipped === 0 && e.kind === "message" && e.type === "text" && e.text === "SECRET BODY TEXT" && e.messageId === "wamid.AAA" && e.from === "237600000001" && e.contactName === "Test Customer", JSON.stringify(e));
  check("parse: metadata ids + ISO timestamp", e.phoneNumberId === PHONE_ID && e.wabaId === WABA_ID && e.timestamp === "2023-11-14T22:13:20.000Z");
  check("parse: idempotency key for message", e.idempotencyKey === "msg:wamid.AAA" && e.idempotencyKey === messageIdempotencyKey("wamid.AAA"));
}
{
  const p = textPayload({ messages: [{ from: "1", id: "wamid.IMG", timestamp: "1700000000", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", sha256: "abc", caption: "cap" }, context: { id: "wamid.PARENT" } }] });
  const e = parseWhatsAppWebhook(p).events[0];
  check("parse: inbound media", e.type === "image" && e.text === null && e.media?.mediaId === "MEDIA1" && e.media.kind === "image" && e.media.mimeType === "image/jpeg" && e.media.caption === "cap" && e.replyToMessageId === "wamid.PARENT", JSON.stringify(e));
  const d = parseWhatsAppWebhook(textPayload({ messages: [{ from: "1", id: "wamid.DOC", type: "document", document: { id: "D1", filename: "a.pdf" } }] })).events[0];
  check("parse: document filename, missing timestamp -> null", d.media?.filename === "a.pdf" && d.timestamp === null);
  const u = parseWhatsAppWebhook(textPayload({ messages: [{ from: "1", id: "wamid.X", type: "weird_new_type" }] })).events[0];
  check("parse: unknown message type -> unsupported (still captured)", u.type === "unsupported" && u.text === null && u.media === null);
}
{
  const e = parseWhatsAppWebhook(statusPayload("delivered")).events[0];
  check("parse: status event", e.kind === "status" && e.status === "delivered" && e.messageId === "wamid.OUT1" && e.recipientId === "237600000001" && e.phoneNumberId === PHONE_ID && e.errorCodes.length === 0, JSON.stringify(e));
  check("parse: status idempotency key", e.idempotencyKey === "status:wamid.OUT1:delivered" && e.idempotencyKey === statusIdempotencyKey("wamid.OUT1", "delivered"));
  const f = parseWhatsAppWebhook(statusPayload("failed")).events[0];
  check("parse: failed status carries error codes", f.status === "failed" && f.errorCodes[0] === 131047);
  check("parse: unknown status -> unknown", parseWhatsAppWebhook(statusPayload("teleported")).events[0].status === "unknown");
}
for (const [label, bad] of [["null", null], ["string", "x"], ["array", []], ["wrong object", { object: "page", entry: [] }], ["no entry", { object: "whatsapp_business_account" }],
  ["entry garbage", { object: "whatsapp_business_account", entry: [1, null, { changes: "x" }] }],
  ["other field", { object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "account_update", value: {} }] }] }],
  ["no phone_number_id", { object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { messages: [{ id: "a", from: "b" }] } }] }] }],
  ["message without id", textPayload({ messages: [{ from: "1", type: "text" }, "junk"] })]]) {
  let r; let threw = false;
  try { r = parseWhatsAppWebhook(bad); } catch { threw = true; }
  check(`parse: malformed (${label}) does not throw and yields no events`, !threw && r.events.length === 0 && r.skipped > 0, JSON.stringify(r));
}
check("parse: one delivery can carry several events", parseWhatsAppWebhook(textPayload({ messages: [{ from: "1", id: "m1", type: "text" }, { from: "1", id: "m2", type: "text" }], statuses: [{ id: "o1", status: "read" }] })).events.length === 3);

// ---- idempotency ----
{
  const evs = parseWhatsAppWebhook(textPayload({ messages: [{ from: "1", id: "dup", type: "text" }, { from: "1", id: "dup", type: "text" }, { from: "1", id: "other", type: "text" }] })).events;
  check("idempotency: duplicate ids within a delivery collapse", dedupeEvents(evs).length === 2);
  const a = parseWhatsAppWebhook(statusPayload("sent")).events[0], b = parseWhatsAppWebhook(statusPayload("read")).events[0];
  check("idempotency: different status transitions of one message stay distinct", a.idempotencyKey !== b.idempotencyKey);
}

// ---- account validation ----
{
  const cfg = { phoneNumberId: PHONE_ID, wabaId: WABA_ID };
  const ev = parseWhatsAppWebhook(textPayload()).events[0];
  check("account: production phone + waba accepted", isProductionAccountEvent(ev, cfg));
  check("account: foreign phone_number_id rejected", !isProductionAccountEvent({ ...ev, phoneNumberId: "999" }, cfg));
  check("account: foreign waba rejected", !isProductionAccountEvent({ ...ev, wabaId: "999" }, cfg));
  check("account: phone-only config works", isProductionAccountEvent(ev, { phoneNumberId: PHONE_ID, wabaId: null }));
  check("account: unconfigured fails closed", !isProductionAccountEvent(ev, { phoneNumberId: null, wabaId: null }));
  const part = partitionByAccount([ev, { ...ev, phoneNumberId: "test-number" }], cfg);
  check("account: partition splits production from test events", part.accepted.length === 1 && part.rejected.length === 1);
  check("account: env config trims/blank -> null", getWhatsAppAccountConfig({ WHATSAPP_PHONE_NUMBER_ID: " 1 ", WHATSAPP_WABA_ID: "" }).phoneNumberId === "1" && getWhatsAppAccountConfig({ WHATSAPP_WABA_ID: "" }).wabaId === null);
}

// ---- route: GET ----
const env = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
const get = (qs) => route.GET(new Request("http://localhost/api/integrations/whatsapp/webhook?" + qs));
env("WHATSAPP_VERIFY_TOKEN", "verify-me");
{
  const ok = await get("hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345");
  check("GET: valid token echoes challenge", ok.status === 200 && (await ok.text()) === "12345");
  check("GET: wrong token -> 403", (await get("hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1")).status === 403);
  check("GET: wrong mode -> 403", (await get("hub.mode=unsubscribe&hub.verify_token=verify-me&hub.challenge=1")).status === 403);
  check("GET: missing challenge -> 403", (await get("hub.mode=subscribe&hub.verify_token=verify-me")).status === 403);
  env("WHATSAPP_VERIFY_TOKEN", undefined);
  check("GET: unset verify token never authorises (even 'undefined')", (await get("hub.mode=subscribe&hub.verify_token=undefined&hub.challenge=1")).status === 403);
  env("WHATSAPP_VERIFY_TOKEN", "verify-me");
}

// ---- route: POST ----
env("WHATSAPP_APP_SECRET", SECRET);
env("META_APP_SECRET", undefined);
env("WHATSAPP_PHONE_NUMBER_ID", PHONE_ID);
env("WHATSAPP_WABA_ID", WABA_ID);
const logs = []; const everyLog = [];
const origInfo = console.info; console.info = (...a) => { logs.push(a.join(" ")); everyLog.push(a.join(" ")); };
const post = async (raw, headers = {}) => route.POST(new Request("http://localhost/api/integrations/whatsapp/webhook", { method: "POST", body: raw, headers }));
try {
  let r = await post(body, { "x-hub-signature-256": sign(body) });
  check("POST: valid signature -> 200", r.status === 200 && (await r.json()).received === true);
  const accepted = logs.filter((l) => l.includes('"accepted"'));
  check("POST: logs accepted event with ids only", accepted.length === 1 && accepted[0].includes("wamid.AAA") && accepted[0].includes(PHONE_ID));

  logs.length = 0;
  r = await post(body, { "x-hub-signature-256": sign(body, "wrong") });
  check("POST: invalid signature -> 401", r.status === 401);
  r = await post(body);
  check("POST: missing signature -> 401", r.status === 401);
  r = await post(body, { "x-hub-signature-256": "sha256=" });
  check("POST: empty signature value -> 401", r.status === 401);
  check("POST: untrusted request logged without processing events", logs.length === 3 && logs.every((l) => l.includes("invalid_signature")));

  r = await post(body + " ", { "x-hub-signature-256": sign(body) });
  check("POST: body altered after signing -> 401", r.status === 401);

  const bad = "not json{";
  r = await post(bad, { "x-hub-signature-256": sign(bad) });
  check("POST: signed malformed JSON -> 200 (no Meta retry loop)", r.status === 200);
  const odd = JSON.stringify({ object: "whatsapp_business_account", entry: [null] });
  r = await post(odd, { "x-hub-signature-256": sign(odd) });
  check("POST: signed unsupported structure -> 200", r.status === 200);

  logs.length = 0;
  const foreign = JSON.stringify(textPayload());
  env("WHATSAPP_PHONE_NUMBER_ID", "somebody-else");
  r = await post(foreign, { "x-hub-signature-256": sign(foreign) });
  check("POST: foreign phone_number_id -> 200 but ignored", r.status === 200 && logs.some((l) => l.includes("ignored_foreign_account")) && !logs.some((l) => l.includes('"accepted"')));
  env("WHATSAPP_PHONE_NUMBER_ID", undefined); env("WHATSAPP_WABA_ID", undefined);
  logs.length = 0;
  r = await post(foreign, { "x-hub-signature-256": sign(foreign) });
  check("POST: account unconfigured fails closed (ignored, still 200)", r.status === 200 && !logs.some((l) => l.includes('"accepted"')));

  const st = JSON.stringify(statusPayload("read"));
  env("WHATSAPP_PHONE_NUMBER_ID", PHONE_ID);
  r = await post(st, { "x-hub-signature-256": sign(st) });
  check("POST: status event -> 200", r.status === 200);

  env("WHATSAPP_APP_SECRET", undefined);
  r = await post(body, { "x-hub-signature-256": sign(body, "") });
  check("POST: app secret not configured -> 503, never trusts", r.status === 503);
  env("META_APP_SECRET", SECRET);
  r = await post(body, { "x-hub-signature-256": sign(body) });
  check("POST: META_APP_SECRET alias is honoured", r.status === 200);
} finally { console.info = origInfo; }

// ---- logging hygiene ----
const all = logs.join("\n");
check("logs: no message body, customer number, name, secrets or verify token",
  !/SECRET BODY TEXT|237600000001|Test Customer|test-app-secret|verify-me/.test(all), all);

env("WHATSAPP_APP_SECRET", undefined); env("META_APP_SECRET", undefined); env("WHATSAPP_PHONE_NUMBER_ID", undefined); env("WHATSAPP_WABA_ID", undefined); env("WHATSAPP_VERIFY_TOKEN", undefined);
const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
