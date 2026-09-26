# Ringo Protection — Operations Runbook

Internal reference for anyone investigating a Ringo Protection transaction. Ringo Protection is an
optional, additive escrow-like payment protection layer for Shop orders, entirely separate from
Normal Shop Payment. As of this document, it is **not live** — see "Activation status" below.

## Activation status

- `platform_settings.protection_enabled` — **must be `false`** until Phase 12's external gates are
  satisfied. When `true`, customers are offered Protection at checkout.
- `platform_settings.protection_refund_provider_enabled` — **must be `false`** indefinitely, or until
  a real, confirmed Fapshi refund/payout model exists. When `true`, admin-approved refunds are
  actually paid out via Fapshi; while `false`, refunds only ever reach `requested` and no money moves.
- **These two flags are the entire kill switch.** Setting either back to `false` immediately stops
  new activity of that kind without any code change or deploy.
- Activation additionally requires: Cameroon/CEMAC legal/compliance review of Ringo holding customer
  funds in escrow, and Fapshi's own confirmation of the intended payment/refund model (Fapshi has no
  dedicated refund endpoint today). **Technical completion of Phases 1–11 does not by itself
  authorize enabling either flag.**

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

## Refunds

- `protection_refunds` rows only ever reach `requested` while `protection_refund_provider_enabled` is
  `false`. There is no code path that marks a refund `completed` without that flag being `true` and a
  real Fapshi payout call succeeding (`fapshiRefundAdapter.ts`).
- A refund can never be requested for a transaction that is `released` or already `refunded`.

## Cron

- `/api/cron/protection-auto-release` releases every `awaiting_confirmation` transaction whose
  `auto_release_at` has passed. It requires the `CRON_SECRET` bearer token (constant-time compare) and
  is idempotent (safe to call repeatedly or concurrently).
- **It is intentionally NOT in `vercel.json`'s `crons` list yet** (mirrors the pre-existing, also
  unscheduled `reconcile-product-payments` cron). Before Phase 12 activation, this must be added with
  an appropriate schedule (e.g. hourly) — otherwise every Protection order will sit in
  `awaiting_confirmation` forever past its deadline with nothing to advance it.

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
- `platform_settings.protection_fee_rate` is currently `null` in production. Checkout code already
  fails closed on this (`protection_not_configured`), so nothing is broken today — but this value
  **must be set to a real rate before `protection_enabled` is ever flipped to `true`**.
