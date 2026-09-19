# Association / demo-flag test scripts

Plain Node scripts. They are **not** part of the application build and add **no dependency** to `package.json`.
Both run entirely on an in-memory scratch PostgreSQL (PGlite) and never connect to Supabase or any real database.

Setup, once (nothing is written to `package.json` or the lockfile):

    npm install --no-save @electric-sql/pglite

| Script | What it proves |
|---|---|
| `profiles_demo_flag_guard.adversarial.mjs` | Applies the real `2026-10-16_profiles_demo_flag_guard.sql` and its verification and rollback scripts, then attacks `profiles.is_demo` / `demo_expires_at` as `authenticated`, `anon`, profile owners, Organization staff and the bypass routes, and checks that `service_role`, normal editing, signup, demo creation, seeding and cleanup are unaffected. |
| `partner_demo_security.mjs` | Runs the real `demo-lookup`, `invitations`, `search-profile`, earn, redeem and Membership-admin route handlers against an in-memory data layer, plus the real legacy RLS policies, the real B1 migration and the real earn/redeem functions on scratch PostgreSQL: demo-window rules, cross-Association and privacy boundaries, Partner attribution, and that protected files are unchanged. |

Run from the repository root:

    node supabase/support/tests/profiles_demo_flag_guard.adversarial.mjs
    node supabase/support/tests/partner_demo_security.mjs

Set `PGLITE_ENTRY` to use a PGlite install elsewhere. `partner_demo_security.mjs` also supports a `MUT` environment
variable that breaks one check in memory only (never on disk), to prove the tests can fail.
