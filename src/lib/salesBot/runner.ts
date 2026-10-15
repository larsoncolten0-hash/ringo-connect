import { translations } from "@/lib/i18n/translations";
import { replyRequestId } from "./ids";
import { sendReply, type SendDeps, type SendResult } from "@/lib/inbox/send";
import type { InboxPushSender } from "@/lib/inbox/automation";
import { isReservedUsername } from "@/lib/reservedUsernames";
import { getOrgNotificationAudience } from "@/lib/team/notificationAudience";
import { computeSignupAmount, confirmSignupPayment } from "@/lib/signupPayment";
import { POST as createSignupRoute } from "@/app/api/signup-requests/route";
import { POST as paySignupRoute } from "@/app/api/signup-requests/[id]/pay/route";
import { resolveSmartCardOffers, type Offer } from "./offers";
import { step, toStored, fromStored, START_TOKEN, type Facts, type Lang, type Session, type StepResult, type BotState } from "./machine";

// The Smart Card sales bot's side-effect layer. The conversation logic is the pure machine in machine.ts; everything here is plumbing around EXISTING systems:
//   * messages in/out      -> the Inbox: the inbound text was already stored by ingestion; every reply goes through the audited text sender (sendReply: ownership, 24-hour window,
//                             idempotent on client_request_id, an unknown outcome is never re-sent), so the reply is stored in the Inbox like any other outbound message.
//   * the order            -> the EXISTING public endpoint POST /api/signup-requests (the same request the /get-started form makes). Nothing is re-implemented.
//   * the payment          -> the EXISTING public endpoint POST /api/signup-requests/[id]/pay (Fapshi direct pay: the customer approves on their phone). The amount is recomputed
//                             there from the stored add-on, and whether it was paid is decided by the existing Fapshi confirmation, never by anything said in WhatsApp.
//   * the human hand-off   -> the Inbox owner's bell + push (src/lib/push), and the bot goes silent for that conversation until the owner switches it back.
// Failure isolation: callers wrap this; every step here swallows its own errors after logging a category. Logs carry ids and categories only: never message text, names, numbers or tokens.

export interface SalesBotDeps {
  admin: any;
  push?: InboxPushSender;
  send?: (deps: SendDeps, input: Parameters<typeof sendReply>[1]) => Promise<SendResult>;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** The existing signup and payment endpoints; injectable only so tests can observe the exact requests. */
  createSignup?: (req: Request) => Promise<Response>;
  paySignup?: (req: Request, ctx: { params: { id: string } }) => Promise<Response>;
}

const log = (entry: Record<string, unknown>) => console.info(JSON.stringify({ scope: "sales_bot", ...entry }));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isLang = (v: unknown): v is Lang => v === "en" || v === "fr";
const STUCK_AFTER_SECONDS = 120;
const NON_TEXT_HINT = new Set(["image", "audio", "video", "document"]);

async function rpc(admin: any, fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; code: string }> {
  try {
    const res = await admin.rpc(fn, args);
    if (res.error) return { ok: false, code: String(res.error.code || "rpc_error").slice(0, 20) };
    return { ok: true, data: res.data };
  } catch {
    return { ok: false, code: "rpc_exception" };
  }
}

async function totalFor(admin: any, offer: Offer | undefined): Promise<number | null> {
  if (!offer) return null;
  try {
    const owed = await computeSignupAmount(admin, { requested_plan_id: null, requested_interval: "monthly", requested_addon_ids: [offer.addonId] });
    return owed.ok ? owed.amount : null;
  } catch {
    return null;
  }
}

async function usernameStatus(admin: any, text: string): Promise<"ok" | "taken" | "unknown" | undefined> {
  const candidate = text.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (candidate.length < 3) return undefined;
  if (isReservedUsername(candidate)) return "taken";
  try {
    const { data, error } = await admin.from("profiles").select("id").eq("username", candidate).maybeSingle();
    if (error) return "unknown";
    return data ? "taken" : "ok";
  } catch {
    return "unknown";
  }
}

/**
 * The hand-off notice in the owner's in-app bell, written directly so the answer is a fact: true only when the row was really inserted. (The push senders return nothing and swallow their
 * own errors, so a push can never be the proof of anything; it stays a best-effort extra.) Same row shape the shared push + bell helper writes.
 */
async function recordHandoffNotice(admin: any, ownerUserId: string, conversationId: string, T: { handoffNoticeTitle: string; handoffNoticeBody: string }): Promise<boolean> {
  try {
    const { error } = await admin.from("notifications").insert({ audience: "user", user_id: ownerUserId, type: "inbox_handoff", title: T.handoffNoticeTitle, body: T.handoffNoticeBody, link: `/dashboard/inbox/${conversationId}` });
    if (error) { log({ result: "handoff_notice_failed", code: String(error.code || "insert_error").slice(0, 20) }); return false; }
    return true;
  } catch {
    log({ result: "handoff_notice_failed", code: "exception" });
    return false;
  }
}

/**
 * Sends ONE message from the audited Inbox sender as a message with a reply button, WITHOUT touching that sender. The sender builds its usual plain-text request and calls the fetch it is given;
 * this wrapper turns that single request into a WhatsApp reply-button message (body up to 1,024 characters, title up to 20). If WhatsApp definitely refuses the button message (a 4xx that is
 * not the 24-hour window or a rate limit), nothing was sent, so the original plain-text request is made instead and the customer still gets the message. Network errors, timeouts and 5xx answers
 * are passed straight through, so an unknown outcome is never retried and nothing can be sent twice.
 */
export function withReplyButton(base: typeof fetch, button: { id: string; title: string }): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    let message: any = null;
    try { message = JSON.parse(String(init?.body ?? "")); } catch { message = null; }
    const body = message && message.type === "text" && typeof message.text?.body === "string" ? (message.text.body as string) : null;
    if (!body || body.length > 1024 || button.title.length < 1 || button.title.length > 20 || !/^[A-Za-z0-9_-]{1,64}$/.test(button.id)) return base(input, init);
    const withButton = { messaging_product: message.messaging_product, recipient_type: message.recipient_type, to: message.to, type: "interactive", interactive: { type: "button", body: { text: body }, action: { buttons: [{ type: "reply", reply: { id: button.id, title: button.title } }] } } };
    const res = await base(input, { ...init, body: JSON.stringify(withButton) });
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      let code: unknown = null;
      try { code = (await res.clone().json())?.error?.code; } catch { code = null; }
      if (code !== 131047 && code !== 130429 && code !== 80007 && code !== 131056) {
        log({ result: "button_fallback", http_status: res.status, meta_code: typeof code === "number" ? code : null });
        return base(input, init);
      }
    }
    return res;
  }) as typeof fetch;
}

/**
 * The "new meeting request" notice for the team: one in-app bell row for the owner and for every team member who may read the Inbox (inbox.view), written directly so the answer is a fact:
 * true only when the rows were really inserted. The push is a best-effort extra and never changes what the customer is told.
 */
async function recordAppointmentNotice(admin: any, ownerUserId: string, profileId: string, T: { apptNoticeTitle: string; apptNoticeBody: string }): Promise<boolean> {
  const ids = new Set<string>([ownerUserId]);
  try {
    if (profileId) for (const id of await getOrgNotificationAudience(profileId, ["inbox.view"])) ids.add(id);
  } catch {
    // the owner is always told; a failed lookup of the team only means fewer extra recipients
  }
  try {
    const rows = [...ids].map((user_id) => ({ audience: "user", user_id, type: "card_appointment", title: T.apptNoticeTitle, body: T.apptNoticeBody, link: "/dashboard/inbox/appointments" }));
    const { error } = await admin.from("notifications").insert(rows);
    if (error) { log({ result: "appointment_notice_failed", code: String(error.code || "insert_error").slice(0, 20) }); return false; }
    return true;
  } catch {
    log({ result: "appointment_notice_failed", code: "exception" });
    return false;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try { return obj(await res.json()); } catch { return {}; }
}

export type PayOutcome = "sent" | "resumed" | "already_paid" | "rejected" | "unavailable" | "uncertain" | "failed";

/** Asks the EXISTING pay endpoint to send the Mobile Money request. Returns what happened; deciding whether it was paid is not this function's job. */
export async function requestPayment(deps: SalesBotDeps, requestId: string, medium: string, phone: string, forceNew: boolean): Promise<PayOutcome> {
  try {
    const call = deps.paySignup ?? paySignupRoute;
    const res = await call(new Request(`http://internal.local/api/signup-requests/${requestId}/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ medium, phone, forceNew }) }), { params: { id: requestId } });
    const body = await readJson(res);
    if (res.ok) return body.alreadyPaid === true ? "already_paid" : body.resumed === true ? "resumed" : "sent";
    if (body.code === "unavailable") return "unavailable";
    if (body.code === "uncertain" || body.code === "provider_unavailable") return "uncertain";
    if (body.code === "rejected" || body.code === "invalid_phone" || body.code === "invalid_medium") return "rejected";
    return "failed";
  } catch {
    return "failed";
  }
}

async function createOrder(deps: SalesBotDeps, ctx: { waDigits: string }, s: StepResult, offer: Offer): Promise<string | null> {
  try {
    const call = deps.createSignup ?? createSignupRoute;
    const res = await call(new Request("http://internal.local/api/signup-requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        full_name: s.data.name,
        whatsapp_number: `+${ctx.waDigits}`,
        email: s.data.email || null,
        suggested_username: s.data.username || null,
        delivery_location: s.data.address,
        business_note: "Ordered via WhatsApp (Smart Card sales bot)",
        requested_plan_id: null,
        requested_interval: "monthly",
        requested_addon_ids: [offer.addonId],
        // Same as the web form's online-payment path: the admins hear about the request once it is PAID, not the moment it is started.
        pending_online_payment: true,
      }),
    }));
    const body = await readJson(res);
    return res.ok && typeof body.id === "string" && body.id ? body.id : null;
  } catch {
    return null;
  }
}

function payReply(lang: Lang, outcome: PayOutcome, medium: string, phone: string): { text: string; state: BotState } {
  const T = translations[lang].inbox.salesBot;
  const operator = T.operatorName[medium as "mobile money" | "orange money"] ?? medium;
  switch (outcome) {
    case "sent": return { text: T.paymentSent(operator, phone.slice(-3)), state: "PAYMENT" };
    case "resumed": return { text: T.paymentResumed, state: "PAYMENT" };
    case "already_paid": return { text: T.paymentAlready, state: "COMPLETED" };
    case "rejected": return { text: T.paymentRejected, state: "PAYMENT" };
    case "unavailable": return { text: T.paymentUnavailable, state: "PAYMENT" };
    case "uncertain": return { text: T.paymentUncertain, state: "PAYMENT" };
    default: return { text: T.paymentUncertain, state: "PAYMENT" };
  }
}

/**
 * One NEW inbound message in the conversation of the bot's number. Safe to call for any message: it claims the provider message id exactly once (a second call is a no-op),
 * stays silent while a human has taken over, and never throws.
 */
export async function handleSalesBotMessage(deps: SalesBotDeps, e: { phoneNumberId: string; messageId: string }): Promise<{ result: string }> {
  // The owner's switch (second gate, after the environment gate in automation.ts). Asked BEFORE the message is claimed, so an OFF bot neither answers nor consumes it; a read error counts as OFF.
  const gate = await rpc(deps.admin, "wa_sales_enabled", { p_phone_number_id: e.phoneNumberId });
  if (!gate.ok || gate.data !== true) { log({ result: gate.ok ? "switched_off" : "gate_failed", ...(gate.ok ? {} : { code: gate.code }) }); return { result: "off" }; }

  const begun = await rpc(deps.admin, "wa_sales_begin", { p_phone_number_id: e.phoneNumberId, p_provider_message_id: e.messageId });
  if (!begun.ok) {
    log({ result: "begin_failed", code: begun.code });
    return { result: "begin_failed" };
  }
  const b = obj(begun.data);
  if (b.result === "duplicate") { log({ result: "duplicate" }); return { result: "duplicate" }; }
  if (b.result !== "ok") return { result: "skip" };

  const conversationId = str(b.conversation_id);
  const ownerUserId = str(b.owner_user_id);
  const waDigits = str(b.wa_id).replace(/[^0-9]/g, "");
  const raw = obj(b.session);
  // The e-mail step is stored as ASK_ADDRESS plus a flag (see machine.ts toStored / fromStored): the database is not altered for it.
  const restored = fromStored((str(raw.state) || "WELCOME") as BotState, obj(raw.data) as Session["data"]);
  let session: Session = {
    state: restored.state,
    data: restored.data,
    handoff: raw.handoff === true,
    signupRequestId: str(raw.signup_request_id) || null,
    version: Number(raw.version) || 0,
  };
  if (!conversationId || !ownerUserId || !waDigits) return { result: "skip" };

  const sender = deps.send ?? sendReply;
  const sendText = async (text: string, slot: string, button?: { id: string; title: string }) => {
    if (!text.trim()) return;
    try {
      const r = await sender({ admin: deps.admin, fetchImpl: button ? withReplyButton(deps.fetchImpl ?? fetch, button) : deps.fetchImpl, env: deps.env }, { userId: ownerUserId, conversationId, clientRequestId: replyRequestId(e.phoneNumberId, e.messageId, slot), text });
      log({ result: "reply", slot, status: r.status, state: r.body.ok ? r.body.state : r.body.error });
    } catch {
      log({ result: "reply_exception", slot });
    }
  };
  const save = async (state: BotState, d: Session["data"], handoff: boolean, signupRequestId?: string | null): Promise<boolean> => {
    const stored = toStored(state, d);
    const saved = await rpc(deps.admin, "wa_sales_save", { p_conversation_id: conversationId, p_expected_version: session.version, p_state: stored.state, p_data: stored.data, p_handoff: handoff, p_signup_request_id: signupRequestId ?? null });
    if (saved.ok && saved.data === "ok") {
      session = { ...session, state, data: d, handoff: session.handoff || handoff, signupRequestId: signupRequestId ?? session.signupRequestId, version: session.version + 1 };
      return true;
    }
    log({ result: "save_failed", code: saved.ok ? String(saved.data) : saved.code });
    return false;
  };

  // A human has taken over: the bot never speaks (and never changes anything) until the owner switches it back.
  if (session.handoff || session.state === "HUMAN_HANDOFF") { log({ result: "silent_handoff" }); return { result: "handoff_silent" }; }

  const type = str(b.type);
  const text = str(b.text);
  // a brand-new conversation is answered in French first (see step())
  const lang: Lang = isLang(session.data.lang) ? session.data.lang : "fr";
  // A tap on the "Get started" button arrives as an interactive message with no text. It is the only button the bot sends, so it means "start": the machine gets a fixed token, never customer text.
  const tapped = type === "interactive";
  if (type !== "text" && !tapped) {
    // Voice notes, images and documents get one short hint; reactions, stickers and system events get nothing (never a reply loop on an emoji).
    if (NON_TEXT_HINT.has(type)) await sendText(translations[lang].inbox.salesBot.nonText, "nontext");
    return { result: "non_text" };
  }
  const input = tapped ? START_TOKEN : text;

  const resolved = await resolveSmartCardOffers(deps.admin);
  if (resolved.missing.length > 0) log({ result: "offers_incomplete", missing: resolved.missing.join(",") });
  const facts: Facts = { offers: resolved.offers, waDigits, stuck: session.state === "CREATING" && Number(b.age_seconds) > STUCK_AFTER_SECONDS };
  if (session.state === "ASK_USERNAME" && !tapped) facts.usernameStatus = await usernameStatus(deps.admin, text);
  if (session.state === "REVIEW") facts.total = await totalFor(deps.admin, resolved.offers.find((o) => o.tier === session.data.tier));
  // The customer's newest meeting request, only in the screens that need it. A failed lookup leaves it undefined (the machine then says so instead of guessing).
  if (session.state === "MEETING_INFO" || session.state === "WELCOME" || session.state === "APPT_DONE") {
    const ap = await rpc(deps.admin, "card_appt_status", { p_conversation_id: conversationId });
    if (ap.ok) {
      const o = obj(ap.data);
      const status = str(o.status);
      facts.appointment = o.result === "ok" && (status === "pending" || status === "confirmed" || status === "declined" || status === "cancelled" || status === "completed") ? { status, open: o.open === true } : { status: "none", open: false };
    }
  }

  let result = step(session, input, facts);
  // The review shows the authoritative total of the card chosen in THIS step (a change of card or a first review), so look it up and run the same step again.
  if (result.state === "REVIEW" && session.state !== "REVIEW") {
    facts.total = await totalFor(deps.admin, resolved.offers.find((o) => o.tier === result.data.tier));
    result = step(session, input, facts);
  }

  switch (result.effect) {
    case "none": {
      if (!(await save(result.state, result.data, false))) return { result: "save_failed" };
      await sendText(result.reply, "reply", result.button ? { id: "start", title: translations[(result.data.lang ?? "en") as Lang].inbox.salesBot.startButton } : undefined);
      return { result: "replied" };
    }
    case "handoff": {
      // The bot goes silent first (a human is wanted either way). The customer is then told the request was passed on ONLY when the in-app notice was really recorded; otherwise they are told
      // the message is saved but the team could not be alerted. The push is a best-effort extra and never changes what the customer is told.
      if (!(await save("HUMAN_HANDOFF", result.data, true))) return { result: "save_failed" };
      const T = translations[(result.data.lang ?? "en") as Lang].inbox.salesBot;
      const recorded = await recordHandoffNotice(deps.admin, ownerUserId, conversationId, T);
      try {
        await deps.push?.(ownerUserId, { category: "inbox_handoff", title: T.handoffNoticeTitle, body: T.handoffNoticeBody, url: `/dashboard/inbox/${conversationId}` }, { bell: false });
      } catch {
        log({ result: "handoff_push_failed" });
      }
      await sendText(recorded ? result.reply : T.handoffUnconfirmed, "reply");
      return { result: recorded ? "handoff" : "handoff_unconfirmed" };
    }
    case "create_and_pay": {
      const offer = resolved.offers.find((o) => o.tier === result.data.tier);
      const d = result.data;
      // Claim the confirmation first: a second "1" arriving meanwhile sees CREATING and cannot create a second order.
      if (!(await save("CREATING", d, false)) || !offer || !d.medium || !d.payPhone) return { result: "save_failed" };
      const requestId = await createOrder(deps, { waDigits }, result, offer);
      if (!requestId) {
        await save("REVIEW", d, false);
        await sendText(translations[(d.lang ?? "en") as Lang].inbox.salesBot.orderFailed, "reply");
        return { result: "order_failed" };
      }
      await save("CREATING", d, false, requestId);
      const outcome = await requestPayment(deps, requestId, d.medium, d.payPhone, false);
      const reply = payReply((d.lang ?? "en") as Lang, outcome, d.medium, d.payPhone);
      await save(reply.state, d, false);
      await sendText(reply.text, "reply");
      return { result: `order_${outcome}` };
    }
    case "create_appointment": {
      // The meeting request: stored PENDING by the database (which re-validates everything, requires the conversation's own verified WhatsApp number, and ignores a repeat). It touches no order,
      // payment, price or subscription. The customer is told the request was sent, never that it was confirmed, and is told honestly when the team could not be alerted.
      const d = result.data;
      const dlang = (d.lang ?? "en") as Lang;
      const T = translations[dlang].inbox.salesBot;
      // The card the customer chose, with the live price at this moment (a snapshot for the agent and the receipt). Stored by card_appt_create_with_card; if that function is not in the
      // database yet, the request is still saved with the old function and the card is written at the start of the note, so a request is never lost.
      // The tier and price stored are the REVIEWED ones (d.aPrice), never a newer lookup. The machine already refused to send when the live offer differed; this is the second, independent check.
      const live = d.aCard ? resolved.offers.find((o) => o.tier === d.aCard) : undefined;
      if (d.aCard && (!live || typeof d.aPrice !== "number" || live.priceXaf !== d.aPrice)) {
        log({ result: "appointment_price_changed" });
        await sendText(T.apptFailed, "reply");
        return { result: "appointment_price_changed" };
      }
      const chosen = d.aCard && live ? { tier: live.tier, priceXaf: d.aPrice as number } : undefined;
      const base = { p_conversation_id: conversationId, p_name: d.aName ?? "", p_phone: waDigits, p_time: d.aWhen ?? "", p_place: d.aWhere ?? "", p_note: d.aNote ?? null, p_lang: dlang };
      let created = await rpc(deps.admin, "card_appt_create_with_card", { ...base, p_card_tier: chosen ? chosen.tier : null, p_card_price: chosen ? chosen.priceXaf : null });
      if (!created.ok && (created.code === "PGRST202" || created.code === "42883")) {
        const cardNote = chosen ? `Card: ${translations.en.inbox.salesBot.tierLabel[chosen.tier]} ${chosen.priceXaf} FCFA${d.aNote ? `. ${d.aNote}` : ""}`.slice(0, 200) : d.aNote ?? null;
        created = await rpc(deps.admin, "card_appt_create", { ...base, p_note: cardNote });
      }
      const c = created.ok ? obj(created.data) : {};
      if (c.result !== "created" && c.result !== "exists") {
        log({ result: "appointment_failed", code: created.ok ? str(c.result).slice(0, 20) : created.code });
        await sendText(T.apptFailed, "reply");
        return { result: "appointment_failed" };
      }
      let reply = T.apptStatusText(str(c.status));
      let outcome = "appointment_exists";
      if (c.result === "created") {
        const alerted = await recordAppointmentNotice(deps.admin, ownerUserId, str(c.profile_id), T);
        try {
          await deps.push?.(ownerUserId, { category: "card_appointment", title: T.apptNoticeTitle, body: T.apptNoticeBody, url: "/dashboard/inbox/appointments" }, { bell: false });
        } catch {
          log({ result: "appointment_push_failed" });
        }
        reply = alerted ? T.apptSubmitted : T.apptSubmittedUnalerted;
        outcome = alerted ? "appointment_created" : "appointment_created_unalerted";
      }
      const { aCard: _c, aPrice: _q, aName: _n, aWhen: _w, aWhere: _p, aNote: _o, ...kept } = d;
      if (!(await save("APPT_DONE", kept, false))) return { result: "save_failed" };
      await sendText(reply, "reply");
      return { result: outcome };
    }
    case "resend_payment": {
      const d = result.data;
      if (!session.signupRequestId || !d.medium || !d.payPhone) {
        await sendText(translations[(d.lang ?? "en") as Lang].inbox.salesBot.orderFailed, "reply");
        return { result: "resend_unavailable" };
      }
      const outcome = await requestPayment(deps, session.signupRequestId, d.medium, d.payPhone, true);
      const reply = payReply((d.lang ?? "en") as Lang, outcome, d.medium, d.payPhone);
      await save(reply.state, d, false);
      await sendText(reply.text, "reply");
      return { result: `resend_${outcome}` };
    }
    case "check_payment": {
      const T = translations[(result.data.lang ?? "en") as Lang].inbox.salesBot;
      if (!session.signupRequestId) { await sendText(T.statusUnknown, "reply"); return { result: "no_request" }; }
      try {
        const check = await confirmSignupPayment(deps.admin, session.signupRequestId);
        if (check.paid) {
          // When this very check recorded the payment, the payment-confirmed hook already sent the confirmation; do not say it twice.
          if (!check.justPaid) {
            await save("COMPLETED", result.data, false);
            await sendText(T.statusPaid(T.tierLabel[(result.data.tier ?? "standard")]), "reply");
          }
          return { result: "paid" };
        }
        await sendText(T.statusPending, "reply");
        return { result: "pending" };
      } catch {
        await sendText(T.statusUnknown, "reply");
        return { result: "status_unknown" };
      }
    }
  }
  return { result: "done" };
}
