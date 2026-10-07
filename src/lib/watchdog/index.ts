// Ringo Watchdog V1 - the observer. Ringo records an audit event -> Watchdog evaluates it -> a rule matches -> ONE deduplicated incident row + an owner alert.
//
// Fail-safe by construction: observeAuditEvent / raiseFinding never throw, never block the operation they observe beyond a few small queries (and only for the handful of
// audit actions in WATCHED_ACTIONS), and log a failure as an error NAME and a database code only: never the event, never a message that could echo data.
// Watchdog only alerts. It never retries a payout, changes a status, locks an account or sends money.
import { sendPushAndBellToAdmins } from "@/lib/push/withBell";
import { renderBilingualWatchdogAlert } from "./alerts";
import { evaluateWatchdogEvent, isWatchedAction, type WatchdogAuditEvent, type WatchdogFinding } from "./rules";

export * from "./rules";
export { renderWatchdogAlert, renderBilingualWatchdogAlert } from "./alerts";

const safeReason = (err: unknown) => {
  const e = err as { name?: string; code?: string; message?: string } | null;
  // a database code ("42P01", "23505") or one of our own short codes; never free text
  const code = typeof e?.message === "string" && /^[A-Za-z0-9_]{1,12}$/.test(e.message) ? e.message : typeof e?.code === "string" ? e.code : "";
  return `${e?.name ?? "Error"}${code ? `:${code}` : ""}`;
};

export async function countRecentAudit(admin: any, q: { action: string; targetUserId?: string; sinceMs: number }): Promise<number> {
  let query = admin
    .from("admin_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", q.action)
    .gte("created_at", new Date(Date.now() - q.sinceMs).toISOString());
  if (q.targetUserId) query = query.eq("target_user_id", q.targetUserId);
  const { count, error } = await query;
  if (error) throw new Error(String(error.code ?? "count_failed").slice(0, 12));
  return count ?? 0;
}

/** Inserts the incident. The unique dedupe key makes "already alerted for this incident" atomic: two overlapping requests cannot both create it. */
export async function insertFinding(admin: any, f: WatchdogFinding): Promise<"created" | "duplicate"> {
  const { error } = await admin.from("watchdog_events").insert({
    rule_code: f.rule,
    severity: f.severity,
    event_type: f.eventType,
    subject_user_id: f.subjectUserId,
    params: f.params,
    dedupe_key: f.dedupeKey,
  });
  if (!error) return "created";
  if (error.code === "23505") return "duplicate";
  throw new Error(String(error.code ?? "insert_failed").slice(0, 12));
}

/** HIGH: push + bell to every admin. MEDIUM: bell only (it appears in the console and the feed without waking anyone up). */
export async function notifyOwner(admin: any, f: WatchdogFinding): Promise<void> {
  const { title, body } = renderBilingualWatchdogAlert(f.rule, f.severity, f.params);
  if (f.severity === "high") {
    await sendPushAndBellToAdmins(admin, { category: "watchdog_alert", title, body, url: "/admin/watchdog", data: { kind: "watchdog_alert" } });
    return;
  }
  const { error } = await admin.from("notifications").insert({ audience: "admin", type: "watchdog_alert", title, body, link: "/admin/watchdog" });
  if (error) throw new Error(String(error.code ?? "bell_failed").slice(0, 12));
}

/** Records one finding and alerts the owner, once per incident. Returns what happened; never throws. */
export async function raiseFinding(admin: any, f: WatchdogFinding): Promise<"created" | "duplicate" | "failed"> {
  try {
    const result = await insertFinding(admin, f);
    if (result === "duplicate") return "duplicate";
    try {
      await notifyOwner(admin, f);
    } catch (err) {
      console.error(`watchdog: alert for ${f.rule} could not be delivered (${safeReason(err)}); the incident is still in the feed`);
    }
    return "created";
  } catch (err) {
    console.error(`watchdog: could not record ${f.rule} (${safeReason(err)})`);
    return "failed";
  }
}

/** The one hook: called by recordAudit after an audit row was written. Cheap for every action Watchdog does not watch. */
export async function observeAuditEvent(
  admin: any,
  row: { actorId: string; action: string; targetUserId?: string | null; details?: Record<string, unknown> | null }
): Promise<void> {
  try {
    if (!row || !isWatchedAction(row.action)) return;
    const event: WatchdogAuditEvent = { action: row.action, actorId: row.actorId, targetUserId: row.targetUserId ?? null, details: row.details ?? null };
    const findings = await evaluateWatchdogEvent(event, { countRecent: (q) => countRecentAudit(admin, q) });
    for (const f of findings) await raiseFinding(admin, f);
  } catch (err) {
    console.error(`watchdog: could not evaluate an audit event (${safeReason(err)})`);
  }
}
