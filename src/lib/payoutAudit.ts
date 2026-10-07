// Audit + owner notification for the payout events the post-audit review found invisible:
//   * a change of the payout destination shared by the affiliate, music and shop payouts (users.affiliate_payout_method / affiliate_payout_details)
//   * an admin payout send that failed
//   * a payout request the database refused because it asked for more than the earner's available balance
// Everything here is metadata only: ids, a program name, a failure CATEGORY, the destination METHOD (mobile_money / paypal / bank). Never a phone number, an email, an
// account number, a provider message or payload. Never throws; none of it changes the answer to the request it describes.
import { recordAudit } from "@/lib/adminAudit";
import { sendPushAndBellToUser } from "@/lib/push/withBell";
import { translations } from "@/lib/i18n/translations";

export type PayoutProgram = "affiliate" | "music" | "shop";
export type DestinationChange = "added" | "changed" | "removed" | "unchanged";
type Destination = { method?: string | null; details?: unknown } | null | undefined;

const SHARED_PROGRAMS: PayoutProgram[] = ["affiliate", "music", "shop"];

function normalizeDetails(details: unknown): string {
  if (!details || typeof details !== "object") return "";
  const o = details as Record<string, unknown>;
  return JSON.stringify(Object.keys(o).sort().map((k) => [k, typeof o[k] === "string" ? (o[k] as string).trim() : o[k]]));
}

/** Pure: what happened to the destination. Re-saving the same destination is "unchanged" (no audit row, no notification). */
export function classifyDestinationChange(previous: Destination, next: Destination): DestinationChange {
  const had = !!previous?.method;
  const has = !!next?.method;
  if (!had && !has) return "unchanged";
  if (!had) return "added";
  if (!has) return "removed";
  return previous!.method === next!.method && normalizeDetails(previous!.details) === normalizeDetails(next!.details) ? "unchanged" : "changed";
}

/** Writes one audit row and tells the owner. Returns the classification. Carries no destination value, not even a masked one. */
export async function recordPayoutDestinationChange(admin: any, params: { userId: string; previous: Destination; next: Destination }): Promise<DestinationChange> {
  const change = classifyDestinationChange(params.previous, params.next);
  if (change === "unchanged") return change;
  try {
    await recordAudit(admin, {
      actorId: params.userId,
      action: "payout_destination_changed",
      targetUserId: params.userId,
      details: {
        programs: SHARED_PROGRAMS, // one destination serves all three payout programs
        change,
        method: params.next?.method ?? null,
        previousMethod: params.previous?.method ?? null,
        methodChanged: (params.previous?.method ?? null) !== (params.next?.method ?? null),
      },
    });
    const copyKey = change === "added" ? "added" : "changed";
    const en = translations.en.payoutDestinationNotifications[copyKey];
    const fr = translations.fr.payoutDestinationNotifications[copyKey];
    await sendPushAndBellToUser(admin, params.userId, {
      category: "payout_destination_changed",
      title: `${en.title} / ${fr.title}`,
      body: `${en.body} / ${fr.body}`,
      url: "/dashboard/affiliate",
      data: { kind: "payout_destination_changed" },
    });
  } catch (err) {
    console.error("recordPayoutDestinationChange failed:", (err as Error)?.name ?? "unknown");
  }
  return change;
}

/** Pure: a short, fixed category for a failed send. `sent` = the provider already accepted the money before the failure. */
export function payoutSendFailureCategory(err: unknown, sent: boolean): "sent_but_not_recorded" | "provider_uncertain" | "provider_rejected" {
  if (sent) return "sent_but_not_recorded"; // money may have left but our own bookkeeping step failed: the one that needs a human
  return (err as { uncertain?: boolean } | null)?.uncertain ? "provider_uncertain" : "provider_rejected";
}

/** An admin payout send failed. Records the payout, the program, the admin and a category (+ the provider transaction id when one exists), never the provider's text. */
export async function recordPayoutSendFailure(
  admin: any,
  params: { adminId: string; program: PayoutProgram; payoutId: string; earnerUserId?: string | null; err: unknown; transId?: string | null }
): Promise<void> {
  const category = payoutSendFailureCategory(params.err, !!params.transId);
  const httpStatus = Number((params.err as { httpStatus?: number } | null)?.httpStatus);
  await recordAudit(admin, {
    actorId: params.adminId,
    action: `send_${params.program}_payout_failed`,
    targetUserId: params.earnerUserId ?? null,
    details: {
      payoutId: params.payoutId,
      program: params.program,
      category,
      ...(Number.isFinite(httpStatus) && httpStatus > 0 ? { providerHttpStatus: httpStatus } : {}),
      ...(params.transId ? { transId: params.transId } : {}),
    },
  });
}

/** A payout REQUEST the database refused for asking more than the available balance (the Phase 6 concurrency guard). Other refusals (below the minimum, no
 *  destination set) are ordinary user errors and are not recorded. Returns true when a row was written. */
export async function recordPayoutRequestRefusal(admin: any, params: { userId: string; program: PayoutProgram; err: unknown }): Promise<boolean> {
  const message = String((params.err as { message?: string } | null)?.message ?? "");
  if (!message.includes("payout_exceeds_available")) return false;
  await recordAudit(admin, {
    actorId: params.userId,
    action: "payout_request_refused",
    targetUserId: params.userId,
    details: { program: params.program, reason: "payout_exceeds_available" },
  });
  return true;
}
