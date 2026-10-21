# Custom profile addresses (`name.<profile domain>`)

Status: **code only. Not live.** Nothing here is active until every step under "Activation checklist" is done.

## Who can use it
**Paid plans only** (`basic`, `pro`, `business_basic`, `business_pro`: the app's existing `isPaidPlan`), on an active (not suspended) account.
- The dashboard section is hidden for Free users, and hidden entirely until the profile domain is configured.
- The hiding is cosmetic. Every API call (read, check, save) re-reads `users.status` and the plan joined through `users.plan_id` from the database with the service role and answers `403 plan_required` for anyone else. Nothing about the plan comes from the request.
- The middleware checks the same rule on every request to an address, so a downgrade takes effect immediately.
- "Expired" follows the app's existing rule: a Fapshi plan keeps its paid `plan_id` through the grace period; the daily `downgrade-expired` cron moves it to Free, and from then on the checks above fail. Up to one cron cycle can pass between the end of the grace period and the actual downgrade; the rest of the app (public profile entitlements) behaves the same way.

## How it works
- Customers claim a name in the dashboard editor ("Custom profile address"). Claims and changes go through the SQL function `claim_profile_subdomain()`: one transaction, advisory locks on the name and on the profile, then the rules below.
- `src/middleware.ts` looks at the request `Host`. Only a host that is a single label under `NEXT_PUBLIC_PROFILE_DOMAIN` is treated as a profile host.
  - `name.<domain>/` is rewritten internally to `/<username>`, so the existing profile page, visibility, publication and suspension rules apply unchanged.
  - Static assets, the profile's manifest and `POST /api/track` are served as is.
  - Dashboard, admin, auth, other API, webhook, payment, order and other system routes answer 404.
  - Other public pages (`/<username>/book`, `/<username>/shop`, other profiles ...) redirect to `NEXT_PUBLIC_SITE_URL` (configured, never built from the Host header).
  - Unknown, unclaimed, unpublished or malformed names answer one identical bare 404. A suspended owner is a 404 too. `www` and the bare domain redirect to the main site.
- Canonical URLs stay on the main domain (`ringoconnectltd.com/<username>`), so the two addresses never compete in search. `ringoconnectltd.com/<username>` keeps working exactly as before.

## Changing a name, downgrades, reuse (behaviour)
- A paid customer can change their name any number of times, to any available name. Their profile content is never touched: the address is a separate row pointing at the profile.
- **Old name:** it is not deleted and not instantly free. It moves to `profile_subdomain_retired` and is **reserved for 90 days**: nobody else can claim it, the previous owner can take it back at any time, and until the reservation ends `old.<domain>` **redirects (307) to the owner's current address** (built from the stored, validated label and the configured domain only). After 90 days the reservation lapses and the name is free for anyone; the reservation row is removed when the name is reclaimed or claimed again. Reason: printed cards and shared links to the old address must not start showing a stranger's page.
- **Impersonation:** a name equal to another profile's *username* cannot be claimed by anyone but that profile. Reserved system names (`www`, `admin`, `api`, `billing`, `stripe` ...), look-alike punycode (`xn--`), double hyphens and anything outside `a-z 0-9 -` are refused.
- **Downgrade / expiry:** the stored address is kept (subscription controls access, never data). While the owner is not on a paid plan the address stops being served and visitors are forwarded (307) to the same profile on the main site (`/<username>`); the claim/change API answers `403`. Upgrading again brings the same address back.
- **Concurrency:** two requests for one name are serialized by the function; the `UNIQUE` constraint is the last word and a loser gets `409 taken`.

## Configuration
`NEXT_PUBLIC_PROFILE_DOMAIN` (e.g. `ringo.page`). Empty/unset/invalid = feature off. Build-time value: changing it needs a redeploy.

## Activation checklist (do in this order)
1. Ringo owns the domain (registrar account in Ringo's name).
2. In Supabase run `supabase/support/2026-12-25_profile_subdomains.preflight.sql` (all `ok = true`), apply `supabase/migrations/2026-12-25_profile_subdomains.sql`, then run `...verify.sql` (all `ok = true`). Rollback: `...rollback.sql` (drops the function and the two new tables only).
3. Vercel project > Settings > Domains: add `ringo.page` **and** `*.ringo.page`. A wildcard domain requires Vercel nameservers for the domain (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`) so Vercel can issue the wildcard certificate; or, if keeping external DNS, add the `_acme-challenge` TXT record Vercel shows.
4. If not using Vercel nameservers: DNS `A  @  76.76.21.21` and `CNAME *  cname.vercel-dns.com` (use the values Vercel shows for the project).
5. Set `NEXT_PUBLIC_PROFILE_DOMAIN=ringo.page` in Vercel (Production) and redeploy.
6. Verify on production: claim a name on a paid test account, open `https://name.ringo.page`, confirm `https://name.ringo.page/dashboard` is 404, `https://unknown.ringo.page` is 404, a Free test account cannot claim, and `https://ringoconnectltd.com/<username>` still works.

## Known limits
- Booking, shop and checkout live on the main domain; links to them from a subdomain page redirect there.
- Availability checks have no rate limit.
- The name lock and the `UNIQUE` constraint are tested on PGlite (single connection); a true two-connection race has not been run against a real Postgres.
