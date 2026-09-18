# Provenance: `2026-10-14_association_foundation.sql`

**This document is documentation only. It contains no SQL and changes no database.**

## What this is

`2026-10-14_association_foundation.sql` is the **preserved Phase A source artifact** of the
Ringo Association Program: the migration that introduced `association_categories`,
`associations`, `association_staff`, the nullable `association_id` compatibility columns on the six
legacy Association tables, the backfill, the six `trg_sync_association_id` triggers,
`ensure_association_for_profile`, `sync_association_id`, `reconcile_association_links` and the two
Association-scoped RLS helpers.

The `.sql` file is stored **byte-for-byte as it existed when it was approved and run**. It has not
been edited, reformatted or regenerated for this archive. Its own header still reads
"FINAL - FOR REVIEW, NOT EXECUTED" because that was its state when it was written; that wording is
part of the preserved artifact and is not an execution record.

**SHA-256 of the preserved file (LF line endings):**

    60238518d13886c119cfa20cfc40e06d4b6bcecf40ad82f2e99e8f8c68d9eea9

## Filename date versus execution date

The `2026-10-14` prefix exists **only to order this file after the last existing migration
(`2026-10-13_demo_accounts.sql`)**, following this repository's `YYYY-MM-DD_name.sql` convention.
It is **not** the date the migration was executed. **No execution date is recorded here and none
should be inferred.** This project applies migrations manually through the Supabase SQL Editor, so
the repository has no automatic execution record.

## What is and is not proven

The SQL was run manually in the Supabase SQL Editor after being copied from a review document.

- **Byte-for-byte identity between the text that was pasted and this file CANNOT be proven.**
  This document does not claim it.
- **Executable and structural equivalence of the live database to this file WAS independently
  verified after execution**, using read-only catalog checks:

| Check | Result |
|---|---|
| Function attributes (arguments, return type, language, security definer, volatility, pinned `search_path`) for the five Phase A functions | match |
| Function EXECUTE grants (PUBLIC/anon/authenticated revoked as designed) | match |
| The six `trg_sync_association_id` triggers (timing, events, columns, function); no other non-internal trigger on those tables | match |
| Columns, types, nullability and defaults of the three new tables; the six `association_id` columns | match |
| PK / UNIQUE / FK constraints including FK delete actions; CHECK constraints | match (22 of 22 rows PASS in the corrected verifier) |
| Named indexes, RLS flags, policies, table privileges, no PUBLIC grant | match |
| No unexpected Association-named tables or functions | match |
| Category seed rows (12) | match |
| Data invariants: no NULL or wrong `association_id`, no Association profile without an Association, owner `super_associate` present, member balances equal ledger, total balance equals total ledger, configs still `{}` | all PASS |
| Legacy functions (`log_association_earn`, `log_association_redeem`, `is_association_owner`, `is_association_partner`) equal to the repository migration `2026-09-18`; earn and redeem contain no exception handler | 6 of 6 PASS |

Two entries in the first verification run failed and were understood, not waved through:

- **P07 (14 rows):** a bug in the verifier, not the database. For PRIMARY KEY / UNIQUE constraints
  `pg_constraint.confrelid` is OID 0, which `regclass` renders as `-`; the verifier's
  `coalesce(...)` therefore never matched. After correcting only that normalization, all 22 P07
  rows passed.
- **P02 (5 rows):** the byte-level function-body comparison failed for all five functions. A
  diagnostic classified every one as **`CR_ONLY`**: identical to the preserved bodies once carriage
  returns are removed. The live bodies contain CRLF line endings where the preserved file has LF
  (7, 104, 9, 56 and 26 carriage returns, i.e. one per line boundary). **No executable or semantic
  difference was found.**

## Consequences for future work

- Treat this file as the **verified Phase A baseline**. Do not edit it. Any change to that schema
  belongs in a new, later migration.
- Function bodies in the live database carry CRLF line endings. A byte-level comparison against
  this LF file will always report `CR_ONLY`; compare after normalizing line endings.
