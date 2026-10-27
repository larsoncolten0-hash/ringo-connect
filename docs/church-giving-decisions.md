# Church giving and care funds: decisions still open

Status: **collection of money is OFF.** This document is for the Ringo Connect owner. Nothing here has been decided on your behalf. The "proposal" under each decision is a starting point to react to, not a rule that was built.

## What exists today (Phase 7, safe part)

- `church_giving_funds` (migration `2027-01-10_church_giving.sql`, **not applied**): the definition of a fund a church wants to raise money for. A giving fund (offerings, a project) or a care fund (help for people in need), with a bilingual title and description, an optional goal in XAF, a status (`draft` or `closed`) and a published flag.
- A church staff member holding `church.giving.manage` (owner-only to grant) writes the funds at `/dashboard/church/giving`.
- Collection is closed in two places: the handler refuses `status: "open"` (409 `giving_unavailable`), and the database trigger refuses it too, because `church_giving_collection_open()` returns `false`. The owner's `giving` feature switch cannot be turned on while `GIVING_AVAILABLE` is `false` in `src/lib/church/features/handlers.ts`.
- The owner's `giving` feature switch is also locked in the database by `2027-01-11_church_giving_lock.sql`: no writer, the service role included, can set `church_features.giving = true` while `church_giving_collection_open()` is false.
- There is **no** amount received, donor, payment, receipt, refund or payout anywhere in the church tables. A fund is never linked to a named person's care case, so money can never identify a person in need.
- The Shop ledger (`product_orders`, `customer_payments`, `commerce_sale_earnings`, `commerce_payouts`), `platform_settings` and Fapshi code were **not changed**.

## The five decisions

### 1. Ringo's percentage

The Shop takes a rate stored in `platform_settings.commerce_commission_rate` and snapshots it on every sale (`commerce_sale_earnings.commission_rate`).

- Question: does Ringo take a percentage of church gifts, and is it the same as the Shop rate?
- Proposal: **0% on care funds and a separate, explicitly set rate (possibly the Shop rate) on giving funds.** Needs its own platform setting so the Shop rate does not silently apply to gifts. The rate is snapshotted per gift, like a sale.
- Needed from you: the number for giving funds, and the number for care funds.

### 2. Who pays Fapshi's fee

- Question: is the Fapshi fee taken from the church's share, added on top for the giver, or absorbed by Ringo?
- Proposal: **deducted from the church's share and shown to the giver before they confirm** (no surprise charge on top). The Fapshi limits already modelled in `src/lib/ambassador/fapshiLimits.ts` give minimum and maximum gift sizes.
- Needed from you: the choice, and the minimum gift in XAF.

### 3. Receipts

- Question: does a giver get a receipt, who issues it, and does it name the church?
- Proposal: **an emailed or in-app receipt from Ringo for every confirmed gift**, listing church, fund, amount, fee, date and reference, reusing the Shop receipt pipeline (`shopReceiptPdf`, `2026-11-04_shop_receipt_notifications.sql`). No tax-deduction wording until you have confirmed what the law in each country allows. Anonymous giving means the church sees no name; Ringo still keeps the payer reference.
- Needed from you: whether receipts are mandatory, and whether a giver may give anonymously to the church.

### 4. Refunds

- Question: can a gift be refunded, by whom, and until when?
- Proposal: **no self-service refunds; a giver can ask within a short window (for example 48 hours), the church owner or Ringo admin approves, and the reversal follows the existing earnings status path (`recorded` to `reversed`)** so the church balance never goes negative silently. Fapshi's own refund capability must be checked first.
- Needed from you: yes or no, the window, and who approves.

### 5. Closing a care fund early

- Question: when a care fund is closed before its goal, what happens to the money already given?
- Proposal: **the church owner may close a fund at any time; the money collected goes to the church as paid out, never back to givers, and the fund's description must say so before anyone gives.** If you prefer, a care fund could instead require a stated purpose and the owner's written confirmation at closing.
- Needed from you: where the money goes (church, refund to givers, another fund), and whether closing needs Ringo review.

## Ledger reuse design (not built)

When the decisions are made, a later phase would add, without changing the Shop:

1. `church_gifts`: one row per gift (fund, church, amount, fee, commission snapshot, status, Fapshi reference), written only by the server, never by an API role.
2. Payment: the existing Fapshi checkout and webhook path (`customer_payments`, `src/lib/fapshi.ts`, `src/lib/fapshiSafety.ts`), with the same idempotent claim used for Shop orders.
3. Church balance: a church-side earnings table shaped like `commerce_sale_earnings` (gross, net, rate snapshot, `recorded | requested | paid | reversed`) with the same only-status-may-change guard, paid out through the existing payout request flow.
4. A new migration replaces `church_giving_collection_open()` and flips `GIVING_AVAILABLE`.
5. A visitor route, a public giving card, receipts and a reconciliation report.

## Activation checklist (do not skip)

1. You answer the five decisions above in writing.
2. The financial migration is reviewed with preflight, verify and rollback files, then applied by you.
3. A test run with real Fapshi sandbox payments: success, failure, duplicate webhook, refund, early closure.
4. Only then change `GIVING_AVAILABLE` to `true` and replace `church_giving_collection_open()`.
5. Switch it on for one pilot church first.
