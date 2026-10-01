# Business Toolkit Phase 5 — Reports & Monthly PDF Export (+ bookkeeping entries screen)

Status: implemented on `feat/business-toolkit-reports-phase5` (based on Phase 4, `4bd6b2e`). **No migration.** Nothing here writes to the database.

## What it adds
- **Reports** (top-level Business Toolkit nav entry, owner-only, same gate as Invoices/Inventory):
  - `/dashboard/reports`: monthly report. Month/year selector; opens on the last completed month; the current month is offered as "month to date". No custom range, no CSV.
  - `/dashboard/reports/entries`: bookkeeping entries screen (create, history, void) on the **existing** Phase 1 endpoints, plus one new read-only list route `GET /api/reports/entries` (kept under the new reports namespace so no existing bookkeeping API file or folder is touched).
- `GET /api/reports/monthly?year&month` (JSON) and `GET /api/reports/monthly/pdf?year&month&lang=en|fr` (PDF, generated per request, never stored, private no-store headers, no public link).
- Both routes call the same builder, `src/lib/reports/build.ts` (`buildMonthlyReport`), so screen and PDF cannot disagree. A 12-character reference (hash of the figures) is printed on both.

## Source of truth (no second ledger)
| Report figure | Source |
|---|---|
| Revenue, expenses, cash, uncollected, voided/currency/double-count exclusions | `bk_entries` through the existing pure `summarize()` (Phase 1) |
| Invoice payments | the `bk_entries` sale created by each payment (category `invoice_payment`); **issuing an invoice is never revenue** |
| Online sales (gross) | `product_orders` paid/fulfilled with `paid_at` in the month (Cameroon time: the app-wide Africa/Douala zone, no DST) |
| Platform commission, net earnings | `commerce_sale_earnings` of exactly those orders (reversed or missing earnings are left out and counted) |
| Top Shop products | `product_order_items` of the counted orders (name snapshot survives product deletion) |
| Invoices issued in the month | `bk_documents` (informational, not revenue) |
| Receivables, inventory | `doc_receivables_summary`, `inv_overview`: **as of the generation date**, not month-end |

## Rules
- Profit is **not reported** (cost of goods is not recorded). **Net cash movement = money recorded as received directly (invoice payments, manual sales and other income marked received, cash in) − money recorded as paid out (expenses marked paid, cash out).** Online sales are **not cash**: customers pay Ringo checkout, Ringo keeps its commission and owes the seller the net (`commerce_sale_earnings` recorded/requested = owed, paid = paid out by a payout). They are reported as earnings with a paid-out / not-yet-paid-out split and never enter net cash movement; a payout the seller records as `cash_in` counts on the date entered. Net cash movement is never called profit.
- Online sales are shown gross; commission and net are separate; gross is not money received by the business.
- A refunded order is excluded from sales. There is no refund timestamp, so it is shown only as "paid this period, currently marked refunded".
- Voided entries are excluded and counted. Records in another currency are excluded and counted (never added in).
- Reports are live: regenerating a past month reflects later voids/refunds.
- Inventory value is informational only.

## Tests
`scripts/tests/reports.test.mjs` (period, builder rules, handlers, PDF, routes/security, entries screen, EN/FR, protected paths), `scripts/tests/reportsAi.test.mjs` (AI knowledge). No SQL test is needed: no SQL was added.
