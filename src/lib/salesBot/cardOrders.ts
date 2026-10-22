import { translations } from "@/lib/i18n/translations";
import { isUuid } from "@/lib/inbox/format";
import { sendReply, type SendDeps, type SendResult } from "@/lib/inbox/send";
import { replyRequestId } from "./ids";
import type { ChangeDeps, NotifyOutcome } from "./appointments";

// Mark a paid card order (a customer who paid through the WhatsApp sales bot) as completed once the card was delivered, for the owner or a team member the database admits.
// Same order of things as the appointments (appointments.ts):
//   1. the order is looked up ONLY to learn which conversation it belongs to (card_order_locate); nothing about it is returned to the caller
//   2. that conversation authorizes the signed-in user (owner, or a team member holding inbox.reply: the database decides, never the browser)
//   3. card_order_set_status re-checks the same permission inside the database, locks the row, enforces the transition (paid -> completed) and writes the audit event
//   4. ONLY AFTER that succeeded is the customer thanked, through the existing audited Inbox sender (a team member's message is attributed to them), inside the 24-hour window;
//      what really happened (sent / window closed / failed) is stored and returned, so the page never claims the customer was thanked when they were not
// It never touches a signup request, a payment, a price, a plan or a subscription: an order here is only a record that the existing payment code already marked as paid.

export type CardOrderTarget = "completed";
export type ChangeResult = { status: number; body: { ok: true; state: string; notified: NotifyOutcome | "none"; unchanged?: true } | { ok: false; error: "invalid" | "forbidden" | "not_found" | "invalid_transition" | "server_error" } };

const log = (entry: Record<string, unknown>) => console.info(JSON.stringify({ scope: "card_orders", ...entry }));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const fail = (status: number, error: Exclude<ChangeResult["body"], { ok: true }>["error"]): ChangeResult => ({ status, body: { ok: false, error } });

async function rpc(admin: ChangeDeps["admin"], fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; code: string }> {
  try {
    const res = await admin.rpc(fn, args);
    if (res.error) return { ok: false, code: String(res.error.code || "rpc_error").slice(0, 20) };
    return { ok: true, data: res.data };
  } catch {
    return { ok: false, code: "rpc_exception" };
  }
}

export async function changeCardOrderStatus(deps: ChangeDeps, input: { orderId: unknown; to: unknown; details?: unknown }): Promise<ChangeResult> {
  if (!isUuid(input.orderId)) return fail(404, "not_found");
  const orderId = String(input.orderId);
  if (input.to !== "completed") return fail(422, "invalid");
  let details: string | null = null;
  if (input.details !== undefined && input.details !== null) {
    if (typeof input.details !== "string") return fail(422, "invalid");
    details = input.details.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() || null;
    if (details && details.length > 300) return fail(422, "invalid");
  }

  // 1. which conversation does it belong to (nothing else is read or returned)
  const located = await rpc(deps.admin, "card_order_locate", { p_order_id: orderId });
  if (!located.ok) { log({ result: "locate_failed", code: located.code }); return fail(500, "server_error"); }
  const loc = obj(located.data);
  if (loc.result !== "ok" || !isUuid(loc.conversation_id)) return fail(404, "not_found");
  const conversationId = String(loc.conversation_id);

  // 2. the owner of that conversation's organization, or a team member with inbox.reply (decided by the database)
  const guard = await deps.guard(conversationId, "inbox.reply");
  if (!guard.ok) return guard.error === "forbidden" ? fail(403, "forbidden") : guard.status >= 500 ? fail(500, "server_error") : fail(404, "not_found");

  // 3. the change itself: permission re-checked, row locked, transition rule, audit event
  const changed = await rpc(deps.admin, "card_order_set_status", { p_actor_user_id: guard.userId, p_order_id: orderId, p_to: "completed", p_details: details });
  if (!changed.ok) { log({ result: "set_status_failed", code: changed.code }); return fail(500, "server_error"); }
  const c = obj(changed.data);
  switch (c.result) {
    case "ok": break;
    case "noop": return { status: 200, body: { ok: true, state: "completed", notified: "none", unchanged: true } };
    case "forbidden": return fail(403, "forbidden");
    case "invalid_transition": return fail(409, "invalid_transition");
    case "invalid": return fail(422, "invalid");
    default: return fail(404, "not_found");
  }

  // 4. only now is the customer thanked, and what really happened is recorded
  const lang = c.lang === "fr" ? "fr" : "en";
  const text = translations[lang].inbox.salesBot.orderThanks;
  let outcome: NotifyOutcome = "failed";
  try {
    const sender = deps.send ?? sendReply;
    const r: SendResult = await sender({ admin: guard.admin, fetchImpl: deps.fetchImpl, env: deps.env } as SendDeps, { userId: guard.userId, conversationId, clientRequestId: replyRequestId("order", orderId, "completed"), text });
    outcome = r.body.ok && r.status === 200 ? "sent" : !r.body.ok && r.body.error === "window_closed" ? "window_closed" : "failed";
  } catch {
    outcome = "failed";
  }
  const recorded = await rpc(deps.admin, "card_order_record_notify", { p_actor_user_id: guard.userId, p_order_id: orderId, p_outcome: outcome });
  if (!recorded.ok || recorded.data !== "ok") log({ result: "notify_record_failed", code: recorded.ok ? String(recorded.data).slice(0, 20) : recorded.code });
  log({ result: "status_changed", to: "completed", notified: outcome });
  return { status: 200, body: { ok: true, state: "completed", notified: outcome } };
}

/**
 * The payment-confirmed hook (paymentNotice.ts) calls this ONCE per paid signup request that came from the WhatsApp sales bot: it files the order in the "paid orders" list.
 * Everything about the conversation, the organization, the WhatsApp number, the card and the language is derived by the database from the linked sales-bot session; only the name, the
 * delivery place and the amount (all read from the stored signup request / recomputed by the existing payment code) are passed. A repeat is harmless (one row per signup request).
 * It never decides or changes a payment. Failures are swallowed and logged by category only, so the receipt and everything else keep working.
 */
export async function recordPaidCardOrder(admin: { rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string } | null }> }, input: { signupRequestId: string; name: string; place: string | null; amountXaf: number | null }): Promise<{ result: string }> {
  const res = await rpc(admin, "card_order_record_paid", { p_signup_request_id: input.signupRequestId, p_name: input.name, p_place: input.place, p_amount: input.amountXaf });
  if (!res.ok) { log({ result: "record_failed", code: res.code }); return { result: "record_failed" }; }
  const r = String(obj(res.data).result || "").slice(0, 20);
  log({ result: `record_${r || "unknown"}` });
  return { result: r || "unknown" };
}
