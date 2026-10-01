# Business Toolkit — Phase 2: Invoices & Professional Receipts

Audit date: 2026-10-01. Status: **architecture locked, nothing implemented.** No migration has been written or applied;
no application code, payment logic or Phase 1 object has been changed. Phase 0 (`business-toolkit-audit.md`) and Phase 1
(`business-toolkit-phase1-preflight.md`, commit `c5a5591`, production migration applied) are complete and are not redone here.

## 1. Scope

**In scope:** seller-issued **invoices**; **receipts** for seller-recorded invoice payments; a professional **PDF** for those
documents; a **PDF for existing platform (shop) receipts**; private customer sharing of issued documents; bookkeeping
integration through the existing Phase 1 functions.

**Rejected / deferred (approved decisions):**
| Item | Decision |
|---|---|
| Online payment of invoices | **Deferred.** No change to `customer_payments` target constraints, Fapshi settlement, checkout or the `onOrderPaid` hook. |
| Quotations (UI/workflow) | **Not built.** Schema stays generic enough to add the type later by an additive change. |
| Credit / debt management | **Phase 3.** Phase 2 only supports invoice balances and payments. |
| Extra PDF library, `fontkit`, font files | **Not added.** Standard fonts only; English/French (Latin-1/WinAnsi). |
| Tax | **Optional, OFF by default**, configurable label + rate. No claim of tax certification or legal compliance. |
| Second customer-facing number for platform receipts | **Rejected.** The existing `RCP-` number stays the only one. |
| Bookkeeping entry when an invoice is issued | **Rejected.** An invoice is not revenue or proof of payment. |
| Bookkeeping entry for platform receipts | **Rejected.** Phase 1 already counts verified paid `product_orders` by read-through. |

## 2. Existing systems inspected (summary)

- **Invoices:** none exist. No tax/VAT/discount/billing-address model anywhere; profiles hold no address, tax ID or registration number.
- **Receipts:** three independent systems — Shop (`product_orders`, `RCP-`, public page + JSON + send-once email, no PDF), Music/tickets
  (`RC-`/`ORD-`, page + the only PDF route + email), Restaurant (print view + email, no number). Receipt numbers derive from global
  bigserial order numbers (not per business).
- **Payments:** Shop checkout is Fapshi-only, XAF-only; `initiatePayment` → `customer_payments` (`external_id` `pp-…`, `provider_transaction_id`)
  → `checkProductPayment` (asks Fapshi, never trusts the client) → `settleProductPayment` (claims payment, verifies profile/amount/currency,
  guarded order transition to `paid`, one earning row, one-time `onOrderPaid` side effects). Stripe is used only for Ringo's own plan
  subscriptions and card bundles. Music/restaurant `payment_status` is declared, not verified.
- **Order data (immutable):** `product_orders` totals and `product_order_items` snapshots are guarded by triggers; `customer_payments` has no client grant.
- **PDF tooling:** `pdf-lib` + `qrcode`; one route (`api/music/orders/[id]/receipt-pdf`) with inline paging/wrapping helpers. Standard Helvetica
  **throws** on French-locale money (`12 000 FCFA` contains U+202F), on non-Latin-1 names (Yoruba/Arabic/CJK) and on emoji; it encodes accents, `’` and `œ`.
- **Phase 1:** `bk_entries` (immutable, voidable), `bk_entry_events`, `bk_record_entry` / `bk_void_entry` (owner + plan flag + demo checks, currency from
  `profiles.currency`, idempotency key), `bk_currency_digits`, `plans.business_toolkit_enabled`. `bk_entries.linked_order_type` is restricted to three
  order types, so invoice links must live on the Phase 2 side.
- **Other reusable pieces:** `getShopOrderReceiptData`, `getSellerOrderDetail`, `formatProductReceiptNumber`, Phase 1 `money.ts` / `decision.ts` / `access.ts` /
  `http.ts`, `renderReceiptEmail`, `SectionTabs`, bilingual `translations.ts`, HMAC/hash helpers. The existing `commerce_rate_limit_hit()` **whitelists four
  checkout kinds**, so it cannot be reused for share links without modifying an existing function; Phase 2 adds its own small limiter.

## 3. Approved architecture

Two sources of receipts, not one chain:

- **A. Platform checkout (prepaid):** `Order → verified Payment → Receipt (derived)`. No invoice. No stored document. No bookkeeping entry.
- **B. Seller-issued:** `Invoice → Payment(s) recorded by the seller → Receipt per payment`. A quotation may later precede the invoice.

**Sources of truth:** for A, `product_orders` / `customer_payments` (untouched). For B, the Phase 2 document tables; the accounting effect is exactly one
Phase 1 `sale` entry per recorded payment, written in the same transaction.

**Honesty rule:** a receipt for a seller-recorded payment states "payment recorded by the business"; only platform receipts rest on a verified payment.

### 3.1 Tables (all new; no existing table is altered)

All money columns are `numeric(14,3)` with a scale CHECK against `bk_currency_digits(currency)` (same guarantee as Phase 1). Every foreign key is `ON DELETE RESTRICT`.
Every table has RLS enabled, owner-only SELECT, and **no DML grant to any client role**.

**`bk_business_profiles`** — document identity; one row per business. Fields that `profiles` cannot safely supply (its `about_*` fields are public-profile content
and must not change a printed invoice when someone edits their bio).
`profile_id` PK → `profiles`; `display_name` (1–120, required); `legal_name` (≤160); `address` (≤300); `phone` (≤40); `email` (≤200); `tax_id` (≤60);
`registration_no` (≤60); `default_terms` (≤1000); `default_due_days` (0–365); `tax_label` (1–30) and `tax_rate_bp` (0–10000, basis points) — both null or both set
(null = tax OFF); `created_at`, `updated_at`, `updated_by`. Editable (it is settings, not history); documents snapshot it at issue.

**`bk_documents`** — generic header.
Identity: `id` PK; `profile_id`; `doc_type` ∈ (`invoice`,`receipt`); `status` ∈ (`draft`,`issued`,`partially_paid`,`paid`,`void`); `locale` ∈ (`en`,`fr`); `currency` (fixed at creation).
Numbering: `number`, `number_year`, `number_seq` — all null until issued. Format `INV-2026-0001` / `RCT-2026-0001`.
Dates: `issue_date` (server date at issue; **no backdating**), `due_date` (invoices only, ≥ issue date), `created_at`, `updated_at`, `issued_at`, `issued_by`, `created_by`.
Snapshots (frozen at issue): `seller_snapshot jsonb`, `customer_snapshot jsonb` (name required, phone/email/address/tax id optional), `type_snapshot jsonb` (receipts: payment method, reference, paid date, balance after, invoice number).
Totals: `subtotal`, `discount_total`, `tax_label`, `tax_rate_bp`, `tax_total`, `total`, `amount_paid` (invoices).
Text: `notes` (≤1000), `terms` (≤1000).
Relations: `parent_document_id` (receipt → invoice), `replaces_document_id` (correction chain), `source_type` ∈ (`product_order`) + `source_id` (reserved; **unused in Phase 2**).
Integrity: `template_version` (≥1), `content_hash` (sha-256 hex, set at issue), `client_request_id` (draft-creation idempotency).
Void: `voided_at`, `voided_by`, `void_reason` (1–300).

Key constraints: `total = subtotal − discount_total + tax_total`; `discount_total ≤ subtotal`; `0 ≤ amount_paid ≤ total`; number triple and `issued_at` are all-null or all-set, and `number` equals its formatted parts;
invoices: `issued ⇒ amount_paid = 0`, `partially_paid ⇒ 0 < amount_paid < total`, `paid ⇒ amount_paid = total > 0`, `void ⇒ issued_at is null or amount_paid = 0`;
receipts: status ∈ (`issued`,`void`) and a parent; invoices have no parent; `voided_at` set iff `status = 'void'`; `content_hash` set iff issued.
Keys/indexes: `unique (profile_id, id)` (target of composite foreign keys, so a document can never reference another business's document);
`unique (profile_id, doc_type, number_year, number_seq)` and `unique (profile_id, doc_type, number)` (partial: number not null — voided documents keep their number);
`unique (profile_id, client_request_id)` (partial); `unique (replaces_document_id)` (partial, non-void); `unique (profile_id, doc_type, source_type, source_id)` (partial, non-void);
lookup indexes on `(profile_id, status, created_at desc)`, `(profile_id, doc_type, issue_date desc)`, `(parent_document_id)`.

**`bk_document_lines`** — `id`; `document_id` → `bk_documents`; `position` ≥ 1 (unique per document); `description` (1–300, a snapshot); `quantity numeric(12,3) > 0`; `unit_price ≥ 0`;
`gross_amount`; `discount_amount` (0…gross); `tax_amount`; `line_total = gross − discount + tax`; `product_id uuid` (traceability only — **no foreign key**, so the product can change or
disappear without touching history; ownership verified at save). Editable only while the parent is a draft; frozen otherwise. Max 100 lines per document.

**`bk_document_counters`** — `(profile_id, doc_type, year)` PK; `last_number ≥ 0`. Incremented only inside `doc_issue` / `doc_record_payment` by
`insert … on conflict do update … returning`; the row lock serialises concurrent issuers and a rollback undoes the increment. Trigger allows only `+1`. Drafts never touch it. Year = business-local (`Africa/Douala`) year of issuance.

**`bk_document_payments`** — `id`; `profile_id`; `invoice_id`; `receipt_document_id` (unique); `bk_entry_id` (unique → `bk_entries`); `amount > 0`; `currency`; `method` ∈
(`cash`,`mobile_money`,`bank_transfer`,`card`,`other`); `reference` (≤100, seller-entered); `paid_on` (issue date … today); `balance_after`; `client_request_id` (**required**, unique per business); `created_by`, `created_at`;
`voided_at`, `voided_by`, `void_reason`. Composite FK `(profile_id, invoice_id)` and `(profile_id, receipt_document_id)` → `bk_documents (profile_id, id)`. Immutable except the one-time void fields.

**`bk_document_events`** — append-only, enumerated types only: `created`, `issued`, `payment_recorded`, `payment_voided`, `voided`, `replaced`, `share_created`, `share_revoked`. Columns: `id`, `document_id`, `profile_id`, `event_type`, `actor_user_id`,
`details jsonb` (size-capped), `created_at`. Update/delete/truncate refused. Views and downloads are deliberately not logged.

**`bk_document_shares`** — `id`; `document_id`; `profile_id`; `token_hash` (sha-256 hex of a server-generated 32-byte token; **the raw token is never sent to or stored in the database**); `expires_at` (default 14 days, max 90);
`revoked_at`, `revoked_by`; `created_by`, `created_at`; `last_accessed_at`; `access_count`. Max 5 active per document. Owners may select every column except `token_hash` (column-level grant).

**`bk_document_rate_events`** + **`bk_doc_rate_limit_hit()`** — a copy of the proven `commerce_rate_limit_hit` design (keyed-hash subject, advisory lock, self-pruning) with its own kind whitelist (`share_ip`). New objects; the existing limiter is untouched.

### 3.2 State machines

**Invoice:** `draft → issued`; `draft → void` (discard; consumes no number); `issued → partially_paid | paid | void`; `partially_paid → partially_paid | paid | issued`; `paid → partially_paid | issued` (only by voiding a payment); `void` is terminal.
`issued/partially_paid/paid` is **derived from `amount_paid` by the functions and enforced by CHECKs**, so the stored status can never disagree with the amounts. An invoice can be voided only when `amount_paid = 0` (void its payments first).
**Overdue is calculated, not stored:** `status ∈ (issued, partially_paid) ∧ due_date < today (Africa/Douala) ∧ balance > 0`. Storing it would need a cron and would conflict with partial payment.
**Receipt:** created directly as `issued`; `issued → void` only as a side effect of voiding its payment (never directly).
**Payment:** `recorded → voided` (one way).
**Correction:** void the wrong invoice, then create a new draft with `replaces_document_id`; issuing it writes a `replaced` event on the old one.

### 3.3 Functions (all service-role only; `security definer`, `set search_path = public, pg_temp`)

Every function begins with a shared gate `bk_doc_gate(profile, actor)` that performs exactly the Phase 1 checks: profile exists, **not a demo profile**, actor **is the owner**, owner's plan has `business_toolkit_enabled`; it returns the profile currency (server-authoritative, never from the client).
Lock order is always **request advisory lock → invoice row → counter row → bookkeeping**, to avoid deadlocks.

| Function | Responsibility |
|---|---|
| `doc_upsert_business_profile(profile, actor, display_name, legal_name, address, phone, email, tax_id, registration_no, default_terms, default_due_days, tax_label, tax_rate_bp)` | Create/update settings (validated; tax pair all-or-nothing). |
| `doc_save_draft(profile, actor, document_id?, doc_type='invoice', locale, customer jsonb, due_date, notes, terms, tax_enabled, lines jsonb, replaces_document_id?, client_request_id)` | Create (idempotent on request id) or fully replace a **draft** invoice; validates lines, verifies any `product_id` belongs to the business, computes every line and total in SQL (exact, half-up), stores them. Refuses non-drafts. |
| `doc_issue(profile, actor, document_id)` | Lock draft; currency must still equal the profile's; ≥1 line, total > 0, customer name present; build `seller_snapshot` (business profile, falling back to profile name/username); counter → number; `issue_date = today`; `content_hash`; status `issued`; event `issued` (+ `replaced` on the replaced invoice). Already issued → returns it unchanged. |
| `doc_record_payment(profile, actor, invoice_id, amount, method, reference, paid_on, client_request_id)` | See 3.4. |
| `doc_void_payment(profile, actor, payment_id, reason)` | Lock invoice + payment; call `bk_void_entry`; mark payment voided; void its receipt; recompute `amount_paid`/status; events. Already voided → no-op. |
| `doc_void_document(profile, actor, document_id, reason)` | Invoice/draft only; requires `amount_paid = 0`; receipts rejected ("void the payment"). Idempotent. |
| `doc_create_share(profile, actor, document_id, token_hash, expires_in_days)` | Issued, non-void invoice/receipt only; ≤5 active; event. |
| `doc_revoke_share(profile, actor, share_id)` | Idempotent; event. |
| `doc_resolve_share(token_hash)` | Public-route helper: valid (exists, not revoked, not expired) → returns document/profile ids and records access; otherwise a uniform "not found". No owner check (the token is the capability). Shared documents stay reachable after a plan downgrade (history is never hidden). |
| `bk_doc_hash(document_id)` | Recomputes the canonical hash from current rows for tamper checks. |
| `bk_doc_compute_line(qty, unit_price, discount, rate_bp, digits)` | The one rounding rule (see 3.5). |
| `bk_doc_rate_limit_hit(kind, subject_hash, window, max)` | Share-endpoint limiter. |
| **Not created:** `doc_issue_platform_receipt` | Not required (section 4). |

### 3.4 `doc_record_payment` — the critical function
One function body = one transaction. Steps: gate → advisory lock on `(profile, request id)` → return the existing payment if the request id was seen (**idempotent, never re-enters bookkeeping**) → lock the invoice → must be `issued`/`partially_paid`,
same business, **currency equals the invoice's and the profile's**, amount > 0 with valid scale and **≤ remaining balance**, `paid_on` between issue date and today → allocate the receipt number → insert the **receipt** document (single line "payment towards invoice X", `type_snapshot`, hash) →
insert the **payment** row → call the existing **`bk_record_entry`** (kind `sale`, settled, `entry_date = paid_on`, category `invoice_payment`, description = invoice number only — **no customer name in bookkeeping**, request id = the new payment's own id, which cannot collide with any manual entry) →
store the returned entry id → update the invoice `amount_paid`/status → write events. Any failure anywhere raises and **everything rolls back**, so a payment without its bookkeeping entry (or the reverse) cannot exist. No second accounting system: the only ledger stays `bk_entries`.
Invoices cannot reference a platform order in Phase 2, so a platform-paid order can never be paid or counted twice.

### 3.5 Exact arithmetic
Per line: `gross = round_half_up(quantity × unit_price)` to the currency's decimals; `discount` ≤ gross (fixed amount, line level only); `net = gross − discount`; `tax = round_half_up(net × rate_bp / 10000)` when tax is on; `line_total = net + tax`.
Document totals are sums of stored line values (no further rounding). SQL computes and is authoritative; `src/lib/documents/totals.ts` mirrors it for previews using `BigInt(...)` calls (the project target is ES2017: no `n` literals), with a SQL↔JS parity test.

## 4. Platform receipt strategy

**No persistent `bk_documents` row is required.** Keep platform receipts **derived**, from the existing verified data, through the existing readers:
- same `RCP-` number, no second number, no bookkeeping entry, no change to settlement;
- `product_orders` and its items are already immutable snapshots, and the payment and status are already stored, so a stored copy would add no accuracy — only a second thing to keep in sync and a second security surface;
- the existing public receipt page already renders live seller details; a stored PDF snapshot would diverge from it;
- one shared renderer serves both sources through a neutral `DocumentModel` (built from a stored document or from platform data).

Delivery: a **customer "Download PDF"** button on the existing receipt page, backed by a public route with the **same unguessable-id posture and the same customer-safe fields** as the page (no phone, no email, no provider reference; Protection fee line and "total paid" when a protected order). Seller access only through an **authenticated owner route** using `getSellerOrderDetail`.
Residual trade-off (needs approval, decision D1): seller identity on an old platform receipt PDF follows the seller's *current* name/business details, exactly as the existing page does; a frozen identity would require the lazy stored-document option (`source_*` columns are reserved for it).

## 5. PDF architecture (`src/lib/documents/`, no new dependency, music route untouched)

`pdfText.ts` (safe text) · `money.ts` (formatting) · `totals.ts` (exact maths) · `numbering.ts` (formatter mirrored by SQL) · `snapshot.ts` (pure `DocumentModel` builders) · `labels` (EN/FR in `translations.ts`) ·
`pdf/layout.ts` (cursor, wrapping, paging) · `pdf/templates/v1/*` (invoice, receipt) · `pdf/render.ts` (dispatch by `template_version`; an unknown version is an error, never a silent different layout).

- **Safe text:** NFC-normalise; typographic quotes/dashes → ASCII; U+00A0 / U+202F / U+2009 → space; keep everything WinAnsi can encode (Latin-1, `’ œ Œ € … • ™`); otherwise strip combining marks (`Ọ → O`); remove emoji/ZWJ/variation selectors/control chars; leftover → `?`; hard length caps; final `try/catch` fallback to ASCII so **drawing can never throw**. A property test covers the whole code-point range.
- **Money:** built from integer minor units by string grouping (no float); French `12 000 FCFA` / `1 234,50 USD`, English `FCFA 12,000` / `USD 1,234.50`; XAF prints `FCFA`; other currencies print their ISO code; all spaces ASCII.
- **Layout:** width-based wrapping (`widthOfTextAtSize`), long unbroken tokens hard-broken, address capped at 6 lines with `…`, description/name caps, table header repeated on each page, totals block kept together, "Page x / y" on a second pass, receipts also print the parent invoice's lines.
- **Filename** restricted to `[A-Za-z0-9._-]`. No remote images (no SSRF); no logo in V1.
- **Versioning:** `template_version` is stored at issue and old layouts are kept, so re-download reproduces the original look from the stored snapshot.

## 6. Security design

- **Owner access:** owner-only; business always resolved from the session (never a client id); plan flag + category + demo checks, re-checked inside every function. Staff are not admitted (as Phase 1); `bookkeeping`/`documents` staff permissions are a later, separate migration.
- **RLS:** enabled everywhere; owner-only SELECT policies (`profiles.user_id = auth.uid()`); `bk_document_counters` and `bk_document_rate_events` readable by no client role. **No client INSERT/UPDATE/DELETE.** All writes go through the functions; `service_role` is given SELECT only (stricter than Phase 1), so even a leaked service key cannot edit rows directly — only call the guarded functions.
- **Isolation:** composite foreign keys enforce same-business parent/replacement/payment/share/event references in the database; functions re-verify; tests run two businesses.
- **Immutability:** issued headers and lines are frozen by guard triggers; payments and shares mutate only their void/revoke/access fields; events append-only; `TRUNCATE` and `DELETE` refused (draft lines are the only deletable rows); `content_hash` + `bk_doc_hash()` detect tampering (integrity evidence, not legal certification).
- **Share links:** server-generated 32-byte random token, only its SHA-256 stored; expiry, revocation, ≤5 active; uniform "not found" for bad/expired/revoked tokens; keyed-hash IP rate limiting on the public endpoints (60 requests / 10 minutes per caller; **fails closed**: if the limiter cannot answer, the request is refused — unlike the checkout limiter, because here refusing costs nothing).
  Response headers on share pages and PDFs: `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff`, metadata `robots: { index: false, follow: false }`.
- **Public vs private:** invoices and seller-issued receipts are **never public by id**. Existing public platform receipts keep their current behaviour and fields; Phase 2 must not add personal data to them.
- **Privacy:** customer details are stored only in the owner-visible snapshot; bookkeeping descriptions carry the invoice number, not the customer. Financial retention means voiding, not erasing.
- **Payments untouched:** no change to RLS, constraints, or settlement on any existing payment table.

## 7. Migration design principles

File (proposed, **not created**): `supabase/migrations/2026-12-02_documents_invoices_receipts.sql` (next in the repo's running sequence), with `supabase/support/2026-12-02_documents_invoices_receipts.preflight.sql` and `supabase/support/tests/documents_foundation.test.mjs`.
Additive only; **no existing table altered** (not even `plans` — it reuses the Phase 1 flag); one transaction; `IF NOT EXISTS` / `CREATE OR REPLACE` / guarded policies; triggers dropped and recreated only on new tables; no `CASCADE`; all FKs `RESTRICT`; explicit `REVOKE ALL` then minimal `GRANT`;
RLS on; guards + truncate guards as in Phase 1; name-exact rollback limited to new objects; preflight requires the Phase 1 objects (`bk_entries`, `bk_record_entry`, `bk_void_entry`, `bk_currency_digits`, `plans.business_toolkit_enabled`) to exist, all Phase 2 objects to be absent, and built-in `sha256(bytea)` to be available (no extension needed).
Validated first on PGlite (migration, re-run, preflight, rollback, atomicity, RLS, grants), then a safeguarded production run — same workflow as Phase 1; PGlite is not Supabase, so the Supabase-specific items remain explicitly "not verified" until the production boundary checks.

## 8. Eventual files

**New:** the migration, preflight and PGlite test above; `src/lib/documents/*`; `scripts/tests/documents*.test.mjs`; API routes under `src/app/api/documents/*`, `src/app/shop/orders/[id]/pdf` and `src/app/dashboard/shop/[id]/pdf` (outside every protected checkout directory); dashboard pages under `src/app/dashboard/documents/*`; share pages under `src/app/d/[token]/*`; `src/lib/ai/knowledge/modules/documents.ts`.
**Small additive edits:** `src/lib/i18n/translations.ts` (new bilingual `documents` block), `ShopOrderReceiptView.tsx` (Download PDF button), `ShopOrderDetail.tsx` (seller receipt PDF action), dashboard navigation, the Ringo AI knowledge index.
**Will NOT be modified:** `src/lib/productCheckout/*` (including `settlement.ts`, `constants.ts`, `rateLimit*`), `customer_payments` and every payment/earnings/protection table and function, `commerce_rate_limit_hit`, `product_orders` / `orders` / `music_orders` and their items, the music receipt PDF route and `musicReceipt.ts`, all Phase 1 files and the Phase 1 migration, `plans`, Fapshi/Stripe code, authentication.

## 9. Decisions (all resolved by the approval of 2026-10-01)
D1 platform receipts stay **derived** · D2 prefixes `INV-` / `RCT-` · D3 **no backdating** (issue date = server date) · D4 seller PDF for platform orders follows **existing Shop visibility/ownership**, not the toolkit flag ·
D5 `service_role` holds **SELECT only** on the new tables. Also locked: stored text is kept **exactly** (UTF-8) and only the PDF renderer falls back; no quotation workflow; no online invoice payment; Phase 3 owns credit/debt.

## 10. Implementation status (2026-10-01) — built locally, NOT applied, NOT committed

**Foundation (built earlier):** `src/lib/documents/*` (constants, numbering, exact totals, safe PDF text, money/date formatting, snapshot builder, PDF layout, template v1, renderer), the bilingual `documents.pdf` labels,
the proposed migration `supabase/migrations/2026-12-02_documents_invoices_receipts.sql`, its preflight, and the PGlite tests.

**Phase 1 guard (added):** `POST /api/bookkeeping/entries/[id]/void` now refuses (409 `entry_linked_to_invoice_payment`) to void an entry referenced by `bk_document_payments`, via `src/lib/bookkeeping/invoicePaymentGuard.ts`.
It runs after authorization and before the RPC, fails closed on an unexpected error (500), and fails open only when the Phase 2 table does not exist yet. Unrelated entries are voided exactly as before; the Phase 1 migration is untouched.
`doc_void_payment` remains the controlled way to void an invoice payment together with its entry.

**API (added):** `src/lib/documents/{handlers,validation,http,routeKit,actions,uiErrors,access}.ts` and `src/app/api/documents/**`:
`business-profile` (GET/PUT), `/` (GET list, POST create draft), `[id]` (GET, PUT draft, DELETE = discard draft), `[id]/issue`, `[id]/void`, `[id]/payments`, `[id]/pdf`, `payments/[paymentId]/void`.
Every write goes through a controlled `doc_*` function with the OWNER's own profile and user id from the session (never from the request); reads use the owner-scoped client with explicit profile filters.
The issue call carries no body: number, date, totals, snapshots and hash all come from the database. Database refusals map to precise statuses (`docError`); a missing Phase 2 migration is a clean 503 `documents_unavailable`.
Owner PDFs are regenerated from the stored snapshot and refused if the stored content no longer matches its issue-time hash. All responses carry `no-store`, `no-referrer`, `noindex`, `nosniff`.

**Dashboard (added):** `/dashboard/documents` (invoice list with status filters and state-aware actions), `new`, `[id]/edit` (draft editor, also used to start a corrected invoice from a voided one via `?correct=<id>`), `[id]` (invoice detail and payment-receipt view),
`settings` (business-document identity). Components in `src/components/documents/`. All text is bilingual (`documents.ui` in `translations.ts`). The "Invoices" nav entry appears only for the owner's own entitled profile (category, plan flag, not a demo) and only once the Phase 2 tables exist.
The UI never writes to the database directly, never posts a total, number or date, and describes payments only as "recorded by the business".

**Share links (added, increment 3):** `src/lib/documents/{shareToken,shareConstants,publicShare,publicHeaders}.ts`; owner API `GET|POST /api/documents/[id]/shares` and `POST /api/documents/shares/[shareId]/revoke`; public `GET /d/[token]` (HTML, server component, no script, no account) and `GET /d/[token]/pdf`.
Token = 32 CSPRNG bytes (base64url, 43 chars); the database receives only its SHA-256 (`doc_create_share`), the URL is returned once and never again, the list shows state/expiry/views only. The public side calls only `bk_doc_rate_limit_hit` and `doc_resolve_share`, then reads the shared document filtered by the share's own business and id;
unknown, revoked, expired, malformed, draft, unreadable or integrity-failed all produce the same 404 page/body (429 only when rate limited). Headers: `no-store`, `no-referrer`, `noindex`, `nosniff`, `X-Frame-Options: DENY` (route + `next.config.js` `headers()` for `/d/:path*`). The `/d/*` path is public (the middleware matcher covers only `/dashboard` and `/admin`;
usernames have a 3-character minimum, so none can be `d`). The owner UI is `ShareModal.tsx` (create with 1–90 day expiry, copy, native share sheet, per-link state, revoke); nothing is sent automatically. `documentActions` gains a `share` flag (issued / partially paid / paid, incl. receipts).

**Shop receipt PDF (added, increment 3):** `src/lib/shopReceiptPdf/render.ts` renders an EXISTING `RCP-…` receipt (data from the unchanged `getShopOrderReceiptData`) with the shared `Sheet` foundation; `src/lib/shopReceiptPdf/access.ts` holds the access logic;
routes `GET /shop/orders/[id]/pdf` (same posture as the receipt page: the unguessable order id) and `GET /dashboard/shop/[id]/pdf` (signed-in owner, `shopIsVisibleFor`, owner-scoped ownership read, seller match). Only a receipt with a succeeded payment has a PDF. Read-only: no `bk_documents` row, no number, no bookkeeping entry; not gated on the Business Toolkit.
Buttons: `ShopReceiptPdfButton` in `ShopOrderReceiptView` (customer) and `ShopOrderDetail` (seller). No checkout, settlement, `customer_payments`, `commerce_sale_earnings`, `onOrderPaid` or receipt-reader file is modified.

**Ringo AI (added, increment 3):** `src/lib/ai/knowledge/modules/documents.ts` (id `invoices`, status `partial` until rollout, then flip to `live`), registered in the existing registry, plus one navigation-map entry. Its `live()` tells the model whether the Phase 2 tables exist on this platform. No tool, diagnostic or prompt change.

**Deliberately NOT built:** quotations, online invoice payment, automated WhatsApp/SMS/email, staff permissions, recurring invoices, supplier/purchase orders, debt workflows.

Results (all local; PGlite is not Supabase): `documents.test.mjs` 136, `documentsApi.test.mjs` 173, `documentsUi.test.mjs` 72, `bookkeeping.test.mjs` 188 (includes 17 new guard tests that run the real void route), PGlite Phase 2 272/272 and Phase 1 130/130.
The screens have NOT been exercised in a browser (no DOM tests, and running the app would use the production environment file).

**Residual risks and limits (not hidden):**
1. **Not verified (PGlite is not Supabase):** Supabase's real roles/privileges/ownership, PostgREST behaviour (JSON embedding, `customer_snapshot->>name` select alias, row caps), JWT/`auth.uid()`, the production schema, **true concurrency** (numbering relies on the counter row lock and advisory locks), pooler behaviour, SQL-editor semantics, performance.
2. The API reads (`bk_documents` etc.) rely on PostgREST exposing the new tables after the migration; `NOTIFY pgrst, 'reload schema'` may be needed.
3. Standard PDF fonts: non-Latin scripts print as `?`, emoji are dropped (stored data is unaffected). English and French render correctly.
4. Receipts for seller-recorded payments are labelled "Payment recorded by the business"; nothing claims tax certification or legal compliance.
5. The client-side totals in the editor are an estimate; the saved, numbered and printed amounts are always the database's.
