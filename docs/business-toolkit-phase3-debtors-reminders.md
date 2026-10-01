# Business Toolkit — Phase 3: Debtors, Credit Sales & Payment Reminders

Status: implemented locally, **NOT applied to production, NOT committed**. Migration: `supabase/migrations/2026-12-03_debtors_reminders.sql`
(with `supabase/support/2026-12-03_debtors_reminders.preflight.sql` and `...verify.sql`, tested by `supabase/support/tests/receivables_foundation.test.mjs`).

## 1. Locked decisions
1. **Debt model.** A debt is the Amount Due (`total − amount_paid`) of an *issued* invoice. `bk_documents` + `bk_document_payments` stay the only invoice/debt/payment ledger. No `bk_debts` / `bk_debt_payments`.
2. **Deferred (future functionality, not built):** write-offs / forgiving a remaining balance, changing the due date of an issued invoice, instalment plans, interest or late fees, customer overpayments or prepaid balances.
3. **Reminders:** manual (email, WhatsApp click-to-chat) and optional automatic email. Automatic is **OFF by default**. WhatsApp is only ever *opened/prepared*, never sent or delivered by Ringo; there is no automatic WhatsApp or SMS.
4. **Share links:** a reminder may include a link only when the **owner pastes one** and the database confirms it is a valid share link of that invoice. Phase 3 never creates a link, never stores a token, never rebuilds one (Phase 2 stores only the hash). **Automatic reminders never contain a link.**
5. **Customer book:** merchant-owned `bk_customers`. Not `ringo_customers`, `restaurant_customers`, `music_customers`, `community_subscribers` or `customer_followups`. Suggestions (same business, by normalised phone/email) never link or merge anything. Linking never touches the frozen invoice snapshot.
6. **Scope:** Business & E-commerce only, like Phases 1 and 2 (owner only, plan flag `business_toolkit_enabled`, not a demo profile).
7. **Cash basis.** Issuing creates no bookkeeping income; each recorded payment creates exactly one sale entry (Phase 2, unchanged). Phase 3 creates **zero** bookkeeping entries. A manual "uncollected sale" in Bookkeeping is never combined with receivables.
8. **Terminology:** Credit Sale, Amount Due, Outstanding Balance, Overdue. "Package Credits"/"Loyalty Credits" are prepaid customer credits and are never called "credit" here (UI strings and the AI module keep the distinction).
9. **Currency (existing Phase 2 behaviour, unchanged and documented):** an invoice cannot take a payment once the profile currency differs from the invoice currency (`currency_changed`). Receivables still list such an invoice, per currency, flagged `can_record_payment = false`.

## 2. Database objects (all new; nothing existing is altered)
Tables: `bk_customers`, `bk_document_customer_links` (one current link per invoice; `customer_id` null = unlinked), `bk_customer_events` (append-only), `bk_reminder_settings`, `bk_reminders` (append-only log, also the dedupe table).
Every FK is `ON DELETE RESTRICT`; composite FKs keep every reference inside one business; guard triggers (events/reminders append-only, a reminder leaves `claimed` exactly once, links change only their customer) and the Phase 1 truncate guard on all five.
RLS: one owner-read policy per table; `service_role` and `authenticated` hold SELECT only; `anon` nothing. All writes go through the functions below.

Functions (all `SECURITY DEFINER`, `search_path = public, pg_temp`, service_role only):
`bk_customer_save`, `bk_customer_set_archived`, `bk_customer_set_auto_paused`, `doc_set_document_customer`, `doc_suggest_customers`, `doc_receivables_summary`, `doc_receivable_invoices`, `doc_customer_statement`,
`doc_check_share` (read-only, no access counter), `doc_upsert_reminder_settings`, `doc_record_manual_reminder`, `doc_complete_reminder`, `doc_expire_stale_reminder_claims`, `doc_claim_due_reminders`.
Internal helpers (no one can execute them): `bk_norm_phone` (Cameroon rule: 9 digits starting 6 or 2 get 237), `bk_norm_email`, `bk_rem_mask_email`, `bk_customer_event`, `bk_rem_problem`, `bk_rem_email_problem`, `bk_rem_today`, `bk_rem_day_start`, `bk_rem_email_count`, `bk_rem_context`, plus the five guards.

## 3. Reminder state machine and dedupe
Email rows are inserted as `claimed` **before** any send (a crash can lose an email, never send one twice), then move once to `sent` / `failed` / `suppressed` / `skipped`. A claim with no outcome after 60 minutes is closed as `failed` (`stale_claim`) and never retried. WhatsApp rows are `prepared` only (a CHECK forbids anything else). Owner alerts use the same table (`channel = owner_alert`).
Dedupe keys (unique per business): `auto:{doc}:before:{due}`, `auto:{doc}:due:{due}`, `auto:{doc}:overdue:{cycle}`, `manual:{client_request_id}`, `owner:{doc}:{due}`. The reminder id is the provider (Resend) idempotency resource.

## 4. Limits (platform constants, enforced in SQL)
Manual email: ≥ 24 h between emails of one invoice, ≤ 10 customer emails per invoice, ≤ 100 customer emails per business per day. Automatic: ≤ 30 customer emails per business per day (all kinds counted), per-invoice maximum 1–6 (default 3), overdue spacing 3–60 days (default 7), before-due 1–14 days.
Automatic claim re-checks, per row: settings on, owner plan flag, not demo, Business & E-commerce category, a business reply-to email, invoice open with a positive Amount Due, due date on/after the day automatic reminders were enabled, usable and non-suppressed email, contact not paused/archived, maximum, spacing, daily budget.

## 5. Cron
`/api/cron/invoice-reminders` (`vercel.json`, `0 9 * * *` = 10:00 Douala), `CRON_SECRET` bearer, and **dormant unless `INVOICE_REMINDERS_CRON_ENABLED` is exactly `true`**. Even then a business only receives automatic reminders after turning them on itself. Order: sweep stale claims → claim → send once each → record each outcome once → owner alerts (bell + push).

## 6. Rollout
1. Apply preflight → migration → verify in the Supabase SQL editor (nothing here applies it). 2. Deploy (the Debtors tab appears only once the tables exist; the cron stays dormant). 3. Flip `status` of the `receivables` and `invoices` AI modules from `partial` to `live`. 4. Only later set `INVOICE_REMINDERS_CRON_ENABLED=true` (a Vercel env change needs a redeploy).

## 7. Rollback
Documented at the end of the migration (name-exact, no CASCADE, only Phase 3 objects): drop the 14 entry functions and 10 helpers, the 5 tables, the 5 guards. It deletes contacts, links, settings and the reminder log (export first) and touches no Phase 1/2 object or `email_delivery_logs`. Operational off switch without a rollback: unset the cron flag, or clear each business's `auto_email_enabled`. Application side: remove the cron entry from `vercel.json`.

## 8. Known limits (not hidden)
- PGlite is not Supabase: real role privileges, PostgREST behaviour and true concurrency (`FOR UPDATE SKIP LOCKED`, advisory locks) are unproven until rollout; the unique dedupe key is the backstop.
- Phone matching assumes the Cameroon number shape; other countries need an international number.
- Automatic reminders rely on the shared Resend domain's reputation; the suppression list, caps and opt-in are the mitigations.
- Contacts are archive-only (RESTRICT); an erasure policy for personal data is not defined yet.
- A reminder says the Amount Due is based on payments the business recorded; Ringo does not verify those payments.
- Browser behaviour of the new screens was not exercised.

## 9. Privacy and erasure (analysis only: nothing here is implemented, and no legal claim is made)
A request to erase a customer's personal information has to be reconciled with records the business may need to keep (invoices, payments, bookkeeping). What the current design allows, checked in `receivables_foundation.test.mjs` (section G2):

| Where the personal data is | Can it be erased/anonymised without breaking invariants? |
|---|---|
| `bk_customers` (name, phone, email, notes + the normalised copies) | **Yes, in place.** The existing guard permits it: set a placeholder name (the name column cannot be blank), clear phone/email/notes and both normalised columns, keep the row archived. No schema change, no delete, identity and links kept, nothing financial touched. |
| `bk_customer_events` | Append-only; rows hold no contact details (only ids and event types), so they can stay as the audit trail. |
| `bk_reminders` | Append-only and immutable; holds only a masked hint (`a***@x.com`), the amount, dates and outcome. Can stay (audit of what was claimed/sent) or be addressed by a future, reviewed change. |
| `email_delivery_logs` (existing table, outside Phase 3) | Holds the full recipient address of every reminder email. Retention/erasure there is an existing platform concern, not changed here. |
| **Invoice and receipt snapshots** (`bk_documents.customer_snapshot`, Phase 2) | **No.** They are frozen on purpose (content hash, tamper evidence, tax/accounting use) and contain the name, phone, email and address typed on the invoice. Changing them would break Phase 2 invariants, so this is a documented gap, not something changed in this phase. |
| PDFs and share pages | Regenerated from those snapshots, so they carry the same data. |

Archived contacts cannot resume reminders: manual email/WhatsApp are refused (`customer_archived`) and the automatic claim skips their invoices (tested).
**Known gap requiring a product/legal decision:** reminders use the invoice snapshot's email/phone. If an invoice is unlinked from an archived contact, it can be reminded again from the snapshot. A possible additive fix (not built): a per-business "do not contact" list matched on the normalised phone/email, honoured by `bk_rem_problem` for every invoice regardless of its link.
Decisions needed before any erasure feature: retention periods for invoice snapshots and reminder logs; whether an anonymised contact should also suppress its snapshot's address; who may request/perform erasure (owner vs platform); what is communicated to the customer. Until then, the documented operational path is: archive the contact (blocks reminders) and, if requested, anonymise the contact row by an administrator-run, reviewed statement.

## 10. Cron compatibility
`vercel.json` now lists seven cron jobs. The repository contains **no evidence of the Vercel plan** (the Protection runbook only guesses that the daily-only schedules "suggest a plan tier that does not support more frequent schedules"). Vercel's cron limits depend on the plan and change over time; confirm in the Vercel dashboard (Project → Settings → Cron Jobs / plan limits) that seven jobs and a once-a-day schedule are allowed. The new schedule is `0 9 * * *` (UTC) = 10:00 in Cameroon (UTC+1, no daylight saving) and remains once daily. The route does nothing unless `INVOICE_REMINDERS_CRON_ENABLED` is exactly `true`.
