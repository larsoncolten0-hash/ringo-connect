# Ringo Smart Cards (QR) — production activation plan

**Status: PREPARED, NOT EXECUTED.** Nothing below has been run against production. The migration file existing in `supabase/migrations/` does **not** mean the production schema has changed.

| Item | State |
|---|---|
| Migration `2026-12-22_smart_card_claims.sql` | written, tested on a scratch PostgreSQL (PGlite). **Not applied anywhere** |
| `/c/[token]` page, claim API, claim screen, EN/FR copy, reserved username `c` | written, tested locally. **Not deployed** |
| Batch generator / importer scripts | written, run locally only (importer: dry run only) |
| Supplier package (QR images) | generated locally, **outside Git**. Do not print until every step below is done |
| Production import of 500 hashes | **pending** |

## Canonical domain (evidence, 2026-10-14)
`https://ringoconnectltd.com/` answers **308 Permanent Redirect → `https://www.ringoconnectltd.com/`**; the `www` host answers 200 (both served by Vercel). The QR codes therefore use `https://www.ringoconnectltd.com/c/<token>` (no redirect hop). The apex is never used. If you ever switch the Vercel primary domain, the printed codes keep working only while the old host still redirects.

## Order of operations (each step needs the owner's explicit approval)
1. **Review & commit** the code (owner). No data changes.
2. **Staging first** (a Supabase staging project / branch, never production):
   1. Apply `supabase/migrations/2026-12-22_smart_card_claims.sql`.
   2. Run the two-session concurrency check below.
   3. Import a *trial* batch (`generateBatch.mjs --count 30 --batch trial-001`, throwaway tokens) with `importBatch.mjs --execute`, deploy the app to a preview, scan a trial QR, sign in, claim it, scan again (redirects to the profile), try claiming with a second account (refused).
3. **Production migration**: apply the same SQL file (idempotent; creates two tables and four functions; touches no existing object). Take a Supabase backup/point-in-time marker first.
4. **Deploy** the app (the `/c/` route must be live before any card is printed or any QR is scanned by a customer).
5. **Production import** of the real 500 hashes:
   ```
   node scripts/smartcards/importBatch.mjs --file <PRIVATE_DO_NOT_SHARE>/import_batch-001.json                         # dry run: verifies format, 500 rows, uniqueness, numbering
   node scripts/smartcards/importBatch.mjs --file <...> --execute --confirm-count 500 --confirm-batch batch-001        # needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment
   ```
   The write is one call to `smartcard_import_batch`: all-or-nothing, idempotent (re-running skips identical rows), refuses and imports nothing if any serial or hash already exists with different data, and reports `batch_total`, which must be 500.
6. **Post-import checks** (read-only): `batch_total = 500`; all 500 `unclaimed`; scan 3 sample codes from the supplier files (first, middle, last) on two phones: each shows the claim page with the right serial.
7. **Release the supplier package** only after step 6 passes. Send it over a private channel (it contains live tokens).

## Concurrent-claim check (STAGING ONLY, on a throwaway trial card)
The in-memory test database has a single connection, so it cannot prove this. The Supabase dashboard SQL editor cannot hold a transaction open across two runs, so do NOT rely on "two editor tabs". Use the script, which fires every claim at the same moment from separate connections, as two different accounts:
```
node scripts/smartcards/generateBatch.mjs --out <new dir> --origin https://www.ringoconnectltd.com --batch trial-001 --count 30
node scripts/smartcards/importBatch.mjs --file <trial dir>/PRIVATE_DO_NOT_SHARE/import_trial-001.json --execute --confirm-count 30 --confirm-batch trial-001     # staging credentials in the environment
node scripts/smartcards/concurrencyCheck.mjs --manifest <trial dir>/SUPPLIER_PACKAGE/manifest.csv --serial RINGO-0001 --user-a <uuid> --profile-a <uuid> --user-b <uuid> --profile-b <uuid> --confirm-staging-host <staging host> --attempts 20 --execute
```
Pass criteria (the script prints PASS/FAIL for each): exactly ONE first-time claim wins; every attempt by the other account is `already_claimed`; no attempt errors. It refuses to run unless the confirmed host equals the target host, so check the host is the STAGING project. A manual alternative with two `psql` sessions: in each, `begin; select smartcard_claim(...)`; B must block until A commits, then return `already_claimed`.
Trial cards must never be mixed with the real batch: delete the staging trial rows afterwards (staging only).

## Verify the package before it leaves your machine (read-only, any time)
```
node scripts/smartcards/verifyPackage.mjs --dir <batch directory>
```
Re-reads the files on disk (not the generator's memory): 500 unique serials, URLs and tokens; every PNG **and** SVG decodes to the URL in its own manifest row; each import hash equals SHA-256 of that card's token; no token in the private folder or README. Run it again if any file is ever copied, edited or re-exported. If it reports any failure, do not print.

## Known behaviours to accept (or fix) before launch
* **Create account does not bring the customer back to the card.** "Sign in" returns to the card (`?next=`); "Create account" goes to `/get-started`, which has no return path, so a brand-new customer re-scans the card after signing up. Acceptable for launch; say so in the card insert ("after creating your account, scan the card again").
* **Rate limiting trusts the first `x-forwarded-for` address.** Correct on Vercel (the platform sets it); would be spoofable on a host that appends client-supplied values.
* **The QR URL is public once printed.** Whoever holds an unclaimed card can claim it: the card's physical possession is the proof of ownership. Ship cards in sealed packaging and keep the supplier package confidential until the order is complete.
* **Live today:** `https://www.ringoconnectltd.com/c/<anything>` returns 404 until the app is deployed with this change, so the deploy (step 4) must precede any scan, print or customer delivery.

## Rollback / recovery
* **Before activation (nothing claimed):** `drop` statements at the bottom of the migration file remove everything; no existing data is involved.
* **After activation:** do not drop. Disable instead: `update ringo_smart_cards set status = 'disabled' where serial = 'RINGO-0042';` (a disabled card becomes indistinguishable from an unknown one). To release a card claimed by mistake, an owner-run SQL `update ... set status = 'unclaimed', claimed_by_user_id = null, profile_id = null, claimed_at = null where serial = '...'` (not possible through the app or any client role).
* **Bad batch imported:** rows with `batch = 'batch-001'` and no claims can be deleted by the owner in SQL, then re-imported. Never delete claimed rows.
* **Lost / leaked token file:** a leaked supplier package means anyone could claim an unclaimed card first. Mitigation: disable the affected serials and re-issue them as a new batch (new tokens, new hashes, same serials are *not* reused: use a new serial range).

## Token handling
* Raw tokens exist only inside the generated QR images / supplier manifest (the supplier needs them to print). They are 160-bit CSPRNG values.
* The database stores **only SHA-256 hashes**; the import file contains hashes only. The generator never prints a token.
* The `/c/` path is `no-store`, `noindex`, `no-referrer`, not framable; the page, API and logs never record the token; the rate limiter stores a keyed hash of the caller, never an address.
* Keep `<out>/PRIVATE_DO_NOT_SHARE/` and `<out>/SUPPLIER_PACKAGE/` out of Git (they are created outside the repository).
