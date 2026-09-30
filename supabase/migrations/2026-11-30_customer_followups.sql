-- Customer Follow-Up workflow (admin) — PROPOSED, NOT APPLIED.
--
-- Purely additive: one NEW table. It does not touch signup_requests, users, ambassador_sales or any
-- other existing table, so the ORIGINAL registration attribution (ambassador code, referral code,
-- source, sale rows) is never read-modified or overwritten by follow-up work. Dropping this table
-- leaves no trace on anything that existed before it.
--
-- One row per customer (subject). `subject_type` = 'request' keys by signup_requests.id (stable
-- from the first form submission, before and after approval); 'user' is used only for accounts
-- that have no signup request. Written exclusively by the admin API route with the service role.
-- RLS is enabled with NO policies, so no browser/session client can read or write it.

create table if not exists public.customer_followups (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('request', 'user')),
  subject_id uuid not null,
  status text not null check (status in ('needs_follow_up', 'completed')),
  follow_up_date date,
  assigned_to uuid references public.users(id) on delete set null,
  note text check (note is null or char_length(note) <= 500),
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_type, subject_id)
);

create index if not exists customer_followups_status_idx on public.customer_followups (status);

alter table public.customer_followups enable row level security;
