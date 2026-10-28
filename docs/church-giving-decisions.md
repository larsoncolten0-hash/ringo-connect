# Church giving and care funds: approved decisions and activation

Status: **built, switched OFF.** The money code exists but no church can collect: `GIVING_AVAILABLE` is `false`, `church_giving_collection_open()` answers `false`, and no church has `giving` on. Nothing in this document is applied to any database. Activation needs the owner's explicit approval (checklist at the end).

## Approved decisions (the owner's, replacing the earlier proposals)

| # | Decision | Approved | Where it lives |
|---|---|---|---|
| 1 | Ringo's percentage | **5% on giving funds and a separate 5% on care funds** (two settings, snapshotted on every gift) | `platform_settings.church_giving_commission_rate`, `church_care_commission_rate` (migration 2027-01-12) |
| 2 | Who pays Fapshi's fee | **Ringo absorbs it.** The donor pays exactly the amount; the church's net is gross minus Ringo's commission, nothing else. Minimum gift **500 XAF**. | `church_min_gift_xaf`; `church_settle_gift()` |
| 3 | Receipts | **A receipt for every confirmed gift** (in-app, printable, and by email when the donor gave an address). **Anonymous giving allowed:** the church sees no name or contact (the table forbids storing them); Ringo keeps the payer phone and the Fapshi reference for reconciliation. No tax-deduction wording. | `ChurchGiveBody`, `receiptEmail.ts`, `church_gifts_anonymous_check` |
| 4 | Refunds | **Refund-request records and administrative handling only.** A donor can ask within 48 hours; a Ringo administrator approves, declines, or records a refund they returned by hand. Nothing is sent to Fapshi (Fapshi refund support is unverified). A refund reverses the church's earning only while it is not in a payout. | `church_gift_refund_requests`, `church_gift_refund_decide()`, `/api/admin/church/gift-refunds` |
| 5 | Closing a care fund early | **The owner may close it at any time; the money already given stays with the church** (paid out to it), never returned to givers. The form and the public page say so before anyone gives. A fund with gifts can never be deleted. | `church_gifts.fund_id ... on delete restrict`; UI notices |

Additional choices: church earnings, payout hold (3 days) and minimum payout (5,000 XAF) are their own settings, separate from the Shop's. Fund templates (General, Building, Missions, Benevolence) only fill the form. Donor data: phone required (Mobile Money), name/contact/email optional, no marketing opt-in, ever.

### Conflicts with the earlier proposals (the owner's decisions were followed)

- Fee: the proposal deducted Fapshi's fee from the church's share; approved is **Ringo absorbs it**. Note for the owner: at 5% commission, a 500 XAF gift earns Ringo 25 XAF, which may be less than Fapshi's own fee on that gift. This is a business choice, not a defect; revisit the minimum or the rate if it matters.
- Care funds: the proposal was 0%; approved is 5%.
- Refunds: the proposal reversed through the earnings status path automatically; approved is **record-only plus manual administrative handling**.

## What exists

- `church_giving_funds` (2027-01-10) and the lock `church_features_giving_lock_trg` (2027-01-11), unchanged.
- `2027-01-12_church_gifts.sql` (**not applied**, with preflight, verify and rollback files in `supabase/support/`): `church_gifts`, `church_gift_earnings`, `church_payouts`, `church_gift_refund_requests`, the church-only `platform_settings` columns, guard triggers (immutable history, state machines, no deletes), `church_settle_gift()`, `request_church_payout()`, `church_payout_finish()`, `church_gift_refund_decide()`, the staff views `church_gift_ledger` and `church_gift_earnings_ledger`. **It keeps collection closed**: the gift guard refuses every insert while `church_giving_collection_open()` is false.
- `supabase/support/2027-01-13_church_giving_activate.PROPOSED.sql`: deliberately NOT in `supabase/migrations`. It makes collection depend on a platform kill switch `church_giving_enabled` that it creates OFF.
- Code in `src/lib/church/giving/gifts/` (rules, flow, store, reports, handlers, http, receipt email), public routes `/api/public/church-gifts*`, dashboard routes `/api/church/{gifts,giving-payouts,gift-refunds}`, administrator routes `/api/admin/church/{gift-refunds,payouts,gifts-reconcile}`, the public page `/{username}/church/give`, and the dashboard `GiftsPanel`.
- The Shop (`product_orders`, `customer_payments`, `commerce_sale_earnings`, `commerce_payouts`) and `src/lib/fapshi.ts` are **not modified**. Only the Fapshi adapter, the poll gate and the abuse limiter are imported.

## How a gift is made safe

1. The browser sends only fund, amount, payer phone/medium and what the donor chooses to share. Church, kind, rates, status and fee never come from it.
2. A gift is paid **only** after the server asks Fapshi for the transaction and is told `SUCCESSFUL`; settlement is one database function (claim + earning, atomic, idempotent). An amount mismatch goes to `payment_review`. A late confirmation of an expired attempt is honoured; a success after a recorded failure goes to a human.
3. Reconciliation: the donor's page and the dashboard "Check pending payments" button settle through the same path; the administrator sweep `/api/admin/church/gifts-reconcile` covers every church and lists gifts held for review and paid gifts without an earning.
4. Three independent keys must all agree before any gift can start: the application flag `GIVING_AVAILABLE`, the database function `church_giving_collection_open()` (and the platform switch behind it once activated), and the church's own `giving` feature plus an open, published fund.

## Known gaps (be aware before a pilot)

- **No automated church payout.** An owner requests a payout; a Ringo administrator pays it outside the app and marks it paid or rejected (`/api/admin/church/payouts/[id]`). There is no Fapshi disbursement send/check flow for churches yet, and no administrator screen: the administrator routes are JSON endpoints only.
- **No scheduled reconciliation.** The Vercel plan limits cron jobs, so no new cron was added. Reconciliation runs when a donor's page polls, when staff press "Check pending payments", or when an administrator runs the sweep. Run the sweep daily by hand (or add a scheduler) during the pilot.
- **Fapshi webhook not extended.** The existing `/api/billing/fapshi/webhook` is untouched; church gifts are confirmed by polling Fapshi's status endpoint, like the Shop.
- **Fapshi limits unverified:** the per-transaction maximum (code ceiling 1,000,000 XAF), whether the sandbox reports `amount` equal to the requested amount (the code treats a difference as `payment_review`), and refund support.
- **Nothing was tested against real Fapshi.** The tests use a recording double. Sandbox payments (success, failure, expiry, duplicate status checks) have NOT been run.

## Activation checklist (do not skip)

1. Run `2027-01-12_church_gifts.preflight.sql` on a **staging** copy, apply `2027-01-12_church_gifts.sql`, run the verify file (all rows true). Then the same on production when approved. The rollback file refuses to run once any financial record exists.
2. Configure Fapshi **sandbox** credentials on staging (`FAPSHI_ENV_CREDENTIALS_MODE=sandbox` for environment credentials) and run real sandbox payments: success, failure, user abandons then approves late, duplicate status checks, a status check while the prompt is still open, and compare the amount Fapshi reports with the amount asked.
3. Check Fapshi's maximum per transaction and whether it offers refunds; adjust `GIFT_MAX_XAF` and the wording if needed.
4. Decide how payouts are paid (manual for the pilot is supported) and how reconciliation is run.
5. Apply `supabase/support/2027-01-13_church_giving_activate.PROPOSED.sql` (still leaves collection closed), then **separately** `update public.platform_settings set church_giving_enabled = true;`, then flip `GIVING_AVAILABLE` to `true` and deploy.
6. Switch giving on for **one pilot church** only (its owner, under Features), open one small fund, and make a real small gift. Check: receipt, ledger, balance, an administrator sweep with nothing unaccounted for.
7. To stop at any time: `update public.platform_settings set church_giving_enabled = false;` (new gifts are refused at once; gifts in flight still settle).
