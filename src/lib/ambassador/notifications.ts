// Ambassador Program (Phase G) — push + bell notifications for Ambassadors
// and Team Leaders. Reuses the existing infrastructure exactly
// (sendPushAndBellToUser -> notifications bell row + push_subscriptions),
// never a second notification system.
//
// Ground rules, each enforced below:
//  - Recipients are ALWAYS resolved server-side from authoritative rows:
//    the commission ledger's recipient_user_id (written by the approved SQL
//    functions from the sale's attribution-time team snapshot), the
//    payout's recipient_user_id, or — for the pre-commission "sale
//    confirmed" event — ambassador_sales.team_id (the same historical
//    snapshot). An Ambassador's CURRENT team is never consulted, so a sale
//    stays with the Team Leader it was attributed under after a move.
//  - Callers pass only an id they already hold from a trusted server
//    context (an RPC result / a row they queried); nothing here accepts a
//    recipient, an amount or a status. Amounts are the ledger/payout row's
//    own numbers, formatted only — never calculated.
//  - Recipient-only copy: these functions only ever message the Ambassador
//    or Team Leader. Nothing here can reach a customer, so no earnings
//    figure can leak to one.
//  - Never throws. A failed notification is logged and swallowed, so it can
//    never roll back or fail the payment/registration/activation/commission
//    event that triggered it.
//  - De-duplicated per (role, recipient, category, event) by a DATABASE claim,
//    claim-first: ambassador_claim_notification() inserts the event key into a
//    table whose primary key admits exactly one winner, and the existing
//    sendPushAndBellToUser() is called ONLY by that winner. Concurrent callers,
//    repeated milestone evaluations, cron sweeps and retried hooks therefore
//    cannot produce a second copy. This is NOT an exactly-once DELIVERY
//    guarantee: sendPushAndBellToUser swallows delivery errors, so a claimed
//    event whose send fails is not re-sent (at-most-once is deliberate — a
//    duplicate money message is worse than a missed one), and push services
//    may themselves retry or drop.
//    Degraded mode: if the claim function is unavailable (e.g. the migration
//    isn't applied yet) it falls back to the older best-effort check of the
//    recipient's bell rows, and says so in the log. That fallback is NOT
//    race-safe; it exists only so notifications keep flowing during rollout.
import { sendPushAndBellToUser, sendPushAndBellToAdmins } from "@/lib/push/withBell";
import { formatPrice } from "@/lib/currency";
import { translations, type Locale } from "@/lib/i18n/translations";

type Role = "ambassador" | "team_leader";
type CopyKey = "saleConfirmed" | "registrationCompleted" | "activationCompleted" | "payoutRequested" | "payoutProcessing" | "payoutPaid" | "payoutFailed" | "commissionReversed" | "destinationChanged";

export type AmbassadorPayoutEvent = "requested" | "processing" | "paid" | "failed" | "rejected";

const DASHBOARD_PATH: Record<Role, string> = { ambassador: "/dashboard/ambassador", team_leader: "/dashboard/sales-team" };
const COPY_GROUP: Record<Role, "ambassador" | "teamLeader"> = { ambassador: "ambassador", team_leader: "teamLeader" };
const PAYOUT_COPY: Record<AmbassadorPayoutEvent, CopyKey> = {
  requested: "payoutRequested",
  processing: "payoutProcessing",
  paid: "payoutPaid",
  failed: "payoutFailed",
  rejected: "payoutFailed", // a management rejection reads the same to the recipient: "could not be completed"
};

// Creator accounts have no stored language preference (the UI language
// lives only in the browser's localStorage), so there is nothing
// server-side to read. French is the app-wide default for the primary
// audience (see LanguageProvider). Kept as one function so a stored
// preference can be plugged in later without touching any call site.
function recipientLocale(_userId: string): Locale {
  return "fr";
}

interface Delivery {
  userId: string | null | undefined;
  role: Role;
  copyKey: CopyKey;
  category: string;
  eventKey: string;
  amount?: { value: number | string; currency: string };
}

/** Claim-first de-duplication. "won" = this caller alone may send;
 *  "duplicate" = someone already claimed it; "unavailable" = the claim
 *  function could not be used (degraded mode, see the module header). */
async function claimNotification(admin: any, userId: string, category: string, dedupeKey: string): Promise<"won" | "duplicate" | "unavailable"> {
  try {
    const { data, error } = await admin.rpc("ambassador_claim_notification", { p_user_id: userId, p_category: category, p_dedupe_key: dedupeKey });
    if (error || data?.ok !== true || typeof data.claimed !== "boolean") {
      console.error("ambassador_claim_notification unavailable — using the non-atomic fallback:", error?.message || "unexpected result");
      return "unavailable";
    }
    return data.claimed ? "won" : "duplicate";
  } catch (err: any) {
    console.error("ambassador_claim_notification threw — using the non-atomic fallback:", err?.message);
    return "unavailable";
  }
}

async function deliver(admin: any, d: Delivery): Promise<void> {
  try {
    if (!d.userId) return;
    const url = `${DASHBOARD_PATH[d.role]}#n-${d.eventKey}`;

    // Claim FIRST; only the winner sends. The role is part of the key because
    // one person can hold both roles, and each gets its own notification.
    const claim = await claimNotification(admin, d.userId, d.category, `${d.role}:${d.userId}:${d.category}:${d.eventKey}`);
    if (claim === "duplicate") return;
    if (claim === "unavailable") {
      // Degraded, non-atomic fallback: the exact event key in the recipient's bell rows.
      const { data: existing } = await admin.from("notifications").select("id").eq("user_id", d.userId).eq("type", d.category).eq("link", url).limit(1);
      if (existing && existing.length > 0) return;
    }

    const locale = recipientLocale(d.userId);
    const copy = (translations[locale].ambassadorNotifications[COPY_GROUP[d.role]] as Record<string, { title: string; body: string | ((amount: string) => string) }>)[d.copyKey];
    const body = typeof copy.body === "function" ? copy.body(d.amount ? formatPrice(d.amount.value, d.amount.currency, locale) : "") : copy.body;

    await sendPushAndBellToUser(admin, d.userId, { category: d.category, title: copy.title, body, url, data: { kind: d.category } });
  } catch (err) {
    console.error(`ambassador notification failed (${d.category}, ${d.eventKey}):`, err);
  }
}

/** Payment confirmed for an attributed sale — Ambassador, plus the Team
 *  Leader recorded on the sale itself (historical snapshot). */
export async function notifySaleConfirmed(admin: any, saleId: string | null | undefined): Promise<void> {
  try {
    if (!saleId) return;
    const { data: sale } = await admin.from("ambassador_sales").select("id, ambassador_id, team_id").eq("id", saleId).maybeSingle();
    if (!sale) return;

    const { data: ambassador } = await admin.from("ambassador_profiles").select("user_id").eq("id", sale.ambassador_id).maybeSingle();
    let leaderUserId: string | null = null;
    if (sale.team_id) {
      const { data: team } = await admin.from("ambassador_teams").select("team_leader_user_id").eq("id", sale.team_id).maybeSingle();
      leaderUserId = team?.team_leader_user_id ?? null;
    }

    await deliver(admin, { userId: ambassador?.user_id, role: "ambassador", copyKey: "saleConfirmed", category: "ambassador_sale_confirmed", eventKey: `sale-${sale.id}` });
    await deliver(admin, { userId: leaderUserId, role: "team_leader", copyKey: "saleConfirmed", category: "ambassador_sale_confirmed", eventKey: `sale-${sale.id}` });
  } catch (err) {
    console.error("notifySaleConfirmed failed:", err);
  }
}

/** A commission milestone was just earned. Recipients are exactly the
 *  ledger rows the approved SQL function created for this sale+milestone
 *  (no Team Leader row exists when the sale had no team at attribution
 *  time, so none is notified). Milestone 1 doubles as "customer
 *  registration completed" — they are one event in the existing flow. */
export async function notifyMilestoneEarned(admin: any, saleId: string | null | undefined, milestone: "sale_registration" | "activation"): Promise<void> {
  try {
    if (!saleId) return;
    const { data: rows } = await admin
      .from("ambassador_commission_ledger")
      .select("id, recipient_type, recipient_user_id, commission_amount, currency")
      .eq("sale_id", saleId)
      .eq("milestone", milestone)
      .eq("entry_type", "commission");

    for (const row of rows || []) {
      if (row.recipient_type !== "ambassador" && row.recipient_type !== "team_leader") continue;
      await deliver(admin, {
        userId: row.recipient_user_id,
        role: row.recipient_type,
        copyKey: milestone === "sale_registration" ? "registrationCompleted" : "activationCompleted",
        category: milestone === "sale_registration" ? "ambassador_registration_completed" : "ambassador_activation_completed",
        eventKey: `${milestone}-${row.id}`,
        amount: { value: row.commission_amount, currency: row.currency },
      });
    }
  } catch (err) {
    console.error("notifyMilestoneEarned failed:", err);
  }
}

/** A payout changed status. Recipient and amount come from the payout row.
 *  No call site exists yet — payout requesting/processing arrives in Phase H,
 *  which should call this right after each successful status change. */
export async function notifyPayoutStatus(admin: any, payoutId: string | null | undefined, event: AmbassadorPayoutEvent): Promise<void> {
  try {
    if (!payoutId) return;
    const { data: payout } = await admin.from("ambassador_payouts").select("id, recipient_type, recipient_user_id, amount, currency, disbursement_attempts").eq("id", payoutId).maybeSingle();
    if (!payout || (payout.recipient_type !== "ambassador" && payout.recipient_type !== "team_leader")) return;

    // A payout can legitimately be sent, fail, and be sent again; scoping the
    // key to the attempt number lets each real attempt notify once while a
    // repeat of the same attempt stays a duplicate.
    const attempt = event === "processing" || event === "failed" ? `-a${Number(payout.disbursement_attempts) || 0}` : "";
    await deliver(admin, {
      userId: payout.recipient_user_id,
      role: payout.recipient_type,
      copyKey: PAYOUT_COPY[event],
      category: `ambassador_payout_${event}`,
      eventKey: `payout-${event}-${payout.id}${attempt}`,
      amount: { value: payout.amount, currency: payout.currency },
    });
  } catch (err) {
    console.error("notifyPayoutStatus failed:", err);
  }
}

/** A commission was reversed. `ledgerId` is the ORIGINAL commission row
 *  (ambassador_reverse_commission's argument); the recipient is that
 *  row's own recipient, so an Ambassador's and a Team Leader's rows are
 *  notified separately. No call site exists yet (Phase H / admin reversal). */
export async function notifyCommissionReversed(admin: any, ledgerId: string | null | undefined): Promise<void> {
  try {
    if (!ledgerId) return;
    const { data: row } = await admin
      .from("ambassador_commission_ledger")
      .select("id, recipient_type, recipient_user_id, commission_amount, currency, entry_type, reversed_ledger_id")
      .eq("id", ledgerId)
      .maybeSingle();
    if (!row || (row.recipient_type !== "ambassador" && row.recipient_type !== "team_leader")) return;

    // Key on the original commission either way, so passing the recovery
    // row's id can never double-notify the same reversal.
    const originalId = row.entry_type === "reversal" && row.reversed_ledger_id ? row.reversed_ledger_id : row.id;
    await deliver(admin, {
      userId: row.recipient_user_id,
      role: row.recipient_type,
      copyKey: "commissionReversed",
      category: "ambassador_commission_reversed",
      eventKey: `reversal-${originalId}`,
      amount: { value: Math.abs(Number(row.commission_amount)), currency: row.currency },
    });
  } catch (err) {
    console.error("notifyCommissionReversed failed:", err);
  }
}

/** Management is told a payout was requested. Admin-audience bell row + push
 *  via the existing sendPushAndBellToAdmins. Amount/role come from the payout
 *  row. Not deduplicated (a payout is requested exactly once by the RPC that
 *  creates it, and this is called only from that single success path). */
export async function notifyAdminsOfPayoutRequest(admin: any, payoutId: string | null | undefined): Promise<void> {
  try {
    if (!payoutId) return;
    const { data: payout } = await admin.from("ambassador_payouts").select("id, recipient_type, amount, currency").eq("id", payoutId).maybeSingle();
    if (!payout) return;
    const locale = recipientLocale("admin");
    const copy = translations[locale].ambassadorNotifications.admin.payoutRequested;
    const who = payout.recipient_type === "team_leader" ? copy.whoTeamLeader : copy.whoAmbassador;
    await sendPushAndBellToAdmins(admin, {
      category: "ambassador_payout_requested_admin",
      title: copy.title,
      body: copy.body(formatPrice(payout.amount, payout.currency, locale), who),
      url: "/admin/ambassadors",
    });
  } catch (err) {
    console.error("notifyAdminsOfPayoutRequest failed:", err);
  }
}

/** The owner's payout destination was changed (not merely re-saved): tell them,
 *  so a takeover redirecting payouts is noticed inside the 24-hour cooldown.
 *  Carries no destination detail at all — not even the masked label — so the
 *  notification itself can never leak it. `changeKey` (the change's own
 *  timestamp) keeps two different changes distinct and one change unique. */
export async function notifyPayoutDestinationChanged(admin: any, userId: string | null | undefined, role: "ambassador" | "team_leader", changeKey: string): Promise<void> {
  try {
    if (!userId) return;
    await deliver(admin, {
      userId,
      role,
      copyKey: "destinationChanged",
      category: "ambassador_payout_destination_changed",
      eventKey: `destination-${changeKey.replace(/[^0-9A-Za-z]/g, "")}`,
    });
  } catch (err) {
    console.error("notifyPayoutDestinationChanged failed:", err);
  }
}
