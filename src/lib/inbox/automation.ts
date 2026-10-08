import crypto from "crypto";
import { translations } from "@/lib/i18n/translations";
import type { RpcClient } from "@/lib/whatsapp/ingest";
import { sendReply, type SendDeps, type SendResult } from "@/lib/inbox/send";

// Inbox automation, server side. Conservative by construction:
//   * every DECISION is made by the database (inbox_automation_inbound / _failed / inbox_claim_follow_ups): settings, business hours, the atomic
//     12-hour acknowledgement claim, "is this really a new conversation", "was there a human reply". This module only ACTS on the answer.
//   * the only message ever sent to a customer is the owner's own acknowledgement text, through the existing audited text sender (sendReply):
//     same ownership check, 24-hour window check, idempotency and "unknown outcome is never re-sent" rules as a human reply.
//   * everything else is an in-app notification to the OWNER (reusing the existing notifications table). No email, no AI. The one push is
//     pushForInbound below: a generic, throttled "new message" push for every stored inbound message.
//   * nothing here can block or fail the webhook: callers wrap it, and every step swallows its own errors after logging a category.
// Logs carry ids, categories and counts only: never message text, names, numbers, the token or database error text.

export interface NotifyInput { type: string; title: string; body?: string | null; link?: string | null }
/** What a push carries: a category, generic text and the conversation URL. Never message text, a name, a number or an id other than the one inside the URL. */
export interface InboxPushPayload { category: string; title: string; body: string; url: string }
/** `bell: false` = push only (the in-app notice for this message was already raised). The webhook wires this to src/lib/push/withBell.ts and send.ts. */
export type InboxPushSender = (userId: string, payload: InboxPushPayload, opts: { bell: boolean }) => Promise<void>;
export interface AutomationDeps {
  admin: RpcClient;
  notify: (userId: string, input: NotifyInput) => Promise<void>;
  push?: InboxPushSender;
  send?: (deps: SendDeps, input: Parameters<typeof sendReply>[1]) => Promise<SendResult>;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

const log = (entry: Record<string, unknown>) => console.info(JSON.stringify({ scope: "inbox_automation", ...entry }));
const isLocale = (v: unknown): v is "en" | "fr" => v === "en" || v === "fr";
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

async function rpc(admin: RpcClient, fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; code: string }> {
  try {
    const res = await admin.rpc(fn, args);
    if (res.error) return { ok: false, code: String(res.error.code || "rpc_error").slice(0, 20) };
    return { ok: true, data: res.data };
  } catch {
    return { ok: false, code: "rpc_exception" };
  }
}

/** The acknowledgement's idempotency key: the same inbound message always maps to the same request id (a retry can never send twice). */
export function ackRequestId(phoneNumberId: string, messageId: string): string {
  const h = crypto.createHash("sha256").update(`inbox-ack:${phoneNumberId}:${messageId}`).digest();
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const clip = (s: string | null | undefined, max: number): string => {
  const one = (s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(one).length > max ? `${Array.from(one).slice(0, max - 1).join("")}…` : one;
};
const link = (conversationId: string) => `/dashboard/inbox/${conversationId}`;

export interface InboundReport { ack: "none" | "sent" | "attempted"; notified: boolean; push: "none" | "sent" | "throttled" | "failed" }

/** A push may never hold the webhook answer up: Meta retries a slow delivery, and every message is already stored by now. */
export const PUSH_TIMEOUT_MS = 4000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (err) => { clearTimeout(t); reject(err); });
  });
}

/**
 * Push for EVERY newly stored inbound message (not only the first of a conversation), at most one per conversation per 60 seconds. The database decides
 * both who to tell (the owner derived from the phone number's account, never from the request) and whether the 60-second slot is free
 * (inbox_push_claim, one atomic upsert). The payload is generic on purpose: no message text and no customer name reach the push service.
 * Best effort: a missing function, a database error, a failed or slow push is logged by category and never changes the webhook answer.
 */
async function pushForInbound(deps: AutomationDeps, e: { phoneNumberId: string; messageId: string }, bellAlreadyRaised: boolean): Promise<InboundReport["push"]> {
  if (!deps.push) return "none";
  const claim = await rpc(deps.admin, "inbox_push_claim", { p_phone_number_id: e.phoneNumberId, p_provider_message_id: e.messageId });
  if (!claim.ok) {
    log({ result: "push_claim_failed", code: claim.code });
    return "failed";
  }
  const c = obj(claim.data);
  if (c.result === "throttled") {
    log({ result: "push_throttled" });
    return "throttled";
  }
  const userId = str(c.owner_user_id);
  const conversationId = str(c.conversation_id);
  if (c.result !== "ok" || !userId || !conversationId) return "none";
  const n = translations[isLocale(c.locale) ? c.locale : "fr"].inbox.notify;
  try {
    // When the "new conversation" notice just wrote this message's bell row, only the OS push is added: no second bell row for the same message.
    await withTimeout(deps.push(userId, { category: "inbox_new_message", title: n.pushTitle, body: n.pushBody, url: link(conversationId) }, { bell: !bellAlreadyRaised }), PUSH_TIMEOUT_MS);
    log({ result: "push_sent", conversation_id: conversationId });
    return "sent";
  } catch (err) {
    log({ result: "push_failed", reason: err instanceof Error && err.message === "timeout" ? "timeout" : "error" });
    return "failed";
  }
}

/** A NEW inbound customer message was stored. Sends the owner's acknowledgement (when due) and raises the new-conversation notice (when due). */
export async function onInboundMessage(deps: AutomationDeps, e: { phoneNumberId: string; messageId: string }): Promise<InboundReport> {
  const report: InboundReport = { ack: "none", notified: false, push: "none" };
  const ctx = await rpc(deps.admin, "inbox_automation_inbound", { p_phone_number_id: e.phoneNumberId, p_provider_message_id: e.messageId });
  if (!ctx.ok) {
    log({ result: "inbound_failed", code: ctx.code });
    return report;
  }
  const c = obj(ctx.data);
  if (c.result !== "ok") return report;
  const userId = str(c.owner_user_id);
  const conversationId = str(c.conversation_id);
  if (!userId || !conversationId) return report;
  const locale = isLocale(c.locale) ? c.locale : "fr";

  if (typeof c.ack_text === "string" && c.ack_text.trim() !== "") {
    report.ack = "attempted";
    try {
      const send = deps.send ?? sendReply;
      const result = await send({ admin: deps.admin, fetchImpl: deps.fetchImpl, env: deps.env }, {
        userId,
        conversationId,
        clientRequestId: ackRequestId(e.phoneNumberId, e.messageId),
        text: c.ack_text,
      });
      const messageId = (result.body as { message_id?: string }).message_id;
      if (messageId) {
        // Whatever happened to the delivery, this row is the automatic one: it must never count as a human reply.
        const marked = await rpc(deps.admin, "inbox_automation_record_ack", { p_conversation_id: conversationId, p_message_id: messageId });
        if (!marked.ok) log({ result: "record_ack_failed", code: marked.code });
      }
      if (result.body.ok && (result.body.state === "sent" || result.body.state === "delivered" || result.body.state === "read")) report.ack = "sent";
      log({ result: "ack", status: result.status, state: result.body.ok ? result.body.state : result.body.error, conversation_id: conversationId });
    } catch {
      log({ result: "ack_exception", conversation_id: conversationId });
    }
  }

  if (c.notify_new === true) {
    try {
      const n = translations[locale].inbox.notify;
      await deps.notify(userId, { type: "inbox_new_conversation", title: n.newTitle, body: n.newBody(clip(str(c.contact_name), 40) || n.unknownCustomer), link: link(conversationId) });
      report.notified = true;
    } catch {
      log({ result: "notify_exception", kind: "new" });
    }
  }

  try {
    report.push = await pushForInbound(deps, e, report.notified);
  } catch {
    log({ result: "push_exception" });
    report.push = "failed";
  }
  return report;
}

/** A delivery FAILURE was recorded for an outbound message: tell the owner (once, when the message's status really is failed). */
export async function onFailedStatus(deps: AutomationDeps, e: { phoneNumberId: string; messageId: string }): Promise<boolean> {
  const res = await rpc(deps.admin, "inbox_automation_failed", { p_phone_number_id: e.phoneNumberId, p_provider_message_id: e.messageId });
  if (!res.ok) {
    log({ result: "failed_notice_error", code: res.code });
    return false;
  }
  const r = obj(res.data);
  if (r.result !== "notify" || !str(r.owner_user_id) || !str(r.conversation_id)) return false;
  const n = translations[isLocale(r.locale) ? r.locale : "fr"].inbox.notify;
  try {
    await deps.notify(str(r.owner_user_id), { type: "inbox_failed_message", title: n.failedTitle, body: n.failedBody, link: link(str(r.conversation_id)) });
    return true;
  } catch {
    log({ result: "notify_exception", kind: "failed" });
    return false;
  }
}

/** The daily cron: claim the conversations still waiting for a human reply and tell each owner. Sends nothing to any customer. */
export async function runFollowUps(deps: AutomationDeps, limit = 100): Promise<{ claimed: number; notified: number }> {
  const res = await rpc(deps.admin, "inbox_claim_follow_ups", { p_limit: limit });
  if (!res.ok) {
    log({ result: "claim_failed", code: res.code });
    throw new Error("claim_failed");
  }
  const rows = Array.isArray(res.data) ? res.data : [];
  let notified = 0;
  for (const raw of rows) {
    const r = obj(raw);
    const userId = str(r.owner_user_id);
    const conversationId = str(r.conversation_id);
    if (!userId || !conversationId) continue;
    const n = translations[isLocale(r.locale) ? r.locale : "fr"].inbox.notify;
    const name = clip(str(r.contact_name), 40) || n.unknownCustomer;
    try {
      await deps.notify(userId, { type: "inbox_follow_up", title: n.followTitle, body: r.window_open === true ? n.followBodyOpen(name) : n.followBodyClosed(name), link: link(conversationId) });
      notified++;
    } catch {
      log({ result: "notify_exception", kind: "follow_up" });
    }
  }
  log({ result: "follow_ups", claimed: rows.length, notified });
  return { claimed: rows.length, notified };
}

/** Webhook entry point: the events that were just stored as NEW. Never throws. */
export async function runWebhookAutomation(deps: AutomationDeps, created: { kind: "message" | "status"; phoneNumberId: string; messageId: string; status?: string }[]): Promise<void> {
  for (const e of created) {
    try {
      if (e.kind === "message") await onInboundMessage(deps, e);
      else if (e.status === "failed") await onFailedStatus(deps, e);
    } catch {
      log({ result: "event_exception", event: e.kind });
    }
  }
}
