// Ringo Watchdog V1 - the deterministic rules. Pure: no database, no network, no clock except the one passed in. Every rule is a plain threshold or a plain match on an
// audit action that Ringo already records, so every alert can be explained in one sentence.
//
// A finding carries ONLY allow-listed values (a rule code, a severity, enum strings, small integers, an id that passed a strict pattern). Nothing free-text ever reaches
// `params`, so an alert cannot hold a phone number, an email, a destination, a token or a provider message even if the audit row it came from did.
//
// Watchdog is an observer: nothing here blocks, retries, locks or changes anything.

export type WatchdogSeverity = "medium" | "high";
export type WatchdogRuleCode = "WD-001" | "WD-002" | "WD-003" | "WD-004" | "WD-005" | "WD-006";
export type PayoutProgram = "affiliate" | "music" | "shop";

export type WatchdogParams = Record<string, string | number>;

export type WatchdogFinding = {
  rule: WatchdogRuleCode;
  severity: WatchdogSeverity;
  eventType: string; // the audit action that raised it
  subjectUserId: string | null; // the affected account, when there is one
  params: WatchdogParams;
  dedupeKey: string;
};

/** The audit rows Watchdog looks at (the shape recordAudit writes). Anything else is ignored. */
export type WatchdogAuditEvent = {
  action: string;
  actorId?: string | null;
  targetUserId?: string | null;
  details?: Record<string, unknown> | null;
  at?: Date;
};

export type WatchdogDeps = {
  now?: () => Date;
  /** How many audit rows with this action (optionally for this account) were written in the last `sinceMs`. The row being evaluated is already included. */
  countRecent: (q: { action: string; targetUserId?: string; sinceMs: number }) => Promise<number>;
};

export const WATCHDOG_THRESHOLDS = {
  payoutFailures: { count: 3, windowMinutes: 30 }, // WD-002
  payoutRefusals: { count: 3, windowMinutes: 15 }, // WD-004
  destinationDedupeMinutes: 10, // WD-001: one alert per change, however many times the request is replayed
  escalationDedupeMinutes: 15, // WD-006
} as const;

export const PROGRAMS: readonly PayoutProgram[] = ["affiliate", "music", "shop"];
export const FAILURE_CATEGORIES = ["provider_rejected", "provider_uncertain", "sent_but_not_recorded"] as const;
const DESTINATION_CHANGES = ["added", "changed", "removed"] as const;
const SUSPICIOUS_CATEGORIES = new Set<string>(["provider_uncertain", "sent_but_not_recorded"]);
const FAILURE_ACTION = /^send_(affiliate|music|shop)_payout_failed$/;

/** Every audit action Watchdog reacts to: lets the audit writer skip all other rows without a single query. */
export const WATCHED_ACTIONS: readonly string[] = [
  "payout_destination_changed",
  "payout_request_refused",
  "team_permission_escalation_blocked",
  ...PROGRAMS.map((p) => `send_${p}_payout_failed`),
];
export const isWatchedAction = (action: unknown): boolean => typeof action === "string" && WATCHED_ACTIONS.includes(action);

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_LIKE = /^[0-9a-fA-F-]{8,40}$/;
const minutes = (n: number) => n * 60_000;
const bucket = (at: Date, windowMinutes: number) => Math.floor(at.getTime() / minutes(windowMinutes));
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null);
const userId = (v: unknown): string | null => (typeof v === "string" && UUID_LIKE.test(v) ? v : null);

/** Evaluates ONE audit event. A malformed or unknown event yields no findings (it cannot throw on bad input). An error from `deps.countRecent` (the database) is NOT
 *  swallowed here: it propagates to observeAuditEvent, which logs it, so a Watchdog failure is never silent. */
export async function evaluateWatchdogEvent(event: WatchdogAuditEvent, deps: WatchdogDeps): Promise<WatchdogFinding[]> {
  {
    if (!event || typeof event !== "object" || typeof event.action !== "string" || !isWatchedAction(event.action)) return [];
    const now = event.at instanceof Date && !Number.isNaN(event.at.getTime()) ? event.at : deps.now?.() ?? new Date();
    const details = event.details && typeof event.details === "object" ? event.details : {};
    const target = userId(event.targetUserId);
    const actor = userId(event.actorId);
    const out: WatchdogFinding[] = [];

    // WD-001: a payout destination was added / changed (the account holder was already told by Phase 7; this is the owner's copy). One alert per change.
    if (event.action === "payout_destination_changed") {
      const change = oneOf((details as any).change, DESTINATION_CHANGES);
      const subject = target ?? actor;
      if (change && subject) {
        out.push({
          rule: "WD-001", severity: "medium", eventType: event.action, subjectUserId: subject, params: { change },
          dedupeKey: `wd001:${subject}:${change}:${bucket(now, WATCHDOG_THRESHOLDS.destinationDedupeMinutes)}`,
        });
      }
    }

    // WD-002 / WD-003: failed admin payout sends.
    const failure = FAILURE_ACTION.exec(event.action);
    if (failure) {
      const program = failure[1] as PayoutProgram;
      const category = oneOf((details as any).category, FAILURE_CATEGORIES) ?? "provider_rejected";

      // WD-003: money may have moved at the provider while Ringo's own follow-up failed. Alerts on the FIRST occurrence, once per payout.
      if (SUSPICIOUS_CATEGORIES.has(category)) {
        const rawPayout = (details as any).payoutId;
        const payoutId = typeof rawPayout === "string" && SAFE_ID.test(rawPayout) ? rawPayout : null;
        out.push({
          rule: "WD-003", severity: "high", eventType: event.action, subjectUserId: target,
          params: { program, category, ...(payoutId ? { payoutId } : {}) },
          dedupeKey: payoutId ? `wd003:${payoutId}:${category}` : `wd003:${program}:${category}:${bucket(now, 30)}`,
        });
      }

      // WD-002: three or more failures inside the window, for the same account first, otherwise for the whole program (a provider-side problem hits many accounts).
      const { count: threshold, windowMinutes } = WATCHDOG_THRESHOLDS.payoutFailures;
      const sinceMs = minutes(windowMinutes);
      const accountCount = target ? await deps.countRecent({ action: event.action, targetUserId: target, sinceMs }) : 0;
      if (target && accountCount >= threshold) {
        out.push({
          rule: "WD-002", severity: "high", eventType: event.action, subjectUserId: target, params: { program, category, count: accountCount, windowMinutes, scope: "account" },
          dedupeKey: `wd002:${program}:account:${target}:${bucket(now, windowMinutes)}`,
        });
      } else {
        const programCount = await deps.countRecent({ action: event.action, sinceMs });
        if (programCount >= threshold) {
          out.push({
            rule: "WD-002", severity: "high", eventType: event.action, subjectUserId: null, params: { program, category, count: programCount, windowMinutes, scope: "program" },
            dedupeKey: `wd002:${program}:program:${bucket(now, windowMinutes)}`,
          });
        }
      }
    }

    // WD-004: repeated requests for more than the available balance, same account.
    if (event.action === "payout_request_refused" && (details as any).reason === "payout_exceeds_available") {
      const subject = target ?? actor;
      const program = oneOf((details as any).program, PROGRAMS) ?? "affiliate";
      const { count: threshold, windowMinutes } = WATCHDOG_THRESHOLDS.payoutRefusals;
      if (subject) {
        const count = await deps.countRecent({ action: event.action, targetUserId: subject, sinceMs: minutes(windowMinutes) });
        if (count >= threshold) {
          out.push({
            rule: "WD-004", severity: "medium", eventType: event.action, subjectUserId: subject, params: { program, count, windowMinutes },
            dedupeKey: `wd004:${subject}:${bucket(now, windowMinutes)}`,
          });
        }
      }
    }

    // WD-006: a team permission escalation the API refused (the caller tried to grant permissions they do not hold).
    if (event.action === "team_permission_escalation_blocked") {
      const subject = actor ?? target;
      if (subject) {
        const site = oneOf((details as any).site, ["role_create", "role_update", "member_role_change", "invitation_create"] as const) ?? "role_update";
        out.push({
          rule: "WD-006", severity: "high", eventType: event.action, subjectUserId: subject, params: { site },
          dedupeKey: `wd006:${subject}:${bucket(now, WATCHDOG_THRESHOLDS.escalationDedupeMinutes)}`,
        });
      }
    }

    return out;
  }
}

/** WD-005: a report from a security-suite run (CI / pre-deploy). Only a failure is a finding. */
export function evaluateSecuritySuiteReport(report: unknown, now: Date = new Date()): WatchdogFinding | null {
  try {
    if (!report || typeof report !== "object") return null;
    const r = report as { status?: unknown; failed?: unknown; ref?: unknown };
    if (r.status !== "fail") return null;
    const failed = Array.isArray(r.failed) ? r.failed.filter((x): x is string => typeof x === "string" && /^[a-z0-9-]{1,24}$/.test(x)).slice(0, 16) : [];
    const ref = typeof r.ref === "string" && SAFE_ID.test(r.ref) ? r.ref : null;
    return {
      rule: "WD-005", severity: "high", eventType: "security_suite_failed", subjectUserId: null,
      params: { failedCount: failed.length, ...(failed.length ? { suites: failed.join(",") } : {}), ...(ref ? { ref } : {}) },
      dedupeKey: ref ? `wd005:${ref}` : `wd005:day:${Math.floor(now.getTime() / 86_400_000)}`,
    };
  } catch {
    return null;
  }
}
