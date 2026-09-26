// Shared status badge for every Ringo Protection admin view (list, detail, disputes, refunds).
// One place so the color/label mapping can never drift between pages.
const STATUS_STYLES: Record<string, string> = {
  awaiting_payment: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  protected: "bg-ringo-indigo/10 text-ringo-indigo",
  fulfillment_started: "bg-ringo-indigo/10 text-ringo-indigo",
  awaiting_confirmation: "bg-ringo-indigo/10 text-ringo-indigo",
  disputed: "bg-red-500/10 text-red-500",
  resolved_release: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  resolved_refund: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  released: "bg-ringo-teal/10 text-ringo-teal",
  refunded: "bg-ringo-muted/10 text-ringo-muted",
  payment_failed: "bg-red-500/10 text-red-500",
  expired: "bg-ringo-muted/10 text-ringo-muted",
  cancelled: "bg-ringo-muted/10 text-ringo-muted",
  requested: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  processing: "bg-ringo-indigo/10 text-ringo-indigo",
  completed: "bg-ringo-teal/10 text-ringo-teal",
  failed: "bg-red-500/10 text-red-500",
  open: "bg-red-500/10 text-red-500",
};

export default function AdminProtectionStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLES[status] || "bg-ringo-muted/10 text-ringo-muted"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
