// Card appointments, APPLICATION layer (the WhatsApp "Meet a Ringo agent" meeting requests): the confirm / decline / cancel logic with its authorization order, the customer's WhatsApp
// notice only after the change succeeded, the honest notification outcomes, the route / page / view wiring, and the English / French dictionaries. Nothing here connects to Supabase,
// Meta or any network, reads .env.local, or touches a payment: the database and the sender are stand-ins (the real database rules are proven in cardAppointmentsSql.test.mjs, the bot
// side in whatsappSalesBot.test.mjs).
//   Run:  node scripts/tests/cardAppointments.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const raw = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
console.info = () => {};
let passed = 0;
const failures = [];
const test = async (name, fn) => { try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };

const Lib = jiti(path.join(SRC, "lib/salesBot/appointments.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const EN = translations.en.inbox.salesBot, FR = translations.fr.inbox.salesBot;

const APPT = "a1111111-1111-4111-8111-111111111111";
const CONV = "c2222222-2222-4222-8222-222222222222";
const ACTOR = "d3333333-3333-4333-8333-333333333333";
const FORGED_CONV = "e4444444-4444-4444-8444-444444444444";

/** A scripted database + guard + sender, recording every call in order. */
function rig({ locate = { result: "ok", conversation_id: CONV, profile_id: "p" }, set = { result: "ok", status: "confirmed", from: "pending", conversation_id: CONV, profile_id: "p", lang: "en" }, guard = { ok: true, kind: "member", userId: ACTOR, profileId: "p", admin: { rpc: async () => ({ data: null, error: null }) } }, send = async () => ({ status: 200, body: { ok: true, state: "sent", message_id: "m" } }), rpcError = {}, notify = "ok" } = {}) {
  const calls = [];
  const admin = {
    rpc: async (fn, args) => {
      calls.push({ kind: "rpc", fn, args });
      if (rpcError[fn] === "throw") throw new Error("db down SECRET");
      if (rpcError[fn]) return { data: null, error: { code: String(rpcError[fn]) } };
      if (fn === "card_appt_locate") return { data: locate, error: null };
      if (fn === "card_appt_set_status") return { data: set, error: null };
      if (fn === "card_appt_record_notify") return { data: notify, error: null };
      return { data: null, error: { code: "unknown" } };
    },
  };
  const deps = {
    admin,
    guard: async (conversationId, permission) => { calls.push({ kind: "guard", conversationId, permission }); return guard; },
    send: async (d, input) => { calls.push({ kind: "send", d, input }); const r = await send(d, input); return r; },
  };
  return { deps, calls, names: () => calls.map((c) => (c.kind === "rpc" ? c.fn : c.kind)) };
}
const go = (r, input) => Lib.changeAppointmentStatus(r.deps, input);

// ============================================================ input validation happens before anything is read
await test("invalid input is refused before ANY database, guard or sender call", async () => {
  for (const [input, status] of [
    [{ appointmentId: "not-a-uuid", to: "confirmed" }, 404], [{ appointmentId: null, to: "confirmed" }, 404], [{ appointmentId: APPT, to: "pending" }, 422], [{ appointmentId: APPT, to: "activated" }, 422],
    [{ appointmentId: APPT, to: undefined }, 422], [{ appointmentId: APPT, to: 5 }, 422], [{ appointmentId: APPT, to: "confirmed", details: 7 }, 422], [{ appointmentId: APPT, to: "confirmed", details: "x".repeat(301) }, 422],
  ]) { const r = rig(); const res = await go(r, input); assert.strictEqual(res.status, status, JSON.stringify(input)); assert.strictEqual(res.body.ok, false); assert.deepStrictEqual(r.names(), []); }
});

// ============================================================ the order: locate -> guard (that conversation) -> change -> only then the customer
await test("an unknown appointment is 404 and the guard is never asked (nothing about it is revealed)", async () => {
  const r = rig({ locate: { result: "not_found" } });
  const res = await go(r, { appointmentId: APPT, to: "confirmed" });
  assert.strictEqual(res.status, 404); assert.deepStrictEqual(r.names(), ["card_appt_locate"]);
});
await test("the guard is asked about the conversation the DATABASE says the appointment belongs to, with inbox.reply, never about anything the browser sent", async () => {
  const r = rig();
  await go(r, { appointmentId: APPT, to: "confirmed", details: "x", conversation_id: FORGED_CONV, profile_id: "other", userId: "mallory" });
  const g = r.calls.find((c) => c.kind === "guard");
  assert.strictEqual(g.conversationId, CONV); assert.strictEqual(g.permission, "inbox.reply");
  const s = r.calls.find((c) => c.fn === "card_appt_set_status");
  assert.strictEqual(s.args.p_actor_user_id, ACTOR); assert.strictEqual(s.args.p_appointment_id, APPT);
  assert.ok(!JSON.stringify(r.calls).includes("mallory") && !JSON.stringify(r.calls).includes(FORGED_CONV));
});
await test("a guard refusal stops everything: 403 forbidden for a member without the permission, 404 for anyone else (401, 403 not-member and 404 look the same), 500 only for a server problem; nothing is changed and nobody is told", async () => {
  for (const [guard, status, error] of [
    [{ ok: false, status: 403, error: "forbidden" }, 403, "forbidden"], [{ ok: false, status: 401, error: "not_found" }, 404, "not_found"],
    [{ ok: false, status: 403, error: "not_found" }, 404, "not_found"], [{ ok: false, status: 404, error: "not_found" }, 404, "not_found"], [{ ok: false, status: 503, error: "server_error" }, 500, "server_error"],
  ]) { const r = rig({ guard }); const res = await go(r, { appointmentId: APPT, to: "confirmed" }); assert.strictEqual(res.status, status); assert.strictEqual(res.body.error, error); assert.deepStrictEqual(r.names(), ["card_appt_locate", "guard"]); }
});
await test("the database has the last word: a refusal there (forbidden, not found, invalid transition, invalid) changes nothing and sends nothing", async () => {
  for (const [set, status, error] of [[{ result: "forbidden" }, 403, "forbidden"], [{ result: "not_found" }, 404, "not_found"], [{ result: "invalid_transition", status: "declined" }, 409, "invalid_transition"], [{ result: "invalid" }, 422, "invalid"], [{ result: "weird" }, 404, "not_found"]]) {
    const r = rig({ set }); const res = await go(r, { appointmentId: APPT, to: "confirmed" });
    assert.strictEqual(res.status, status); assert.strictEqual(res.body.error, error); assert.ok(!r.names().includes("send")); assert.ok(!r.names().includes("card_appt_record_notify"));
  }
});
await test("an unavailable database is a 500, never a half-done change: no customer message, no claim of success", async () => {
  for (const fn of ["card_appt_locate", "card_appt_set_status"]) { for (const mode of ["throw", "XX000"]) { const r = rig({ rpcError: { [fn]: mode } }); const res = await go(r, { appointmentId: APPT, to: "confirmed" }); assert.strictEqual(res.status, 500, fn + mode); assert.strictEqual(res.body.ok, false); assert.ok(!r.names().includes("send")); assert.ok(!JSON.stringify(res).includes("SECRET")); } }
});
await test("asking for the status it already has is a no-op: 200, the customer is NOT messaged a second time", async () => {
  const r = rig({ set: { result: "noop", status: "confirmed", conversation_id: CONV, profile_id: "p", lang: "en" } });
  const res = await go(r, { appointmentId: APPT, to: "confirmed" });
  assert.strictEqual(res.status, 200); assert.deepStrictEqual(res.body, { ok: true, state: "confirmed", notified: "none", unchanged: true }); assert.ok(!r.names().includes("send")); assert.ok(!r.names().includes("card_appt_record_notify"), "the stored notification outcome is not touched");
});

// ============================================================ the customer is told only after success, in their language, and the outcome is real
await test("after a successful change the customer is sent ONE message through the Inbox sender as the real actor, to the located conversation, with a stable request id", async () => {
  const r = rig();
  const res = await go(r, { appointmentId: APPT, to: "confirmed", details: "  Saturday 10:30,\n Akwa  " });
  assert.deepStrictEqual(r.names(), ["card_appt_locate", "guard", "card_appt_set_status", "send", "card_appt_record_notify"]);
  const send = r.calls.find((c) => c.kind === "send");
  assert.strictEqual(send.input.userId, ACTOR); assert.strictEqual(send.input.conversationId, CONV); assert.strictEqual(send.input.text, EN.apptDecision("confirmed", "Saturday 10:30, Akwa"));
  assert.ok(typeof send.input.clientRequestId === "string" && /^[0-9a-f-]{36}$/.test(send.input.clientRequestId));
  assert.strictEqual(r.calls.find((c) => c.fn === "card_appt_set_status").args.p_details, "Saturday 10:30, Akwa");
  assert.deepStrictEqual(res.body, { ok: true, state: "confirmed", notified: "sent" });
  const again = rig(); await go(again, { appointmentId: APPT, to: "confirmed" });
  assert.strictEqual(again.calls.find((c) => c.kind === "send").input.clientRequestId, send.input.clientRequestId, "a retry uses the same request id, so the sender can never send it twice");
});
await test("each outcome is reported and recorded as it really was: sent, window closed, failed (a 202 'unconfirmed' and a thrown error count as failed, never as sent)", async () => {
  for (const [send, expected] of [
    [async () => ({ status: 200, body: { ok: true, state: "sent", message_id: "m" } }), "sent"],
    [async () => ({ status: 422, body: { ok: false, error: "window_closed", state: "failed" } }), "window_closed"],
    [async () => ({ status: 202, body: { ok: true, state: "unconfirmed", message_id: "m" } }), "failed"],
    [async () => ({ status: 422, body: { ok: false, error: "send_failed" } }), "failed"],
    [async () => ({ status: 503, body: { ok: false, error: "not_configured" } }), "failed"],
    [async () => { throw new Error("network SECRET"); }, "failed"],
  ]) {
    const r = rig({ send }); const res = await go(r, { appointmentId: APPT, to: "declined" });
    assert.strictEqual(res.status, 200); assert.strictEqual(res.body.ok, true); assert.strictEqual(res.body.state, "declined"); assert.strictEqual(res.body.notified, expected);
    assert.strictEqual(r.calls.find((c) => c.fn === "card_appt_record_notify").args.p_outcome, expected);
    assert.ok(!JSON.stringify(res).includes("SECRET"));
  }
});
await test("a failure to tell the customer never undoes or hides the change: the status is still reported as changed and the failure is reported honestly", async () => {
  const r = rig({ send: async () => { throw new Error("down"); }, notify: "not_found" });
  const res = await go(r, { appointmentId: APPT, to: "cancelled" });
  assert.deepStrictEqual(res.body, { ok: true, state: "cancelled", notified: "failed" });
});
await test("the customer's message is in THEIR language (English or French) and never promises beyond what happened", async () => {
  for (const [lang, L] of [["en", EN], ["fr", FR]]) {
    for (const to of ["confirmed", "declined", "cancelled"]) {
      const r = rig({ set: { result: "ok", status: to, from: "pending", conversation_id: CONV, profile_id: "p", lang } });
      await go(r, { appointmentId: APPT, to, details: to === "confirmed" ? "Samedi 10h30" : null });
      assert.strictEqual(r.calls.find((c) => c.kind === "send").input.text, L.apptDecision(to, to === "confirmed" ? "Samedi 10h30" : null));
    }
  }
  const confirmed = EN.apptDecision("confirmed", null), declined = EN.apptDecision("declined", null), cancelled = EN.apptDecision("cancelled", null);
  assert.ok(/confirmed/.test(confirmed) && !/confirmed/.test(declined.replace(/not confirmed/g, "")) && !/confirmed/.test(cancelled));
  assert.ok(!/\b(guarantee|garanti|within \d|dans les \d)/i.test(confirmed + declined + cancelled + FR.apptDecision("confirmed", null)));
  assert.ok(confirmed.includes("A team member will share the details") && FR.apptDecision("confirmed", null).includes("partagera les détails"));
  assert.ok(EN.apptDecision("confirmed", "BRING ID").includes("BRING ID") && !EN.apptDecision("confirmed", "BRING ID").includes("A team member will share the details"));
});

await test("a double click or retry is a pure no-op for the customer too: no second message, no new record of an outcome, for every target including completed", async () => {
  for (const to of ["confirmed", "declined", "cancelled", "completed"]) {
    const r = rig({ set: { result: "noop", status: to, conversation_id: CONV, profile_id: "p", lang: "en" } });
    const res = await go(r, { appointmentId: APPT, to });
    assert.deepStrictEqual(res.body, { ok: true, state: to, notified: "none", unchanged: true });
    assert.ok(!r.names().includes("send") && !r.names().includes("card_appt_record_notify"), to);
  }
});
await test("completed is a valid target, needs the same authorization, and does NOT message the customer (housekeeping) or record any outcome: the database already cleared the previous one", async () => {
  const r = rig({ set: { result: "ok", status: "completed", from: "confirmed", conversation_id: CONV, profile_id: "p", lang: "fr" } });
  const res = await go(r, { appointmentId: APPT, to: "completed", details: "  Rencontre faite " });
  assert.deepStrictEqual(r.names(), ["card_appt_locate", "guard", "card_appt_set_status"]);
  assert.strictEqual(r.calls.find((c) => c.kind === "guard").permission, "inbox.reply");
  assert.strictEqual(r.calls.find((c) => c.fn === "card_appt_set_status").args.p_details, "Rencontre faite");
  assert.deepStrictEqual(res.body, { ok: true, state: "completed", notified: "none" });
  const denied = rig({ guard: { ok: false, status: 403, error: "forbidden" } });
  assert.strictEqual((await go(denied, { appointmentId: APPT, to: "completed" })).status, 403);
  assert.ok(!denied.names().includes("card_appt_set_status"));
  const wrong = rig({ set: { result: "invalid_transition", status: "pending" } });
  assert.strictEqual((await go(wrong, { appointmentId: APPT, to: "completed" })).status, 409);
  assert.ok(!wrong.names().includes("send"));
});
await test("a real change to confirmed / declined / cancelled still messages the customer exactly once, after the change (completed is the only silent target)", async () => {
  for (const to of ["confirmed", "declined", "cancelled"]) { const r = rig({ set: { result: "ok", status: to, from: "pending", conversation_id: CONV, profile_id: "p", lang: "en" } }); await go(r, { appointmentId: APPT, to }); assert.strictEqual(r.calls.filter((c) => c.kind === "send").length, 1, to); assert.ok(r.names().indexOf("send") > r.names().indexOf("card_appt_set_status")); }
});
await test("the bot's status answer knows 'completed' in both languages (a completed request is closed: a new one can be sent)", () => {
  assert.ok(/\*completed\*/.test(EN.apptStatusText("completed")) && /send a new one/.test(EN.apptStatusText("completed")) && /\*terminée\*/.test(FR.apptStatusText("completed")) && /nouvelle/.test(FR.apptStatusText("completed")));
  assert.ok(/no meeting request yet/.test(EN.apptStatusText("none")) && EN.apptStatusText("completed") !== EN.apptStatusText("none"));
});

// ============================================================ wiring: route, page, view, links
const route = raw("src/app/api/inbox/appointments/[id]/status/route.ts"), page = raw("src/app/dashboard/inbox/appointments/page.tsx"), view = raw("src/components/inbox/AppointmentsView.tsx"), lib = raw("src/lib/salesBot/appointments.ts");
await test("the route: POST only, JSON only, size-capped, no-store, takes ONLY `status` and `details` from the body and the id from the URL, authorizes through the Inbox conversation guard", () => {
  assert.ok(/export async function POST/.test(route) && !/export async function (GET|PUT|PATCH|DELETE)/.test(route));
  assert.ok(/application\/json/.test(route) && /MAX_BODY_CHARS/.test(route) && /Cache-Control": "no-store"/.test(route) && /export const runtime = "nodejs"/.test(route));
  assert.ok(/to: body\.status, details: body\.details/.test(route) && /appointmentId: params\.id/.test(route));
  assert.ok(/guardConversationAction\(conversationId, permission, "card_appointments"\)/.test(route));
  assert.ok(!/body\.(profile_id|conversation_id|user|userId|actor|owner|phone|to|recipient)\b/.test(route));
});
await test("the library: the change is authorized against the conversation the database located, the permission is inbox.reply, and the customer is only told after set_status succeeded", () => {
  const code = strip(lib);
  assert.ok(code.indexOf("card_appt_locate") < code.indexOf("deps.guard(") && code.indexOf("deps.guard(") < code.indexOf("card_appt_set_status") && code.indexOf("card_appt_set_status") < code.indexOf("sender("));
  assert.ok(/guard\(conversationId, "inbox\.reply"\)/.test(code));
  assert.ok(!/bookings|signup|payment|fapshi|subscription|plans|addons/i.test(code));
});
await test("the page: the organization comes from the server-resolved actor (never the URL), rows are read through the user's own session filtered by that profile, buttons only for the owner or inbox.reply", () => {
  assert.ok(/resolveInboxActor\(\)/.test(page) && /\.eq\("profile_id", actor\.profileId\)/.test(page) && /actor\.supabase/.test(page));
  assert.ok(/canAct = actor\.kind === "owner" \|\| actor\.permissions\.includes\("inbox\.reply"\)/.test(page));
  assert.ok(!/searchParams|params\./.test(page), "no URL parameter reaches the query");
  assert.ok(!/createAdminClient/.test(page), "the list is never read with the service role");
  assert.ok(!/bookings/.test(strip(page)));
});
await test("the view: shows actions only when allowed and only for open requests (confirm / decline for pending, cancel for pending or confirmed), always posts to the one route, and reports whether the customer was told", () => {
  assert.ok(/canAct && open/.test(view) && /row\.status === "pending" &&/.test(view) && /row\.status === "confirmed" && \(/.test(view) && /statusUrl\(row\.id\)/.test(view) && /change\("completed"\)/.test(view));
  assert.ok(/const open = row\.status === "pending" \|\| row\.status === "confirmed"/.test(view));
  assert.ok(/u\.notified\[key\]/.test(view) && /window_closed/.test(view));
  assert.ok(/body\.unchanged/.test(view) && /u\.alreadyDone/.test(view), "a no-op shows no notification claim");
  assert.ok(/\(row\.status === "confirmed" \|\| row\.status === "declined" \|\| row\.status === "cancelled"\) &&/.test(view), "the stored outcome is shown only for statuses the customer is told about (never pending or completed)");
  assert.ok(!/fetch\((?!statusUrl)/.test(view) && !/wa\.me\/\$\{(?!row\.customer_phone)/.test(view));
  assert.ok(/rel="noopener noreferrer"/.test(view) && /timeZone: "Africa\/Douala"/.test(view));
});
await test("the Inbox shows the Appointments link to the owner AND to team members, while the existing owner-only links stay owner-only", () => {
  const iv = raw("src/components/inbox/InboxView.tsx");
  const link = iv.indexOf("/appointments"), owner = iv.indexOf('access.kind === "owner" && (');
  assert.ok(link > 0 && owner > link, "the appointments link comes before (outside) the owner-only block");
  assert.ok(/\{u\.appointmentsLink\}/.test(iv) && /sales-bot`\}/.test(iv.slice(owner)) && /settings`\}/.test(iv.slice(owner)));
});

// ============================================================ dictionaries
const keysOf = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? keysOf(v, `${p}${k}.`) : [`${p}${k}`]));
await test("English and French have exactly the same keys for the bot's meeting-request copy and for the dashboard page copy, every string non-empty", () => {
  const botKeys = Object.keys(EN).filter((k) => /^appt|^meetingInfo$/.test(k));
  assert.ok(botKeys.length >= 14, "the meeting-request keys exist");
  for (const k of botKeys) { assert.ok(k in FR, "FR has " + k); assert.strictEqual(typeof EN[k], typeof FR[k], k); if (typeof EN[k] === "string") assert.ok(EN[k].trim() && FR[k].trim() && EN[k] !== FR[k], k); }
  assert.deepStrictEqual(keysOf(translations.en.inbox.appointments), keysOf(translations.fr.inbox.appointments));
  for (const k of keysOf(translations.en.inbox.appointments)) { const get = (o) => k.split(".").reduce((a, b) => a[b], o); assert.ok(String(get(translations.en.inbox.appointments)).trim() && String(get(translations.fr.inbox.appointments)).trim(), k); }
  assert.ok(translations.en.inbox.appointmentsLink && translations.fr.inbox.appointmentsLink && translations.en.inbox.appointmentsLink !== translations.fr.inbox.appointmentsLink);
});
await test("the dashboard copy says what is true: pending until someone decides, nothing here activates a card or records a payment, a closed chat window means contact the customer yourself", () => {
  const D = translations.en.inbox.appointments, F = translations.fr.inbox.appointments;
  assert.ok(/pending/i.test(D.intro) && /Nothing here activates a card or records a payment/.test(D.intro) && /Rien ici n’active une carte ni n’enregistre un paiement/.test(F.intro));
  assert.ok(/contact them yourself/.test(D.notified.window_closed) && /contacter vous-même/.test(F.notified.window_closed) && /contact them yourself/.test(D.notified.failed));
  assert.ok(/inbox|reply/i.test(D.viewOnly) && Object.keys(D.groups).join() === "pending,confirmed,declined,cancelled,completed" && Object.keys(F.groups).join() === "pending,confirmed,declined,cancelled,completed");
});

// ============================================================ scope: nothing else was touched
await test("no payment, signup, order, Fapshi, booking, sender, webhook or permission code is referenced by the new application files", () => {
  for (const f of [route, page, view, lib, raw("src/lib/salesBot/runner.ts").slice(raw("src/lib/salesBot/runner.ts").indexOf("recordAppointmentNotice"), raw("src/lib/salesBot/runner.ts").indexOf("recordAppointmentNotice") + 1800)]) {
    assert.ok(!/fapshi|signupPayment|computeSignupAmount|confirmSignupPayment|supabase\.from\("bookings"\)|from\("bookings"\)|signup_requests/i.test(strip(f)));
  }
});

if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} FAILED`); process.exit(1); }
console.log(`cardAppointments: ${passed} passed`);
