# Business Toolkit Phase 1 — Preflight Report

Date: 2026-09-30. **Nothing was applied.** All database access was read-only (SELECT/RPC of stable functions;
column names, counts and plan flags only). Migration: `supabase/migrations/2026-12-01_bookkeeping_foundation.sql`
(revision 2). Verification queries for the SQL editor: `supabase/support/2026-12-01_bookkeeping_foundation.preflight.sql`.

## 1. Repo vs live schema
- The repo declares **120 tables** (all `create table` in `schema.sql` + migrations); **all 120 exist live**. No
  repo-declared table is missing. (Earlier "PROPOSED, NOT APPLIED" headers, e.g. `customer_followups`, are stale.)
- Not observable through the API, therefore **unverified**: live-only objects not in the repo, live RLS policies,
  triggers, and exact column types/constraints. The preflight SQL covers what this migration depends on; run it.
- There is no `supabase/config.toml` or CLI history table in the repo: migrations are applied by hand in the SQL
  editor, so there is no migration-ordering engine to conflict with.

## 2. Filename / ordering
Names are this repo's own running sequence, not calendar dates: they already run to `2026-11-30_customer_followups.sql`
(git dates: Sept 2026). `2026-12-01_…` is the correct next slot; it is not an out-of-sequence future date.

## 3. Dependencies (all confirmed live)
Tables `profiles(id,user_id,currency,is_demo)`, `users(id,plan_id)`, `plans(id,name)`, `product_orders`, `orders`,
`music_orders` (each with `profile_id`). Roles `anon/authenticated/service_role` (used by every existing migration).
`is_admin()`, `has_org_permission()`, `is_org_member()` exist live but the migration **no longer uses any of them**
(owner-only policy uses `auth.uid()` directly). No new extension.

## 4. Review of every new object
| Object | Notes |
|---|---|
| `plans.business_toolkit_enabled` | Only change to an existing table. Added only if absent; seed (`business_basic`, `business_pro` = true) runs **only in the run that adds it**, so re-running cannot override an admin. Live plans: free, basic, pro, business_basic, business_pro, 3 association plans — the flag stays false on all but the two Business plans. |
| `bk_currency_digits()` | Immutable; list identical to `money.ts` (test-enforced). |
| `bk_entries` | `numeric(14,3)`, scale CHECK per currency (no silent rounding), `ON DELETE RESTRICT`, immutable via guard trigger, DELETE refused. |
| `bk_entry_events` | Append-only audit trail. |
| RLS | Owner-only SELECT on both tables. No client INSERT/UPDATE/DELETE grants. Staff permission strings are **not** honoured, and platform admins use the service role rather than RLS. |
| `bk_record_entry` / `bk_void_entry` | `security definer`, fixed `search_path`, service-role only; re-check owner + plan flag; refuse demo profiles; idempotent (`client_request_id`, void twice = no-op). |
| Rollback | Name-exact `drop … if exists bk_*` only, no `CASCADE`, in dependency order; the single non-bk statement is dropping the plans column (run only if no deployed code selects it). Tests enforce this. |

## 5. Risks found and how they are handled
1. **Demo cleanup cron deletes auth users → profiles.** `ON DELETE RESTRICT` could block it if a demo profile had
   entries. Mitigation: the RPC refuses demo profiles. Residual: manually deleting a *real* user with bookkeeping data
   will fail by design (financial history is protected); the preflight lists DELETE triggers on profiles/users.
2. **Multi-currency is real**: live profiles are 75 USD, 23 XAF, 2 EUR (Business & E-commerce ones: XAF and USD).
3. **Real data touched by the plan seed**: among live Business & E-commerce profiles, exactly one real (non-demo)
   account is on `business_pro` and would gain access when the category + plan checks pass; two demo accounts are on
   business_pro but demo profiles are refused.
4. Downgrade stops new writes (RPC plan check) but never deletes or alters history.

## 6. Applying without touching existing data
Single transaction; creates new objects only; the one `ALTER TABLE plans ADD COLUMN … DEFAULT false` is metadata-only
on current Postgres and rewrites no rows; the seed updates exactly the two Business plan rows, once. No existing row,
policy, trigger or function is modified. Re-running is a no-op (IF NOT EXISTS / guarded / `CREATE OR REPLACE`).
Execution status: at the time of this section the SQL had only been checked statically. It has since been executed on an
in-memory PostgreSQL 17 engine (PGlite) — see section 10. That is **not** Supabase: it has not been applied to, or run
against, any Supabase project (production or staging). Recommended before production: apply to a Supabase branch/staging
copy first, then run the bookkeeping RPC and route smoke tests there.

## 7. Currency precision findings
- `toCents` (×100 + `Math.round`) in `productCheckout/money.ts` is correct for that module (XAF whole francs stored as
  `numeric(12,2)`), but **not suitable for bookkeeping**: XAF has no cents, 3-decimal currencies (KWD, BHD, TND…) would be
  silently rounded, and it rounds instead of rejecting. It is left untouched.
- Bookkeeping now uses `src/lib/bookkeeping/money.ts`: integer **minor units per currency** (XAF/XOF/JPY 0, most 2,
  KWD/BHD/TND… 3) from an explicit table, exact decimal-string parsing, **no rounding** (excess decimals rejected),
  safe-integer overflow guard, max 9,999,999,999 major units. Totals are labelled `…Minor` with `minorDigits`.
- Revenue, cash flow, uncollected sales, unpaid expenses, stock purchases and profit are separate fields; profit is
  `unavailable` whenever goods are sold and cost of goods is unknown (and is always unknown until Inventory exists).
- Tests prove: float traps (0.1+0.2, 19.99, 1.005), XAF/USD/KWD totals, excess-precision rejection, SQL/TS table parity.

## 8. Timezone
Existing `dateRanges.ts` uses the viewer's browser-local time (unsuitable for server totals) and is untouched. Bookkeeping
uses `Intl` with `Africa/Douala` (no DST) through one set of helpers; the row-fetch window (`localRangeInstants`) and the
bucketing (`toLocalDateKey`) are tested to agree at every midnight boundary, including DST zones. **No `profiles.timezone`
column is needed** — none of the requirements needs a per-business zone yet.

## 9. Staging-validation pass (2026-09-30)
- **No staging exists.** The only Supabase project configured anywhere (`.env.local`, the sole environment file) is
  production; there is no branch, second project, Docker, `psql` or Supabase CLI, and
  `supabase/support/2026-11-02_product_checkout_foundation.verify.sql` already records "staging does not exist".
  **No SQL was executed against any database in this pass** (this pass was review only; the later PGlite pass in
  section 10 executed the SQL on an in-memory PostgreSQL engine). The SQL has still never been applied to, or run
  against, Supabase.
- Fresh-eyes review found and fixed in the migration: (a) `ON DELETE SET NULL` on `created_by`/`voided_by`/`actor_user_id`
  is an UPDATE that the immutability/append-only guards would reject — all foreign keys are now `RESTRICT`;
  (b) concurrent submissions of the same `client_request_id` could hit the unique index and return 500 — an advisory lock
  now serialises them so the loser returns the original entry; (c) a second manual sale for the same restaurant/music
  order surfaced as a raw unique-violation 500 — it now raises `order_already_counted` (409), with the index mapped as a
  backstop; (d) `cash_settled` was not type-checked (a string would reach Postgres) — now validated.
- Residual noted at the time (TRUNCATE by the table owner) was closed in the PGlite pass below; helper/trigger functions
  keep Supabase's default EXECUTE grants (harmless: `bk_currency_digits` is pure, trigger functions cannot be called directly).
- Plan gate impact (aggregate only): exactly **1** real account would gain access — a `business_pro`, XAF, active
  Business & E-commerce owner. 2 demo accounts on `business_pro` are refused by design; 1 real `business_basic`/`business_pro`
  account in another category gets nothing (category gate); 5 real Business & E-commerce accounts are on other plans and
  get nothing. Active staff memberships (1 overall) get no access (owner-only).

## 10. Isolated PGlite validation (2026-09-30)
Harness: `supabase/support/tests/bookkeeping_foundation.test.mjs` (run: `node supabase/support/tests/bookkeeping_foundation.test.mjs`;
setup: `npm install --no-save @electric-sql/pglite`, v0.5.8; `package.json` and `package-lock.json` verified byte-identical by SHA-256
before and after). It uses an in-memory PostgreSQL 17 engine only: no network, no `.env.local`, no Supabase. **PGlite is not Supabase
and this does not prove compatibility with the production schema.**

### 10.1 PGlite execution results — real PostgreSQL, the actual repo SQL files — 130/130
| Group | What was genuinely executed |
|---|---|
| Preflight (2) | The real preflight SQL runs on the pre-migration stand-in with every check ok, and its "absent" checks correctly flip after apply. |
| Apply (6) | Migration applies; re-applies cleanly; seed enables only `business_basic`/`business_pro`; re-run does **not** re-seed over an admin's change; no pre-existing table/column/policy/function/trigger/index/row changed (only `plans` gained the column). |
| Objects / grants (19) | Tables, functions, 4 triggers, 2 policies, RLS on, all 7 FKs `RESTRICT`, both unique indexes partial; RPC `EXECUTE` denied to anon/authenticated/PUBLIC and allowed to service_role; anon has no table privilege; authenticated has SELECT only; service_role has no TRUNCATE/REFERENCES/TRIGGER; TRUNCATE (incl. cascading from `profiles`) refused; definer functions pinned to `search_path`. |
| Access / plan gate (23) | Owner succeeds (currency from profile); another user, a staff-like user, an admin, a null actor, unknown profile, demo profile, Free-plan owner, NULL-plan owner, and an owner whose plan flag an admin switched off are all refused; voiding also refused when off; history stays readable; access returns when the flag returns. |
| Input (23) | Zero/negative/over-max/NULL amounts, XAF fractions, USD/KWD precision (10.50 ✓, 10.555 ✗, 10.5004 ✗ [would have rounded], KWD 1.234 ✓), impossible/future dates, bad kind, unsettled cash entries, long description, blank category; PostgreSQL's Douala day bucketing agrees with the JS helper. |
| Idempotency (4) | Same `client_request_id` → one row, `duplicate: true`, one audit event; a retry with a different body returns the original; independent per business; raw duplicate insert hits the unique index. |
| Links (8) | Second live manual sale for the same order refused (pre-check and index backstop); manual sale on a `product_order` refused (RPC and CHECK); expense links OK; another business's / unknown orders refused; re-recording allowed after voiding. |
| Void / replace / immutability / audit (14) | Reason required; non-owner refused; other business's entry reported not found; void is idempotent with no extra audit row; replacement voids the old entry atomically; a **failing replacement rolls back** (old entry stays live, no events); amount/date/owner/created_by updates and DELETE refused even for service_role; voided rows and audit rows immutable; every entry has a `created` event. |
| RLS (13) | Owner reads own rows; other users, staff-like users, admins and anon read nothing; direct INSERT/UPDATE/DELETE and RPC calls by `authenticated`/`anon` denied. |
| Deletion (6) | Deleting a real profile or user that has entries is blocked; history intact afterwards; a demo profile (never has entries) and an entry-less real user delete normally. |
| Summary (4) | Ordered LIMIT/OFFSET paging returns 2,500 rows exactly once; the JS summary over real PostgreSQL `numeric` text is exact (25,000.00 USD); the SQL timestamptz window and JS bucketing agree at both September boundaries. |
| Rollback / atomicity (8) | The documented rollback SQL (extracted from the migration file) executes, removes every `bk_*` object and leaves everything else **identical** to the pre-migration snapshot, and the migration re-applies afterwards; a migration run against a database missing `profiles` fails and leaves nothing behind after ROLLBACK. |

**Mutation proof that the suite can fail:** `MUT=open_read` (owner read policy opened, in memory only) → 5 expected failures;
`MUT=no_owner` (owner check removed from the RPC, in memory only) → 8 expected failures.

### 10.2 Defects found by executing the SQL (all fixed)
1. `service_role` still held `TRUNCATE`/`REFERENCES`/`TRIGGER`: Supabase's default privileges grant `ALL` on new public tables and the migration only revoked from anon/authenticated. Now revoked from `service_role` too, then only SELECT/INSERT/UPDATE/DELETE granted back; the earlier comment claiming otherwise was wrong.
2. `TRUNCATE` by the table owner was unguarded (row triggers do not fire on it): added `bk_truncate_guard()` + two statement-level triggers (rollback list updated).
3. `numeric(14,3)` silently rounded a longer amount (10.5004 → 10.500) before the scale CHECK, so a direct RPC caller could record a value never entered: `bk_record_entry` now refuses it (`amount_too_precise`, `invalid_amount` for NULL; both mapped to HTTP 400).
Test-harness issues fixed along the way (not product defects): the stand-in `plans` lacked columns the preflight reads; PGlite's session timezone inherits the host's (now pinned to UTC as on Supabase); substring-vs-regex assertion helpers.

### 10.3 Static checks (no database involved)
`scripts/tests/bookkeeping.test.mjs` — 156/156: migration text checks (only `plans` + `bk_*` altered, no drops before commit, owner-only policy, service-role-only RPC grants, rollback names only `bk_*` objects with no CASCADE, SQL/TS currency tables identical), route checks (authorise first, never read a business id from the client), access decision, money parsing, summary maths, time-zone windows.

### 10.4 Mocked / simulated
Route handlers and `resolveBookkeepingOwner` are **not** executed against PostgreSQL: the loader is tested against an in-memory PostgREST-style fake; HTTP mapping is checked statically. `auth.uid()` is a GUC set by the test; roles, default privileges, `users`/`plans`/`profiles` RLS and the order tables are stand-ins listed in the harness header (the `users`/`profiles` policies are copied from `supabase/schema.sql`).

### 10.5 NOT VERIFIED — requires real Supabase staging
Supabase's real roles/default privileges/ownership/event triggers; PostgREST parameter casting, error text→HTTP mapping (incl. the `bk_entries_one_live_sale_link_idx` text) and its 1000-row cap; JWT/`auth.uid()` and `auth.users` cascades; the actual production schema (live-only columns, constraints, triggers, policies); truly concurrent transactions (single connection here: the advisory lock runs, its serialisation is unproven); pooler behaviour; SQL-editor execution semantics; dangling-plan scenarios; performance at real volumes.

### 10.6 Regression results (baseline vs current)
Existing suites on a pristine checkout of `HEAD` (temporary worktree, removed afterwards) vs the current tree — identical, so nothing new was introduced:
`productCheckout` 290/293 and `shopSeller` 147/151 (**pre-existing** failures: stale "no schema/vercel.json/payout change" assertions), `subscriptionEntitlements` 53/53, `ringo_ai_foundation` (PGlite) 52/52. `tsc` clean, `next build` passes, `git diff --check` clean.

## 11. Final pre-commit fixes (2026-09-30)
- **R1 pagination (real defect, fixed):** the summary loader ended paging when a page returned fewer rows than requested. PostgREST's
  "max rows" project setting can be below the requested page size, so a short page is not the last page; against a source capped at
  300 rows the old logic returned 300 of 1,234 rows with no error. `fetchAllRows` now advances by the rows actually received and
  finishes **only** when a request returns no rows (the safety cap still throws). Regression tests cover server caps of 1000/999/500/300/1,
  an exact multiple of the page size, zero rows, offsets, the cap error, error propagation, and an end-to-end summary over a 300-row-capped
  source (exact totals; other business, other month, other currency, refunded order and the Douala midnight boundary all still excluded).
  The real PostgREST cap behaviour is still NOT VERIFIED against Supabase (section 10.5).
- **R2 accuracy (docs only):** removed the stale "PGlite is not installed" / "never run on real PostgreSQL" statements; the migration header now
  states that the no-silent-rounding guarantee applies to `bk_record_entry()` (and the route), and that a direct privileged INSERT bypassing the
  function is not protected against `numeric(14,3)` rounding of input with more than 3 decimals. No SQL behaviour changed.
- **R3 environment protection:** `.gitignore` now also lists `.env.staging`, following the file's existing style (explicit filenames,
  CRLF line endings; no wildcard), so `.env.example` stays tracked. No secret file was created, read or modified.

## 12. Not included (by your instruction)
No UI, navigation, translations, staff permissions, invoices, debts, reminders or inventory; nothing committed.
