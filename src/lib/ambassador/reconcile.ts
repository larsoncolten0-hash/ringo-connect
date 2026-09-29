// Ambassador Program (Phase I) — lifecycle reconciliation.
//
// Recovers ONLY states where a legitimate event already happened but a later
// step was interrupted, and only by re-calling the approved, idempotent SQL
// functions with the same arguments the live hooks use. It never computes or
// awards money itself, never edits or deletes financial rows, and never
// "guesses": anything ambiguous is REPORTED (with ids only — no customer
// data, no destinations, no secrets) and left exactly as found.
//
// Recoverable states (each proven by authoritative rows, not inferred):
//   A. Sale still 'attributed' although its signup request is customer_paid.
//      -> ambassador_lock_sale(signup_request_id). (pay-status calls this once,
//         inline; if that call failed it was only logged.)
//   B. Sale 'locked' (payment confirmed) although its signup request has since
//      been APPROVED (registration done, created_user_id recorded).
//      -> ambassador_evaluate_milestone_1(sale, created_user_id). Covers both
//         "milestone-1 call failed at approval" and "approved before payment
//         was confirmed", where nothing would ever have re-evaluated it.
//   C. Sale at 'milestone_1_earned' -> the existing bounded activation sweep
//      (now fair: see sweepAmbassadorActivation).
//   D. Payout 'processing' / 'reconciliation_required' WITH a Fapshi transaction
//      id -> re-check with Fapshi and finalize through the same function the
//      admin "Check status" button uses. Only what Fapshi itself confirms is
//      marked paid; only Fapshi's own FAILED/EXPIRED returns it to retryable.
//   E. Payout 'processing' with NO transaction id whose claim is stale (the
//      process died between claiming and hearing back) -> mark it
//      reconciliation_required. This only makes the uncertainty EXPLICIT: it
//      releases nothing and re-sends nothing.
//
// Report-only (never auto-changed) — see findIntegrityIssues():
//   every payout in 'reconciliation_required' (a human resolves it), a young
//   'processing' claim with no transaction id, paid payouts whose linked ledger
//   rows are not paid, and sales past a milestone with no matching ledger row.
//
// Every step is independent (one failing never blocks the others), bounded by
// `limit`, and safe to run repeatedly or concurrently: the SQL functions are
// state-guarded, the ledger has unique indexes per (sale, recipient,
// milestone) and per reversal, and payouts are only ever claimed by
// compare-and-swap.
import { notifySaleConfirmed, notifyMilestoneEarned } from "@/lib/ambassador/notifications";
import { sweepAmbassadorActivation } from "@/lib/ambassador/activationSweep";
import { checkPayoutFapshi } from "@/lib/ambassador/adminPayouts";

export const RECONCILE_DEFAULT_LIMIT = 100;
const PAYOUT_CHECK_LIMIT = 25;
// A claim older than this with no transaction id means the process that made it
// is gone. Marking it uncertain is safe (it changes no money state).
const STALE_CLAIM_MS = 10 * 60 * 1000;

export interface IntegrityFinding {
  kind: string;
  ids: string[];
}

export interface ReconcileSummary {
  salesLocked: number;
  registrationsCompleted: number;
  activationChecked: number;
  activationEarned: number;
  payoutsChecked: number;
  payoutsMarkedUncertain: number;
  payoutsFinalized: number;
  payoutsReverted: number;
  integrity: IntegrityFinding[];
  stepErrors: string[];
}

// The embedded signup request may come back as an object or a one-element
// array depending on the client; normalise it.
const embedded = (row: any) => (Array.isArray(row?.signup_requests) ? row.signup_requests[0] : row?.signup_requests) ?? null;

async function step<T>(name: string, summary: ReconcileSummary, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err: any) {
    summary.stepErrors.push(name);
    console.error(`[ambassador] reconcile step "${name}" failed:`, err?.message || err);
    return null;
  }
}

export async function reconcileAmbassadorLifecycle(admin: any, { limit = RECONCILE_DEFAULT_LIMIT, now = new Date() }: { limit?: number; now?: Date } = {}): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { salesLocked: 0, registrationsCompleted: 0, activationChecked: 0, activationEarned: 0, payoutsChecked: 0, payoutsMarkedUncertain: 0, payoutsFinalized: 0, payoutsReverted: 0, integrity: [], stepErrors: [] };

  // A — paid but never locked.
  await step("lock", summary, async () => {
    const { data } = await admin
      .from("ambassador_sales")
      .select("id, signup_request_id, signup_requests!inner(customer_paid)")
      .eq("status", "attributed")
      .eq("signup_requests.customer_paid", true)
      .order("attributed_at", { ascending: true })
      .limit(limit);
    for (const row of data || []) {
      if (embedded(row)?.customer_paid !== true) continue; // belt and braces vs. the filter
      const { data: result, error } = await admin.rpc("ambassador_lock_sale", { p_signup_request_id: row.signup_request_id });
      if (error) {
        console.error("[ambassador] reconcile lock failed for sale", row.id, error.message);
        continue;
      }
      if (result?.ok && result.sale_id) {
        summary.salesLocked++;
        await notifySaleConfirmed(admin, result.sale_id);
      }
    }
  });

  // B — locked and registered, milestone 1 never recorded.
  await step("registration", summary, async () => {
    const { data } = await admin
      .from("ambassador_sales")
      .select("id, signup_request_id, signup_requests!inner(status, created_user_id)")
      .eq("status", "locked")
      .eq("signup_requests.status", "approved")
      .not("signup_requests.created_user_id", "is", null)
      .order("locked_at", { ascending: true })
      .limit(limit);
    for (const row of data || []) {
      const req = embedded(row);
      if (!req || req.status !== "approved" || !req.created_user_id) continue;
      const { data: result, error } = await admin.rpc("ambassador_evaluate_milestone_1", { p_sale_id: row.id, p_customer_user_id: req.created_user_id });
      if (error) {
        console.error("[ambassador] reconcile milestone 1 failed for sale", row.id, error.message);
        continue;
      }
      if (result?.ok) {
        summary.registrationsCompleted++;
        await notifyMilestoneEarned(admin, row.id, "sale_registration");
      }
    }
  });

  // C — activation (existing sweep, now fair across runs).
  await step("activation", summary, async () => {
    const swept = await sweepAmbassadorActivation(admin, { limit, now });
    summary.activationChecked = swept.checked;
    summary.activationEarned = swept.earned;
  });

  // D — payouts Fapshi has already resolved.
  await step("payouts", summary, async () => {
    const { data } = await admin
      .from("ambassador_payouts")
      .select("id, fapshi_trans_id, status, claimed_at")
      .in("status", ["processing", "reconciliation_required"])
      .order("requested_at", { ascending: true })
      .limit(PAYOUT_CHECK_LIMIT);
    for (const row of data || []) {
      if (!row.fapshi_trans_id) {
        // E — no transaction id. Never re-sent, never released: at most make a
        // stale claim's uncertainty explicit; everything else is reported below.
        const stale = row.status === "processing" && (!row.claimed_at || now.getTime() - new Date(row.claimed_at).getTime() > STALE_CLAIM_MS);
        if (stale) {
          const { data: marked } = await admin.rpc("ambassador_mark_payout_uncertain", { p_payout_id: row.id, p_actor_user_id: null, p_reason: "Stale claim with no transaction id — outcome unknown" });
          if (marked?.ok) summary.payoutsMarkedUncertain++;
        }
        continue;
      }
      summary.payoutsChecked++;
      const result = await checkPayoutFapshi(admin, null, row.id);
      if (!result.ok) continue;
      if (result.fapshiStatus === "SUCCESSFUL") summary.payoutsFinalized++;
      else if (result.fapshiStatus === "FAILED" || result.fapshiStatus === "EXPIRED") summary.payoutsReverted++;
    }
  });

  await step("integrity", summary, async () => {
    summary.integrity = await findIntegrityIssues(admin, { limit });
  });

  for (const f of summary.integrity) console.error(`[ambassador] INTEGRITY ${f.kind}: ${f.ids.length} record(s) need manual review — ${f.ids.slice(0, 10).join(", ")}`);
  return summary;
}

/** Read-only detector for states this program must NEVER auto-fix (fixing
 *  them could award or pay money twice). Returns ids only. */
export async function findIntegrityIssues(admin: any, { limit = RECONCILE_DEFAULT_LIMIT }: { limit?: number } = {}): Promise<IntegrityFinding[]> {
  const findings: IntegrityFinding[] = [];
  const add = (kind: string, ids: string[]) => ids.length && findings.push({ kind, ids });

  // 1. Payouts whose outcome is unknown: explicitly held for reconciliation, or
  //    a young processing claim with no Fapshi id.
  const { data: stuck } = await admin.from("ambassador_payouts").select("id, fapshi_trans_id, status").in("status", ["processing", "reconciliation_required"]).order("requested_at", { ascending: true }).limit(limit);
  add("payout_reconciliation_required", (stuck || []).filter((p: any) => p.status === "reconciliation_required").map((p: any) => p.id));
  add("payout_processing_without_transaction_id", (stuck || []).filter((p: any) => p.status === "processing" && !p.fapshi_trans_id).map((p: any) => p.id));

  // 2. A paid payout whose linked ledger rows are not all paid.
  const { data: paidPayouts } = await admin.from("ambassador_payouts").select("id").eq("status", "paid").order("requested_at", { ascending: false }).limit(limit);
  const paidIds = (paidPayouts || []).map((p: any) => p.id);
  if (paidIds.length) {
    const { data: linked } = await admin.from("ambassador_commission_ledger").select("id, payout_id, status").in("payout_id", paidIds);
    add("paid_payout_with_unpaid_ledger_rows", Array.from(new Set((linked || []).filter((l: any) => l.status !== "paid").map((l: any) => l.payout_id))));
  }

  // 3. Sales past a milestone that have no matching ambassador ledger row.
  const { data: sales } = await admin.from("ambassador_sales").select("id, status, customer_user_id").in("status", ["milestone_1_earned", "milestone_2_earned"]).order("updated_at", { ascending: false }).limit(limit);
  const saleRows = sales || [];
  add("milestone_sale_without_customer_user", saleRows.filter((s: any) => !s.customer_user_id).map((s: any) => s.id));
  if (saleRows.length) {
    const { data: ledger } = await admin.from("ambassador_commission_ledger").select("sale_id, milestone, recipient_type, entry_type").in("sale_id", saleRows.map((s: any) => s.id)).eq("recipient_type", "ambassador").eq("entry_type", "commission");
    const have = new Set((ledger || []).map((l: any) => `${l.sale_id}:${l.milestone}`));
    add("milestone_1_sale_without_commission_row", saleRows.filter((s: any) => !have.has(`${s.id}:sale_registration`)).map((s: any) => s.id));
    add("milestone_2_sale_without_commission_row", saleRows.filter((s: any) => s.status === "milestone_2_earned" && !have.has(`${s.id}:activation`)).map((s: any) => s.id));
  }
  return findings;
}
