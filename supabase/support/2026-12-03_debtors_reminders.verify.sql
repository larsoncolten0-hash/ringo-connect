-- VERIFY for 2026-12-03_debtors_reminders.sql — READ-ONLY (a single SELECT). Run once AFTER applying the migration; every row must show ok = true.
-- (Do not run the preflight afterwards: its "no Phase 3 object exists" rows are expected to fail once the migration is applied.)

with
t5(t) as (values ('bk_customers'),('bk_document_customer_links'),('bk_customer_events'),('bk_reminder_settings'),('bk_reminders')),
f_entry(f) as (values ('bk_customer_save'),('bk_customer_set_archived'),('bk_customer_set_auto_paused'),('doc_set_document_customer'),('doc_suggest_customers'),
                      ('doc_receivables_summary'),('doc_receivable_invoices'),('doc_customer_statement'),('doc_check_share'),('doc_upsert_reminder_settings'),
                      ('doc_record_manual_reminder'),('doc_complete_reminder'),('doc_expire_stale_reminder_claims'),('doc_claim_due_reminders')),
f_helper(f) as (values ('bk_norm_phone'),('bk_norm_email'),('bk_rem_mask_email'),('bk_customer_event'),('bk_rem_problem'),('bk_rem_email_problem'),('bk_rem_today'),
                       ('bk_rem_day_start'),('bk_rem_email_count'),('bk_rem_context')),
f_guard(f) as (values ('bk_customers_guard'),('bk_document_customer_links_guard'),('bk_customer_events_guard'),('bk_reminder_settings_guard'),('bk_reminders_guard')),
f_all(f) as (select f from f_entry union all select f from f_helper union all select f from f_guard),
trg(n) as (values ('bk_customers_guard_trg'),('bk_document_customer_links_guard_trg'),('bk_customer_events_guard_trg'),('bk_reminder_settings_guard_trg'),('bk_reminders_guard_trg'),
                  ('bk_customers_truncate_guard_trg'),('bk_document_customer_links_truncate_guard_trg'),('bk_customer_events_truncate_guard_trg'),
                  ('bk_reminder_settings_truncate_guard_trg'),('bk_reminders_truncate_guard_trg')),
pol(n) as (values ('bk_customers owner read'),('bk_document_customer_links owner read'),('bk_customer_events owner read'),('bk_reminder_settings owner read'),('bk_reminders owner read')),
idx(n) as (values ('bk_customers_request_idx'),('bk_customers_phone_idx'),('bk_customers_email_idx'),('bk_customers_list_idx'),('bk_document_customer_links_customer_idx'),
                  ('bk_customer_events_customer_idx'),('bk_customer_events_profile_idx'),('bk_reminders_request_idx'),('bk_reminders_doc_idx'),('bk_reminders_profile_idx')),
fn as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (select f from f_all)),
rel as (select c.oid, c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname in (select t from t5)),
checks(label, expect, actual) as (
  select '01 Phase 3 tables exist (5)', '5', (select count(*)::text from rel)
  union all select '02 Phase 3 functions exist (29 = 14 entry + 10 helpers + 5 guards)', '29', (select count(*)::text from fn)
  union all select '02b each exists exactly once (no overloads)', '29', (select count(distinct proname)::text from fn)
  union all select '03 guard + truncate-guard triggers exist (10), all on Phase 3 tables', '10', (select count(*)::text from pg_trigger t where not t.tgisinternal and t.tgname in (select n from trg) and t.tgrelid in (select oid from rel))
  union all select '04 RLS enabled on all 5 tables', '5', (select count(*)::text from rel where relrowsecurity)
  union all select '05 owner-read policies exist (5), SELECT-only for authenticated', '5', (select count(*)::text from pg_policies where schemaname = 'public' and policyname in (select n from pol) and cmd = 'SELECT' and roles = '{authenticated}')
  union all select '05b no write policy on any Phase 3 table', '0', (select count(*)::text from pg_policies where schemaname = 'public' and tablename in (select t from t5) and cmd <> 'SELECT')
  union all select '06 named indexes exist (10)', '10', (select count(*)::text from pg_indexes where schemaname = 'public' and indexname in (select n from idx))
  union all select '06b reminders: UNIQUE (profile_id, dedupe_key)', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.bk_reminders'::regclass and contype = 'u' and pg_get_constraintdef(oid) like '%(profile_id, dedupe_key)%'))::text
  union all select '06c reminders: WhatsApp is only ever prepared (CHECK present)', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.bk_reminders'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%whatsapp_manual%' and pg_get_constraintdef(oid) like '%prepared%'))::text
  union all select '06d reminders: automatic reminders never carry a link (CHECK present)', 'true', (exists (select 1 from pg_constraint where conrelid = 'public.bk_reminders'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%include_link%'))::text
  union all select '06e every FK from a Phase 3 table is ON DELETE RESTRICT', '0', (select count(*)::text from pg_constraint where contype = 'f' and conrelid in (select oid from rel) and confdeltype <> 'r')
  union all select '06f automatic email and owner alerts are OFF by default (column defaults)', '2', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'bk_reminder_settings' and column_name in ('auto_email_enabled','owner_alerts_enabled') and column_default = 'false')
  union all select '06g overdue spacing default is 7 days, max automatic per invoice default is 3', '2', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'bk_reminder_settings' and ((column_name = 'overdue_every_days' and column_default = '7') or (column_name = 'max_auto_per_invoice' and column_default = '3')))
  union all select '07 entry functions: service_role CAN execute (14)', '14', (select count(*)::text from fn where proname in (select f from f_entry) and has_function_privilege('service_role', oid, 'execute'))
  union all select '07b NO function grants execute to anon / authenticated (all 29)', '0', (select count(*)::text from fn where has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute'))
  union all select '07c helpers and guards: service_role can NOT execute (15)', '15', (select count(*)::text from fn where proname not in (select f from f_entry) and not has_function_privilege('service_role', oid, 'execute'))
  union all select '07d NO client role holds INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on any Phase 3 table', '0',
         (select count(*)::text from rel r cross join (values ('anon'),('authenticated'),('service_role')) ro(role) cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) pr(priv) where has_table_privilege(ro.role, r.oid, pr.priv))
  union all select '07e anon has no SELECT; authenticated + service_role have SELECT on all 5 (10 grants)', '10', (select count(*)::text from rel r cross join (values ('authenticated'),('service_role')) ro(role) where has_table_privilege(ro.role, r.oid, 'SELECT') and not has_table_privilege('anon', r.oid, 'SELECT'))
  union all select '07f all SECURITY DEFINER Phase 3 functions pin search_path', '0', (select count(*)::text from fn where prosecdef and (proconfig is null or proconfig::text not like '%search_path=public, pg_temp%'))
  union all select '08 PHASE 3 CREATES NO BOOKKEEPING ENTRY: no Phase 3 function mentions bk_entries / bk_record_entry / bk_void_entry', '0',
         (select count(*)::text from fn where prosrc ilike '%bk_entries%' or prosrc ilike '%bk_record_entry%' or prosrc ilike '%bk_void_entry%')
  union all select '08b no Phase 3 function writes bk_documents or bk_document_payments (no second ledger)', '0',
         (select count(*)::text from fn where prosrc ~* '(insert into|update|delete from)\s+bk_document(s|_payments)\y')
  union all select '08c Phase 3 has no debt ledger tables (no bk_debts / bk_debt_payments)', '0', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('bk_debts','bk_debt_payments'))
  union all select '09 Phase 2 objects intact: 8 tables, 29 functions', '8|29',
         ((select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('bk_business_profiles','bk_documents','bk_document_lines','bk_document_counters','bk_document_payments','bk_document_events','bk_document_shares','bk_document_rate_events')) || '|' ||
          (select count(distinct p.proname)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (
            'doc_upsert_business_profile','doc_save_draft','doc_issue','doc_record_payment','doc_void_payment','doc_void_document','doc_create_share','doc_revoke_share','doc_resolve_share','bk_doc_hash','bk_doc_rate_limit_hit',
            'bk_doc_gate','bk_doc_event','bk_doc_seller_snapshot','bk_doc_hash_of','bk_doc_bundle','bk_doc_payment_bundle','bk_doc_issue_core','bk_doc_number','bk_doc_compute_line','bk_doc_blank_null','bk_doc_clean_customer',
            'bk_business_profiles_guard','bk_documents_guard','bk_document_lines_guard','bk_document_counters_guard','bk_document_payments_guard','bk_document_events_guard','bk_document_shares_guard')))
  union all select '09b Phase 2 payment path still calls Phase 1 bookkeeping exactly as before', 'true|true',
         ((select (prosrc like '%bk_record_entry(%')::text from pg_proc where proname = 'doc_record_payment') || '|' || (select (prosrc like '%bk_void_entry(%')::text from pg_proc where proname = 'doc_void_payment'))
  union all select '09c no Phase 3 trigger sits on a Phase 1 / Phase 2 / commerce table', '0', (select count(*)::text from pg_trigger t where not t.tgisinternal and t.tgfoid in (select oid from fn) and t.tgrelid not in (select oid from rel))
  union all select '09d no table outside Phase 3 has a foreign key into a Phase 3 table', '0', (select count(*)::text from pg_constraint where contype = 'f' and confrelid in (select oid from rel) and conrelid not in (select oid from rel))
  union all select '10 phone / email normalisation (Cameroon 9-digit rule)', '237677123456|237677123456|a@b.co|',
         (public.bk_norm_phone('677 12 34 56') || '|' || public.bk_norm_phone('+237 677-123-456') || '|' || public.bk_norm_email('  A@B.co ') || '|' || coalesce(public.bk_norm_phone('12'), ''))
  union all select '11 Phase 3 tables hold 0 rows (fresh install)', '0',
         ((select count(*) from bk_customers) + (select count(*) from bk_document_customer_links) + (select count(*) from bk_customer_events) + (select count(*) from bk_reminder_settings) + (select count(*) from bk_reminders))::text
  union all select '12 no profile has automatic reminders enabled right after install', '0', (select count(*)::text from bk_reminder_settings where auto_email_enabled)
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
