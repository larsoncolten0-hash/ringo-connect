# Business Toolkit Phase 6 — Customers (directory, profile, possible Shop orders)

Status: implemented on `feat/business-toolkit-customers-phase6` (based on Phase 5, `dc38209`). **No migration. Nothing here writes to the database.**

## Architecture
The Business Toolkit customer is `bk_customers` (Phase 3), the business's own contact book. Phase 6 adds read-only screens on top of it; no new table, no change to the Phase 3 data model.

| Concept | Where | Phase 6 |
|---|---|---|
| Ringo customer identity | `ringo_customers` | Never read |
| Business customer relationship | `bk_customers` | **The customer** |
| Buyer / order record | `product_orders` | Read-only source of *suggestions* |
| Invoice customer | invoice snapshot + `bk_document_customer_links` | Through the existing Phase 3 statement |
| Community subscriber | `community_subscribers` | Never read |

## What it adds
- **6A Directory** `/dashboard/customers` (top-level nav, owner-only like Invoices/Inventory/Reports): server-side search (name, normalised e-mail, normalised phone), Active/Archived/All, 25 per page (max 50), deterministic order (name, id), `has_more`. Create goes through the existing `POST /api/receivables/customers`, archive through `.../[id]/archive`. `Debtors → Contacts` is unchanged (same customer book).
- **6B Profile** `/dashboard/customers/[id]`: the existing Phase 3 statement (`contactStatement`) reused unchanged, per-currency derived totals, an activity timeline, edit/archive/pause through the existing endpoints.
- **6C Possible matching orders** (loaded on request): Shop orders sharing a normalised phone or e-mail with the customer. Suggestions only.

## Routes (all GET, owner-gated, private no-store)
`GET /api/customers?q&status&limit&offset` · `GET /api/customers/[id]` · `GET /api/customers/[id]/possible-orders`

## Search safety
The term is reduced to letters, digits, space and `' @ + . -` (everything else dropped, minimum 2 characters, maximum 80) before it is placed in an `or(...)` of at most three `ilike` clauses. The mandatory `profile_id` filter is a separate AND, so no term can widen the scope. Hostile terms are fuzz-tested.

## Financial rules (unchanged from Phases 1–5)
- Invoiced / "Payments received" come from the invoices' `total` and `amount_paid`; payment rows are history only and never added to `amount_paid`. Outstanding and Overdue are the statement's own figures. Per currency, never mixed. "Payments received" is not revenue and creates no bookkeeping entry.
- The statement returns at most 200 invoices and 500 payments; reaching a limit is disclosed (older records are not in the figures).
- Possible orders are never in a total, a balance, a report or bookkeeping.

## Possible-order matching
The contact's stored `phone_normalized` / `email_normalized` against the order's phone (normalised in Node by a port of `bk_norm_phone`, proven equal to the SQL on PostgreSQL) and e-mail. Phone matches scan the 1,000 most recent orders (disclosed when full); e-mail uses one exact query over all orders. Names are never used as a key. Ambiguity is shown, not hidden: the order's other key belongs to a different customer (active or archived), several buyer names behind one phone or one email, a key shared with another active or archived customer. A contact without a phone runs no phone scan and gets no phone-window warning; e-mail matching is unaffected. The order's `customer_id`, note and delivery details are never selected.

## Not in V1
Ringo-account linking, `ringo_customers` / `customer_connections` / sessions, loyalty, marketing consent, messaging, community merging, export, segmentation, persistent order links, cross-category history.

## Tests
`scripts/tests/customers.test.mjs`, `scripts/tests/customersAi.test.mjs`, `scripts/tests/customersNormParity.test.mjs` (PGlite; adds no SQL).
