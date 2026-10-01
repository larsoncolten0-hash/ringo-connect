# Business Toolkit Phase 4 — Inventory & Stock Control

Status: implemented, **not committed, not applied**. Migration: `supabase/migrations/2026-12-04_inventory_stock_control.sql`
(preflight and verify in `supabase/support/`).

## Locked decisions (summary)
- The live balance stays `products.inventory_count` (NULL = untracked / unlimited). No second balance.
- Tracking is explicit per product (`bk_stock_settings.active`). Existing counts are adopted by the seller, never automatically; adopting keeps the number; starting from NULL needs an opening quantity.
- Reservation model is unchanged: stock is taken at Shop order creation and returned by the existing release lifecycle. Inventory only reads it: **Reserved** = awaiting_payment with stock not released; **Sold** = paid/fulfilled since tracking started.
- Quantity + optional informational unit cost (profile currency). Estimated value is not an accounting valuation (no FIFO / average cost).
- Invoices, credit sales and invoice payments never change stock; the seller records them as `sold_elsewhere`.
- Refund restock is manual, refunded Shop orders only, partial allowed, capped at ordered − already restocked, atomic and idempotent. Refund and payment code is not touched.
- Stop tracking (with confirmation) makes the product unlimited again; the ledger is kept.
- Default low-stock level 5, per product, editable. No low-stock email/SMS/WhatsApp.
- Scope: Business & E-commerce, physical products only, owner only, plan flag `business_toolkit_enabled`, never demo profiles.

## Database objects (all new)
Tables `bk_stock_settings`, `bk_stock_movements` (owner-read RLS, no client write grants, append-only ledger with a balance_before/after chain, no foreign key to products so history survives deletion).
Functions (service_role only): `inv_start_tracking`, `inv_adjust_stock`, `inv_set_stock_count`, `inv_return_restock`, `inv_stop_tracking`, `inv_update_settings`, `inv_overview`, `inv_product_detail`, `inv_refunded_orders`; helpers/guards `bk_stock_clean_text`, `bk_stock_settings_guard`, `bk_stock_movements_guard`, `bk_products_stock_guard`.
One trigger on an existing table: `bk_products_stock_guard_trg` (BEFORE UPDATE OF inventory_count on `products`).

## The `inventory_count` protection
For a **tracked** product, an UPDATE made by an ordinary browser session (`authenticated` / `anon` role) that changes `inventory_count` keeps the old value; the rest of the row still saves and no error is raised (so the editor's save-all never fails). Untracked products behave exactly as before. `service_role` (checkout reserve/release, server code) and the Phase 4 functions are not affected. The editor additionally shows the count read-only for tracked products and omits it from its save payload.

## Mutation and concurrency
Every controlled operation locks the product row, updates the count with a guarded `UPDATE … WHERE count + delta >= 0` and inserts the ledger row in the same transaction. Negative stock is impossible; concurrent requests serialize on the row. Idempotency: `client_request_id` unique per profile; a replay returns the original result (HTTP 200) and changes nothing.

## Rollback
The migration ends with a documented rollback block (drops the products trigger and guard first, no CASCADE, nothing pre-existing altered). Re-applying afterwards is supported (tested on PGlite).

## Limits and known items
- Music merchandise, restaurant stock and ticket capacity are out of scope; the existing music merch race is deliberately not fixed here.
- A late payment after a released reservation remains a manual seller decision.
- Drift (count changed outside the tools, e.g. direct SQL) is shown as a warning, best effort.
- The Phase 3 verify script error (`relation "a" does not exist`) is a separate cleanup item; the Phase 4 verify script avoids aliased VALUES inside privilege functions.

## Tests
`supabase/support/tests/inventory_foundation.test.mjs` (PGlite, real checkout functions), `scripts/tests/inventory.test.mjs` (application layer, routes, UI/editor static checks, EN/FR, protected paths), `scripts/tests/inventoryAi.test.mjs` (AI knowledge).
