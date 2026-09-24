-- Universal Smart CTA — creator override for catalogue products only.
-- Additive: two nullable columns, no defaults, no backfill, no RLS changes.
-- NULL/NULL = the product behaves exactly as it did before this migration.
--   cta_preset : stable id of a predefined CTA wording (validated in src/lib/cta.ts)
--   cta_label  : creator's own button wording (display text only)
alter table products add column if not exists cta_preset text;
alter table products add column if not exists cta_label text;
