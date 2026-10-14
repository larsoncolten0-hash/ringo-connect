import { translations } from "@/lib/i18n/translations";
import { isUuid } from "@/lib/inbox/format";
import { sendReply, type SendDeps, type SendResult } from "@/lib/inbox/send";
import { replyRequestId } from "./ids";

// Confirm / decline / cancel a card-appointment request (the WhatsApp "Meet a Ringo agent" flow), for the owner or a team member the database admits.
// The order of things is the whole point:
//   1. the appointment is looked up ONLY to learn which conversation it belongs to (card_appt_locate); nothing about it is returned to the caller
//   2. that conversation authorizes the signed-in user (owner, or a team member holding inbox.reply: the database decides, never the browser)
//   3. card_appt_set_status re-checks the same permission inside the database, locks the row, enforces the transitions and writes the audit event
//   4. ONLY AFTER that succeeded is the customer told, through the existing audited Inbox sender (a team member's message is attributed to them), inside the 24-hour window;
//      what really happened (sent / window closed / failed) is stored and returned, so the page never claims the customer was told when they were not
// It never touches an order, a payment, a price, a plan or a subscription: an appointment is only a request.

export type AppointmentTarget = "confirmed" | "declined" | "cancelled" | "completed";
export type NotifyOutcome = "sent" | "window_closed" | "failed";
const TARGETS: readonly string[] = ["confirmed", "declined", "cancelled", "completed"];

export type ServiceClient = { rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string } | null }> };
export type Guard = { ok: true; kind: "owner" | "member"; userId: string; profileId: string | null; admin: SendDeps["admin"] } | { ok: false; status: number; error: string };
export interface ChangeDeps {
  /** The trusted service client (it calls the card_appt_* functions). */
  admin: ServiceClient;
  /** Authorizes the signed-in user against one conversation (the Inbox's own guard). */
  guard: (conversationId: string, permission: string) => Promise<Guard>;
  send?: (deps: SendDeps, input: Parameters<typeof sendReply>[1]) => Promise<SendResult>;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}
/** `unchanged`: the request already had that status (a double click or a retry): nothing was changed, nobody was messaged, and the stored notification outcome was left exactly as it was. */
export type ChangeResult = { status: number; body: { ok: true; state: string; notified: NotifyOutcome | "none"; unchanged?: true } | { ok: false; error: "invalid" | "forbidden" | "not_found" | "invalid_transition" | "server_error" } };

const log = (entry: Record<string, unknown>) => console.info(JSON.stringify({ scope: "card_appointments", ...entry }));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const fail = (status: number, error: Exclude<ChangeResult["body"], { ok: true }>["error"]): ChangeResult => ({ status, body: { ok: false, error } });

async function rpc(admin: ServiceClient, fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; code: string }> {
  try {
    const res = await admin.rpc(fn, args);
    if (res.error) return { ok: false, code: String(res.error.code || "rpc_error").slice(0, 20) };
    return { ok: true, data: res.data };
  } catch {
    return { ok: false, code: "rpc_exception" };
  }
}

export async function changeAppointmentStatus(deps: ChangeDeps, input: { appointmentId: unknown; to: unknown; details?: unknown }): Promise<ChangeResult> {
  if (!isUuid(input.appointmentId)) return fail(404, "not_found");
  const appointmentId = String(input.appointmentId);
  if (typeof input.to !== "string" || !TARGETS.includes(input.to)) return fail(422, "invalid");
  const to = input.to as AppointmentTarget;
  let details: string | null = null;
  if (input.details !== undefined && input.details !== null) {
    if (typeof input.details !== "string") return fail(422, "invalid");
    details = input.details.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() || null;
    if (details && details.length > 300) return fail(422, "invalid");
  }

  // 1. which conversation does it belong to (nothing else is read or returned)
  const located = await rpc(deps.admin, "card_appt_locate", { p_appointment_id: appointmentId });
  if (!located.ok) { log({ result: "locate_failed", code: located.code }); return fail(500, "server_error"); }
  const loc = obj(located.data);
  if (loc.result !== "ok" || !isUuid(loc.conversation_id)) return fail(404, "not_found");
  const conversationId = String(loc.conversation_id);

  // 2. the owner of that conversation's organization, or a team member with inbox.reply (decided by the database)
  const guard = await deps.guard(conversationId, "inbox.reply");
  if (!guard.ok) return guard.error === "forbidden" ? fail(403, "forbidden") : guard.status >= 500 ? fail(500, "server_error") : fail(404, "not_found");

  // 3. the change itself: permission re-checked, row locked, transition rules, audit event
  const changed = await rpc(deps.admin, "card_appt_set_status", { p_actor_user_id: guard.userId, p_appointment_id: appointmentId, p_to: to, p_details: details });
  if (!changed.ok) { log({ result: "set_status_failed", code: changed.code }); return fail(500, "server_error"); }
  const c = obj(changed.data);
  switch (c.result) {
    case "ok": break;
    case "noop": return { status: 200, body: { ok: true, state: to, notified: "none", unchanged: true } };
    case "forbidden": return fail(403, "forbidden");
    case "invalid_transition": return fail(409, "invalid_transition");
    case "invalid": return fail(422, "invalid");
    default: return fail(404, "not_found");
  }

  // Completing a meeting is housekeeping: the customer is not messaged about it. (The database already cleared the previous notification outcome with the change.)
  if (to === "completed") {
    log({ result: "status_changed", to, notified: "none" });
    return { status: 200, body: { ok: true, state: to, notified: "none" } };
  }

  // 4. only now is the customer told, and what really happened is recorded
  const lang = c.lang === "fr" ? "fr" : "en";
  const text = translations[lang].inbox.salesBot.apptDecision(to, details);
  let outcome: NotifyOutcome = "failed";
  try {
    const sender = deps.send ?? sendReply;
    const r = await sender({ admin: guard.admin, fetchImpl: deps.fetchImpl, env: deps.env }, { userId: guard.userId, conversationId, clientRequestId: replyRequestId("appointment", appointmentId, to), text });
    outcome = r.body.ok && r.status === 200 ? "sent" : !r.body.ok && r.body.error === "window_closed" ? "window_closed" : "failed";
  } catch {
    outcome = "failed";
  }
  const recorded = await rpc(deps.admin, "card_appt_record_notify", { p_actor_user_id: guard.userId, p_appointment_id: appointmentId, p_outcome: outcome });
  if (!recorded.ok || recorded.data !== "ok") log({ result: "notify_record_failed", code: recorded.ok ? str(recorded.data).slice(0, 20) : recorded.code });
  log({ result: "status_changed", to, notified: outcome });
  return { status: 200, body: { ok: true, state: to, notified: outcome } };
}
