# Ringo Protection — Operations Runbook

Internal reference for anyone investigating a Ringo Protection transaction. Ringo Protection is an
optional, additive escrow-like payment protection layer for Shop orders, entirely separate from
Normal Shop Payment.

## Activation status (V1: manual refunds)

- `platform_settings.protection_enabled` — turned on via the existing Protection settings card at
  `/admin/price-controls`. Legal/compliance review is confirmed cleared (per Phase 12). When `true`,
  customers are offered Protection at checkout.
- `platform_settings.protection_refund_provider_enabled` — **stays `false` indefinitely under the V1
  operating model.** Refunds are handled by an admin manually sending the transfer via Fapshi's own
  app, then recording the result in Ringo (see "Manual refunds" below) — this flag represents
  *automatic* provider refunds, a future phase, not required for V1. While `false`, no code path can
  ever call Fapshi's payout API for a refund.
- **This flag is the automatic-refund kill switch** — it was never enabled and there is nothing to
  turn off. `protection_enabled` is the checkout kill switch: setting it back to `false` immediately
  stops new Protection checkouts without any code change or deploy; existing protected orders keep
  moving through their normal lifecycle (fulfillment, confirmation, auto-release, disputes) regardless.

## Transaction lifecycle

```
awaiting_payment -> protected -> fulfillment_started -> awaiting_confirmation -> released
                 \-> payment_failed / cancelled / expired          \-> disputed -> resolved_release -> released
                                                                              \-> resolved_refund -> refunded
```

- `released` / `refunded` / `cancelled` / `expired` / `payment_failed` are terminal — no further
  transition is ever legal (enforced by both `transitions.ts` and the `protection_transactions_guard`
  DB trigger).
- Every transition is a single atomic conditional `UPDATE ... WHERE status IN (legal predecessors)`
  (`engine.ts`) — never a read-then-write race. Every transition is recorded as an append-only row in
  `protection_transaction_events`.
- `awaiting_confirmation -> released` happens either by the customer confirming
  (`/api/protection/transactions/[id]/confirm`) or automatically once `auto_release_at` has passed
  (the `protection-auto-release` cron — see "Cron" below). Both paths call the exact same
  `releaseProtectionTransaction()`; there is only one release code path.
- Release always creates exactly one `commerce_sale_earnings` row (with `protection_transaction_id`
  set and `payment_id` null) **before** flipping the transaction to `released` — this ordering
  guarantees a seller is never told "released" without a matching earning existing.

## Disputes

- A customer can open one dispute per transaction, only while the transaction is `protected`,
  `fulfillment_started`, or `awaiting_confirmation`. Reopening/duplicating is impossible — the
  `protection_disputes` table has a unique index on `protection_transaction_id`.
- An admin resolves an open dispute to either `resolved_release` (customer eventually gets nothing
  further; seller is paid via the same release path above) or `resolved_refund` (a `protection_refunds`
  row is created at `requested` — never automatically paid out; see the refund flag above).
- If two admin resolution attempts race (extremely rare — two people, or double-click), exactly one
  side ever wins the underlying transaction-level transition; the loser can occasionally see a raw
  "conflict" response instead of a clean "already resolved" message. This is a UX rough edge, not a
  data-integrity issue — refreshing the dispute in the admin UI always shows the true, single outcome.

## Manual refunds (V1 operating model)

1. An admin resolves a dispute toward refund (`resolved_refund`) — this creates the one
   `protection_refunds` row at `requested`, via the existing Phase 3/7 mechanism. **No money has
   moved yet and no automatic call is ever made.**
2. The admin independently verifies the destination Mobile Money number and network with the
   customer through the established operational process — never assumed from
   `product_orders.customer_phone`.
3. The admin manually sends the refund amount (the transaction's own `seller_protected_amount`
   snapshot — never a newly calculated figure) via Fapshi's own app.
4. The admin opens the transaction at `/admin/protection/[id]` and uses "Record manual refund
   result" to report what happened:
   - **Transfer succeeded** — requires the destination phone/network and the Fapshi
     transaction/reference. This calls `POST /api/admin/protection/transactions/[id]/refund-outcome`
     with `{outcome: "completed", ...}`, which marks the refund `completed`
     (`provider_status: "MANUAL_CONFIRMED"`) and moves the parent transaction to `refunded`. The
     customer is notified only now, never earlier.
   - **Transfer failed** — requires a failure reason. The refund is marked `failed`; the parent
     transaction is left exactly where it was (never `refunded`). The admin can retry the same
     action later once the problem is understood — a `failed` refund is always re-claimable.
5. `recordManualProtectionRefundOutcome()` (`refundEngine.ts`) is the one place this happens — it
   composes the existing `beginProtectionRefundProcessing`/`completeProtectionRefund`/
   `failProtectionRefund` primitives, never adds a second refund-mutation path, and never accepts an
   amount from the caller.
6. A refund can never be requested for a transaction that is `released` or already `refunded`, and an
   already-`completed` refund rejects a second manual-outcome submission as a conflict rather than
   silently reprocessing it.
7. `fapshiRefundAdapter.ts` (the one function that *can* make a real automatic Fapshi payout call)
   stays completely dormant and unwired in V1 — nothing manual touches it, and it remains fail-closed
   on `protection_refund_provider_enabled`.

## Cron

- `/api/cron/protection-auto-release` releases every `awaiting_confirmation` transaction whose
  `auto_release_at` has passed. It requires the `CRON_SECRET` bearer token (constant-time compare) and
  is idempotent (safe to call repeatedly or concurrently).
- Scheduled in `vercel.json` at `0 5 * * *` (once daily) as of Phase 12 — chosen conservatively to
  match this project's existing crons, which are also daily-only (suggesting a Vercel plan tier that
  doesn't support more frequent schedules). Worst case this adds up to ~24h of delay on top of
  `protection_auto_release_hours` (currently 48h) before an unconfirmed order auto-releases. If the
  Vercel plan supports more frequent crons, tightening this to hourly (`0 * * * *`) is a safe,
  independent follow-up.

## Investigating a specific transaction

1. Look it up in `/admin/protection/[id]` (Phase 8) — shows status, amounts, event timeline, and any
   linked dispute/refund.
2. Cross-check `protection_transaction_events` for the full history if the summary looks wrong —
   every transition is logged there, append-only, with the actor that caused it.
3. If a release looks like it should have happened but didn't: check `commerce_sale_earnings` for a
   row with that `protection_transaction_id` — if present, it did release (check `released_at`); if
   absent and status is still `awaiting_confirmation`, check `auto_release_at` against the current
   time and confirm the cron has actually been invoked (not just scheduled).
4. Never manually update `protection_transactions.status`, `commerce_sale_earnings`, or
   `protection_refunds` directly in the database — every legitimate transition has a corresponding
   application code path; a manual edit will not fire notifications and may violate a guard trigger.

## Known, disclosed non-issues

- `commerce_payouts` (a pre-existing, non-Protection Shop table) has no explicit `revoke ... from
  anon`; RLS correctly filters it to zero rows for an anonymous request, so there is no actual leak,
  but it is architecturally inconsistent with Protection's own stricter "revoke-first" posture.
  Out of Protection's scope to change unilaterally.
- The admin dispute-resolution race (two admins, or a double-click, resolving toward release and
  refund at nearly the same instant): exactly one outcome ever wins financially (proven by
  `protectionSecurityAudit.test.mjs`), but the losing side can occasionally see a raw "conflict"
  response instead of a clean "already resolved" message. Refreshing always shows the true outcome.
