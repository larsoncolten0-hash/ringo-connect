// Maps a `notifications.type` value (see src/lib/notifications.ts's
// notifyAdmins/notifyUser call sites for the full list this app actually
// writes) to one of a small set of tabs NotificationBell.tsx's
// notification center filters by. Deliberately built from the types
// that actually exist in this codebase today, not a generic example
// list — a tab with nothing in it is worse than not having it, so
// NotificationBell only ever shows a category tab when at least one
// loaded notification maps to it.
//
// Unmapped types (anything added later without updating this file)
// return null — they still show up fine under "All"/"Unread", just
// without a specific category tab, so a forgotten update here never
// hides a notification.
export type NotificationCategory = "messages" | "payments" | "account";

const CATEGORY_BY_TYPE: Record<string, NotificationCategory> = {
  // Support chat — src/app/api/support/messages/route.ts,
  // src/app/api/admin/support/[id]/messages/route.ts.
  support_message: "messages",
  support_reply: "messages",
  // Subscription/signup money events — src/lib/applyPayment.ts,
  // src/app/api/signup-requests/[id]/pay-status/route.ts.
  subscription_payment: "payments",
  signup_request_paid: "payments",
  // Account status changes — approvals, the blue-tick flow, and a new
  // signup landing as an "account" event from the admin's side too.
  request_approved: "account",
  verification_requested: "account",
  verification_approved: "account",
  verification_rejected: "account",
  signup_free: "account",
};

export function categorizeNotification(type: string): NotificationCategory | null {
  return CATEGORY_BY_TYPE[type] ?? null;
}

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  messages: "Messages",
  payments: "Payments",
  account: "Account",
};
