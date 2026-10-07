// The one place that writes the existing admin_audit_log table (columns: admin_id, action, target_user_id, details, created_at) for the security / observability
// rows added after the audit. It is the SAME table and the SAME row shape every older route writes inline; this only adds the error handling those inline inserts lack.
//
// Rules for callers: `details` carries object ids and field NAMES, never a secret, a token, a destination value, a phone number, an email or a provider payload.
// Never throws: an audit problem must not change the result of the action it records (the same posture as the notification helpers). `actorId` is the signed-in
// user who performed the action (an admin for admin routes; the earner themselves for a self-service event such as a payout-destination change).
export type AuditRow = {
  actorId: string;
  action: string;
  targetUserId?: string | null;
  details?: Record<string, unknown>;
};

export async function recordAudit(admin: any, row: AuditRow): Promise<void> {
  try {
    const { error } = await admin.from("admin_audit_log").insert({
      admin_id: row.actorId,
      action: row.action,
      target_user_id: row.targetUserId ?? null,
      details: row.details ?? null,
    });
    if (error) console.error(`audit write failed (${row.action}):`, error.code ?? "unknown");
  } catch (err) {
    console.error(`audit write threw (${row.action}):`, (err as Error)?.name ?? "unknown");
  }
}
