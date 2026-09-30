# Business Toolkit — Phase 0 Audit

Date: 2026-09-30. Sources: the codebase at `main` (clean working tree) and a **read-only** probe of the live
Supabase database (column names and row counts only; no row values read or printed). Per the project's own
rule, the live database — not `supabase/migrations` — is the source of truth.

## 1. What already exists

| Area | Existing | Notes |
|---|---|---|
| Accounts / ownership | `users`, `profiles` (one per owner), `plans` | `profiles.currency` exists; **no timezone column**. `profiles.category/categories/subcategory` drive category features. |
| Team / staff | `organization_roles` (permissions `text[]`), `organization_members`, `organization_activity_log`; `has_org_permission()` (RLS), `getOrgAccess` / `requireOrgAccess(Json)` (server) | Owner/admin always pass. Plan gate is `plans.team_enabled` (Business plans). Permission catalog in `src/lib/team/permissions.ts` already has `sales.view`, `payments.view`, `reports.view`, `customers.view`. |
| Products | `products` (64 rows): `price`, `inventory_count` (**NULL = unlimited**), `available`, `product_type` (physical/digital), images, CTA | **No** cost price, SKU, barcode, reorder level, or variants. |
| Verified online sales | `product_orders` (+`product_order_items` immutable snapshots), `customer_payments`, `commerce_sale_earnings` | Fapshi-only, **XAF-only**, one product per order. Server-side settlement; status machine enforced by DB trigger; `paid` is trusted. Live: 2 rows each. |
| Escrow | Ringo Protection (`protection_*`), incl. stock lifecycle and refunds | 0 live rows. Must not be bypassed. |
| Other orders | `orders`/`order_items` (restaurant), `music_orders` | `payment_status` is only `unpaid`/`paid` and is **merchant/customer-declared** — weaker evidence than `product_orders.paid`. |
| Stock | `create_product_order` decrements atomically; `release_product_order_stock` returns stock exactly once (expired/cancelled) | Stock only moves for online checkout. No manual stock, no movement history. |
| Customers | `ringo_customers` (customer accounts, 10 rows), `restaurant_customers`, `music_customers`, order-level name/phone | No merchant-owned customer/contact book. No consent ledger except restaurant `customer_marketing_consent`. |
| Receipts | `product_orders` receipt page + email (`src/lib/productCheckout/receipt.ts`), `musicReceipt.ts`, receipt numbers `RCP-`/`RC-` derived from order number | Only **payment receipts for online orders**. No quotations, invoices, manual receipts. |
| PDF | `pdf-lib` + `qrcode`; one route: `api/music/orders/[id]/receipt-pdf` (A4, wrap/paging helpers) | Public-by-UUID posture. Reusable layout helpers are inline in that route, not shared. |
| Notifications | In-app `notifications` (`notifyUser`), web push, email (`sendEmail`, many `send*Email`, `email_delivery_logs`), Vercel crons (`vercel.json`) | **No SMS or WhatsApp sending.** WhatsApp exists only as click-to-chat links. |
| Reporting | `/dashboard/analytics`, `dateRanges.ts`, restaurant/music/shop "sales" pages | Browser-side date presets in local time. |
| Currency | `currency.ts` (`formatPrice` via `Intl`, XAF always listed), `productCheckout/money.ts` (integer-cents helpers) | DB money = `numeric(12,2)`. |
| i18n / AI | `translations.ts` (EN+FR, build fails if FR missing), Ringo AI knowledge modules/tools | Standing rules: every string bilingual; each feature gets an AI knowledge module. |
| Tests | Plain-Node scripts in `scripts/tests` (jiti, in-memory fakes); PGlite scripts in `supabase/support/tests` (PGlite was not installed at Phase 0; it is installed ad hoc with `npm install --no-save`, see the Phase 1 preflight doc §10) | `npm run build` / `tsc` are the other gates. |

**Genuinely missing (confirmed against the live DB):** bookkeeping entries, expense categories, debts/credit
sales/repayments, reminders log, stock movements, cost price/SKU/barcode/reorder threshold, quotations/
invoices/receipt documents and their numbering, business-owned customer records, report generation, and any
finance-related staff permission.

## 2. What can be reused

- Auth/ownership/staff: `getOrgAccess`, `requireOrgAccessJson`, `has_org_permission`, `resolveActiveOrganization`.
- Money: `toCents` / `centsToAmount` / `computeEarnings` style integer-cent arithmetic; `formatPrice`.
- Verified sales: `product_orders` (status `paid`/`fulfilled` + `paid_at`) read **through**, never copied.
- Immutable-snapshot pattern (`product_order_items` + guard trigger) for invoice lines.
- Server-only RPC pattern (`security definer`, `revoke … from public, anon, authenticated`, `service_role`).
- `pdf-lib` + the receipt-pdf layout code (to be factored into a shared helper **additively**, by copying, not editing the music route).
- Email (`sendEmail`, `emailShell`, `email_delivery_logs`) and `notifyUser` for reminders; cron pattern + `cronAuth`.
- Category mechanism (`profileHasCategory`, `CATEGORY_ROLE_TEMPLATES`).
- Test style and the in-memory-fake approach.

## 3. What requires extension (additive only)

- `PERMISSIONS` / `PERMISSION_GROUPS`: new `bookkeeping.*`, later `debts.*`, `inventory.*`, `documents.*` (EN+FR labels). Role templates for **existing** orgs are untouched; owners assign them.
- `products`: new nullable columns only (`cost_price`, `sku`, `barcode`, `low_stock_threshold`, `track_inventory`). Existing `inventory_count` semantics (NULL = unlimited) unchanged.
- `plans`: one new nullable/defaulted flag (e.g. `business_toolkit_enabled`), mirroring how `team_enabled` / `ai_enabled` were added. Needs your decision (see §7).
- Dashboard nav (`DashboardShell`), `translations.ts`, Ringo AI knowledge module/tools — new entries only.
- `profiles.timezone`: does not exist. Proposed default constant `Africa/Douala` in code; a column is a separate, optional migration.

## 4. Database structures to add (proposed, none applied)

| Phase | New objects |
|---|---|
| 1 Bookkeeping | `bk_entries`, `bk_entry_events`, RPCs `bk_record_entry`, `bk_void_entry` → **drafted**: `supabase/migrations/2026-12-01_bookkeeping_foundation.sql` |
| 2 Debt | `bk_customers` (merchant-owned contact book, optional link to `ringo_customers`), `bk_debts`, `bk_debt_payments` (idempotent by request id), `bk_reminders` (status + dedupe key), reminder settings |
| 3 Inventory | new nullable `products` columns; `stock_movements` (append-only, unique `(source_type, source_id, movement_type)` for exactly-once) |
| 4 Documents | `bk_documents` (quotation/invoice/receipt), `bk_document_lines` (immutable snapshots), per-business per-type counter row with atomic `update … returning` numbering |
| 5 Reports | none (computed server-side from the above + `product_orders`); optional stored-report table not needed |

## 5. Category-specific access

One shared module set; category decides **navigation and defaults**, not separate systems.

- Business & E-commerce: bookkeeping, debts, inventory, documents, reports.
- Restaurant, Beauty, Agriculture: bookkeeping, documents, reports, inventory **opt-in** per business (`track_inventory`), debts optional.
- Transport, Construction, Real Estate, Professional Services, Education, Events, Travel, Music: bookkeeping, debts/balances, documents, reports; **no inventory by default**.
- Gate = the org's plan flag (§3) **and** the staff permission. Server checks via `getOrgAccess`; RLS via `has_org_permission`. The client never supplies the organization id — it comes from the authenticated session/active org.
- Existing Shop section is **owner-only** (`requireShopProfile`); toolkit routes should use `requireOrgAccessJson`-style resolution so staff with permissions work, which is a deliberate difference.

## 6. Migration and data-integrity risks

1. **Double counting sales.** Mitigated by reading `product_orders` through (no copy, no trigger on an existing table) and refusing manual sales linked to a product order (DB CHECK + RPC + summary-level defence).
2. **Weak "paid" evidence** for restaurant/music orders (declared, not verified). Not auto-counted in Phase 1; if added later they must be labelled "marked paid by business".
3. **Live schema drift.** The migrations folder is incomplete; every migration needs a preflight against the live DB before you apply it.
4. **Stock exactly-once.** Existing reservation decrements at order creation; manual stock must not double-decrement those orders. Phase 3 needs an explicit rule for online orders (reuse existing reservation as the source of truth; movements log only manual events plus a read-only mirror).
5. **Currency.** Online checkout is XAF-only; toolkit must be per-profile currency, never mixing currencies in a total (summary excludes and reports mismatches).
6. **Timezone.** No profile timezone; auto-sales bucketing uses `Africa/Douala` unless told otherwise.
7. **Messaging/consent.** No SMS/WhatsApp integration exists; reminders ship as email/in-app + a manual "copy/open WhatsApp link" workflow, clearly labelled as not automatically delivered. Debt reminders are transactional, separate from marketing, and never reuse marketing-consent flags.
8. **Legal.** Documents must not claim tax certification; tax lines only when the business configures them.
9. **Retention.** All financial tables `ON DELETE RESTRICT`, append-only events, no deletes — profile deletion flows that cascade today would need to be checked against these before enabling.

## 7. Recommended order and decisions needed

Order: **1 Bookkeeping → 4 Documents (invoices/receipts, incl. shared PDF helper) → 2 Debts (+reminders) → 3 Inventory → 5 Reports/CSV → 6 category enablement**. Documents before debts because an invoice is the natural origin of a debt; reports last because they read everything.

Decisions for you:
1. Apply `2026-12-01_bookkeeping_foundation.sql`? (Needs a live preflight first; I have not run any SQL.)
2. Plan gating: new `plans.business_toolkit_enabled` column (recommended, matches `team_enabled`) vs. no gate initially?
3. Owner-only first, or also wire `bookkeeping.view/manage` staff permissions now?
4. Timezone: code default `Africa/Douala` (recommended) or a new `profiles.timezone` column?
5. Reminder channel for v1: email + in-app + manual WhatsApp link (recommended)?
