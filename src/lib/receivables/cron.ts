// The automatic-reminder run behind /api/cron/invoice-reminders, as a plain function so it can be tested with stubs.
//
// SAFE BY DEFAULT: nothing happens unless the environment variable INVOICE_REMINDERS_CRON_ENABLED is exactly "true". Even then, nothing is
// sent for a business that has not turned automatic reminders on (they are OFF by default, per business).
//
// Order of operations (at-most-once by construction):
//   1. close stale claims (a crash between claim and send is recorded as failed and never retried),
//   2. claim due reminders in the database (insert-before-send; unique dedupe key; all eligibility rules re-checked there),
//   3. send each claimed email ONCE through the existing email infrastructure (reminder id = provider idempotency key),
//   4. record each outcome once; then notify owners for the alerts that were claimed.
// Automatic emails never contain a share link: none is created, none can be rebuilt (the raw token is not stored).
import { CRON_ENABLED_ENV } from "./constants";
import { overdueAlertText, renderReminderEmail, type ReminderContext } from "./reminderMessages";

export type CronDeps = {
  admin: { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }> };
  send: (input: { to: string; subject: string; html: string; replyTo?: string | null; log?: { emailType: string; resourceType?: string | null; resourceId?: string | null } }) => Promise<{ ok: boolean; error?: string }>;
  notifyUser: (userId: string, input: { type: string; title: string; body?: string | null; link?: string | null }) => Promise<void>;
  pushToUser: (userId: string, payload: { category: string; title: string; body: string; url?: string }) => Promise<void>;
  env: Record<string, string | undefined>;
  limit?: number;
};

export type CronResult =
  | { enabled: false }
  | { enabled: true; claimed: number; sent: number; failed: number; suppressed: number; alerts: number; staleClosed: number; error?: string };

export async function runInvoiceReminders(deps: CronDeps): Promise<CronResult> {
  if (deps.env[CRON_ENABLED_ENV] !== "true") return { enabled: false };
  const out = { enabled: true as const, claimed: 0, sent: 0, failed: 0, suppressed: 0, alerts: 0, staleClosed: 0 };

  const stale = await deps.admin.rpc("doc_expire_stale_reminder_claims", { p_max_age_minutes: 60 });
  if (!stale.error && typeof stale.data === "number") out.staleClosed = stale.data;

  const claim = await deps.admin.rpc("doc_claim_due_reminders", { p_limit: deps.limit ?? 200 });
  if (claim.error) {
    console.error("invoice reminders: claim failed:", claim.error.code, String(claim.error.message || "").slice(0, 120));
    return { ...out, error: "claim_failed" };
  }
  const emails = ((claim.data?.emails as ReminderContext[]) || []);
  const alerts = ((claim.data?.alerts as (ReminderContext & { owner_user_id: string; profile_id: string })[]) || []);
  out.claimed = emails.length;

  const complete = async (profileId: string, reminderId: string, status: string, code: string | null) => {
    const r = await deps.admin.rpc("doc_complete_reminder", { p_profile_id: profileId, p_reminder_id: reminderId, p_status: status, p_failure_code: code });
    if (r.error) console.error("invoice reminders: could not record outcome for", reminderId);
  };

  for (const c of emails as (ReminderContext & { profile_id: string })[]) {
    let status: "sent" | "failed" | "suppressed" = "failed";
    let code: string | null = "send_failed";
    try {
      if (!c.to) { code = "no_recipient"; }
      else {
        const mail = renderReminderEmail(c, null); // automatic reminders NEVER carry a link
        const res = await deps.send({ to: c.to, subject: mail.subject, html: mail.html, replyTo: c.reply_to, log: { emailType: "invoice_reminder", resourceType: "invoice_reminder", resourceId: c.reminder_id } });
        if (res.ok) { status = "sent"; code = null; }
        else if (res.error === "all_recipients_suppressed") { status = "suppressed"; code = "suppressed"; }
        else code = String(res.error || "send_failed").slice(0, 60);
      }
    } catch {
      code = "send_threw";
    }
    await complete(c.profile_id, c.reminder_id, status, code);
    out[status === "sent" ? "sent" : status === "suppressed" ? "suppressed" : "failed"]++;
  }

  for (const a of alerts) {
    const text = overdueAlertText(a);
    const link = "/dashboard/documents/receivables";
    let ok = true;
    try {
      await deps.notifyUser(a.owner_user_id, { type: "invoice_overdue", title: text.title, body: text.body, link });
      await deps.pushToUser(a.owner_user_id, { category: "invoice_overdue", title: text.title, body: text.body, url: link });
    } catch {
      ok = false;
    }
    await complete(a.profile_id, a.reminder_id, ok ? "sent" : "failed", ok ? null : "notify_failed");
    if (ok) out.alerts++;
  }
  return out;
}
