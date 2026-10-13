import { translations } from "@/lib/i18n/translations";
import { sendReply, type SendDeps, type SendResult } from "@/lib/inbox/send";
import { computeSignupAmount } from "@/lib/signupPayment";
import { groupNum, subscriptionLine, type Lang } from "./machine";
import { resolveSmartCardOffers } from "./offers";
import { replyRequestId } from "./ids";

// The additive hook behind "payment confirmed": src/lib/signupPayment.ts calls this ONCE, right after the existing payment code has recorded a signup request as paid.
// It never decides whether anything was paid and never changes a payment, a price or a request. If the request came from the WhatsApp sales bot, it tells that
// customer, in their language, through the audited Inbox text sender.
//
// WhatsApp rule: a free-form message is only allowed inside the 24-hour customer-service window. A Mobile Money approval can come later than that; then the sender answers
// `window_closed`, the confirmation is NOT sent, and this is logged ("template_required"). Sending it anyway would need an approved message template, which is not built.
// The payment itself is unaffected, and the Ringo admins are told by the existing payment notifications as before.

const log = (entry: Record<string, unknown>) => console.info(JSON.stringify({ scope: "sales_bot_payment", ...entry }));

export interface PaymentNoticeDeps {
  send?: (deps: SendDeps, input: Parameters<typeof sendReply>[1]) => Promise<SendResult>;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Injectable only so tests can fix the receipt date. */
  now?: Date;
}

export async function notifyWhatsAppOrderPaid(admin: any, signupRequestId: string, deps: PaymentNoticeDeps = {}): Promise<{ result: string }> {
  try {
    const ctxRes = await admin.rpc("wa_sales_payment_context", { p_signup_request_id: signupRequestId });
    if (ctxRes.error) { log({ result: "context_failed", code: String(ctxRes.error.code || "rpc_error").slice(0, 20) }); return { result: "context_failed" }; }
    const ctx = (ctxRes.data && typeof ctxRes.data === "object" ? ctxRes.data : {}) as Record<string, unknown>;
    if (ctx.result !== "ok") return { result: "not_from_bot" };
    // A person has taken the conversation over: they own what is said there.
    if (ctx.handoff === true) { log({ result: "skipped_handoff" }); return { result: "skipped_handoff" }; }

    const lang: Lang = ctx.lang === "fr" ? "fr" : "en";
    const T = translations[lang].inbox.salesBot;
    const { data: row } = await admin.from("signup_requests").select("full_name, pending_fapshi_trans_id, requested_plan_id, requested_interval, requested_addon_ids").eq("id", signupRequestId).maybeSingle();
    const owed = row ? await computeSignupAmount(admin, row) : null;
    if (!owed || !owed.ok) { log({ result: "amount_unavailable" }); return { result: "amount_unavailable" }; }

    const tier = ctx.tier === "pro" || ctx.tier === "premium" ? ctx.tier : "standard";
    // The receipt: the reference, the date (Douala time), what was bought and what was paid, all from the stored order and the add-on configuration. Pure text in the same message.
    let included = "";
    try {
      const offer = (await resolveSmartCardOffers(admin)).offers.find((o) => o.tier === tier);
      if (offer) included = subscriptionLine(lang, offer);
    } catch {
      included = "";
    }
    const when = new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { timeZone: "Africa/Douala", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(deps.now ?? new Date());
    const text = T.receipt({
      ref: `RC-${signupRequestId.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      date: when,
      name: String(row?.full_name || "").slice(0, 80),
      label: T.tierLabel[tier],
      included,
      amount: T.price(groupNum(owed.amount, T.thousandsSep)),
      transId: typeof row?.pending_fapshi_trans_id === "string" && row.pending_fapshi_trans_id ? row.pending_fapshi_trans_id.slice(0, 40) : null,
    });
    const sender = deps.send ?? sendReply;
    const sent = await sender({ admin, fetchImpl: deps.fetchImpl, env: deps.env }, {
      userId: String(ctx.owner_user_id || ""),
      conversationId: ctx.conversation_id,
      clientRequestId: replyRequestId("payment", signupRequestId, "paid"),
      text,
    });
    if (!sent.body.ok && sent.body.error === "window_closed") { log({ result: "template_required" }); return { result: "template_required" }; }
    log({ result: sent.body.ok ? "sent" : "send_failed", status: sent.status });
    return { result: sent.body.ok ? "sent" : "send_failed" };
  } catch {
    log({ result: "exception" });
    return { result: "exception" };
  }
}
