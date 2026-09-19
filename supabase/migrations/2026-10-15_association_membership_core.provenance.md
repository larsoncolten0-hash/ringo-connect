# Provenance: `2026-10-15_association_membership_core.sql` (Association Program, Phase B1)

**This document is documentation only. It contains no SQL and changes no database.**

## What this is

`2026-10-15_association_membership_core.sql` is the archived source of **Phase B1: Membership Core**:
the three new tables (`association_membership_plans`, `association_memberships`,
`association_audit_log`), the read-only view `association_memberships_effective`, the additive
columns `association_members.lifecycle_state` / `lifecycle_changed_at` and `associations.membership_seq`,
the lifecycle and points guard triggers, and 11 `SECURITY DEFINER` RPCs executable by `service_role` only.
It adds no payment column and no payment engine.

Its two companion scripts are stored outside `migrations/` so they can never be run as a migration by accident:

| File | Purpose |
|---|---|
| `supabase/support/2026-10-15_association_membership_core.verify.sql` | one read-only SELECT; the post-migration verification |
| `supabase/support/2026-10-15_association_membership_core.rollback.sql` | technical rollback; refuses if any membership data exists |

**SHA-256 (LF line endings):**

    migration  9a09b77ba49d34b602d3d1884a6f46124eda4455e21c538e200ec3eb21f2414e
    verify     8592640c9ec91c48e8369d2d05b90cef514f6f8565d5192859bec95836b92904
    rollback   6f18c2bd646c7e11a84fc6fe7a6a109337c4a4371ed8a2b9fb2961dc314a86b1

## Deployment and live verification

- B1 was **deployed successfully** to the live Supabase database, run manually in the SQL Editor.
- The live **post-migration verification returned 64 PASS / 0 FAIL** (INFO rows excluded).
- The **9 existing members remained legacy** (`lifecycle_state` NULL, "0 managed of 9").
- **Membership remained OFF by default** (0 Associations with Membership enabled).
- **No plans, memberships or audit rows were created by the deployment** (0 / 0 / 0), and `membership_seq` is 0 everywhere.
- **Points balance and ledger integrity remained at zero drift** (no member with balance different from its ledger; total balance minus total ledger is 0), and `reconcile_association_links(false)` reports 0 gaps.
- Live catalog checks also confirmed: the exact trigger sets; plan and renewal foreign keys are NO ACTION and deferred while every foreign key to `associations` cascades; the new tables are SELECT-only for `authenticated` and `service_role`; all 11 RPCs are `service_role`-only with a pinned `search_path`; the internal helpers and guards are executable by no API role; `log_association_earn` / `log_association_redeem` kept their unchanged shape; legacy table privileges are unchanged.
- **Owner-identity trust** (the lifecycle and points guards treat `current_user` = table owner as internal): the owner of `association_members` is `postgres`, none of `anon`, `authenticated`, `service_role` or `authenticator` is or can become it, all B1 functions and earn/redeem are owned by it, and the only public functions that mention `points_balance` are earn and redeem.
- During execution one script reported a deadlock error (`40P01`). A deadlock aborts and rolls back the losing transaction; the final live state was then checked with the verification script above.

## What is and is not claimed

- **No execution date is recorded and none should be inferred.** The `2026-10-15` filename prefix only orders this file after Phase A (`2026-10-14`), following the repository's `YYYY-MM-DD_name.sql` convention. This project has no automatic migration record.
- **Byte-for-byte identity between the SQL that was pasted into the SQL Editor and the archived file has NOT been proven and is not claimed.** What was proven is the executed result: the live catalog and data checks above passed against this migration's expected end state.
- The **rollback script has never been run** (live or otherwise except on a scratch database). The **trust probe** used during review is not archived because it was not part of the deployment.
- The scratch-database test suite (130 checks on PostgreSQL 18) ran only on a scratch database. It is not in the repository.

## Known limits (unchanged by B1)

- **Legacy members** (`lifecycle_state` NULL) can still have `points_balance` written directly by their Owner (`association_members owner all` RLS) or by `service_role`. B1 changes no existing policy or privilege and does not close that path.
- For **managed members**, a balance change requires both an owner-role write (the earn/redeem definer functions) and an effectively active term. A direct owner-role SQL session is trusted by design.
- `association_expire_memberships` exists but nothing schedules it in B1; security does not depend on it.
