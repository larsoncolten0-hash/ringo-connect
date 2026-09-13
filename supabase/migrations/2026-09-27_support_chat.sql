-- Ringo Connect — in-app support chat
-- Run this once in the Supabase SQL editor.
--
-- Backs the dashboard's "Ask for help" widget (src/components/dashboard/
-- HelpWidget.tsx), converting it from a compose-and-hand-off-to-WhatsApp/
-- email box into a real two-way thread between a creator and the admin
-- team, plus its mirror on the admin side (src/app/admin/support).
--
-- One conversation per creator (`support_conversations.user_id` is
-- unique) — there's exactly one admin team, not a per-topic inbox, so a
-- single ongoing thread per account is all this needs; it's created the
-- first time either side needs it (lazily, by the API routes) rather
-- than at signup. Any full admin can read and reply to any conversation,
-- the same "one shared admin inbox" posture the existing `notifications`
-- table's audience='admin' rows already use — there's no per-admin
-- assignment/routing.
--
-- Unread tracking is two plain timestamps rather than counters
-- (`user_last_read_at` / `admin_last_read_at`): "unread count for side X"
-- is just "messages from the other side created after X's last-read
-- timestamp," computed at read time — simpler and can't drift out of
-- sync the way a maintained counter could.
--
-- Additive/idempotent, same convention as every migration since
-- 2026-09-12 (see e.g. 2026-09-26_push_notifications.sql's own note on
-- why: this repo's tracked migrations are incomplete relative to the
-- actual live schema, so every statement here is written to be safe to
-- run against a database that already has things in it we don't know
-- about).

create table if not exists support_conversations (
  id uuid primary key default gen_random_uuid()
);
alter table support_conversations add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table support_conversations add column if not exists last_message_at timestamptz not null default now();
alter table support_conversations add column if not exists user_last_read_at timestamptz not null default now();
-- Null until any admin has ever opened this conversation — distinguishes
-- "no admin has seen this yet" from "an admin read it a while ago."
alter table support_conversations add column if not exists admin_last_read_at timestamptz;
alter table support_conversations add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_conversations_user_id_key') then
    alter table support_conversations add constraint support_conversations_user_id_key unique (user_id);
  end if;
end $$;

create table if not exists support_messages (
  id uuid primary key default gen_random_uuid()
);
alter table support_messages add column if not exists conversation_id uuid references support_conversations(id) on delete cascade;
alter table support_messages add column if not exists sender_type text;
-- Which user or which admin actually wrote it — kept even though a
-- conversation already has one fixed `user_id`, so a message from that
-- user is still individually attributed (and so an admin reply records
-- *which* admin sent it, useful once there's more than one).
alter table support_messages add column if not exists sender_id uuid references public.users(id) on delete set null;
alter table support_messages add column if not exists body text;
alter table support_messages add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_messages_sender_type_check') then
    alter table support_messages add constraint support_messages_sender_type_check check (sender_type in ('user', 'admin'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'support_messages_body_check') then
    alter table support_messages add constraint support_messages_body_check check (char_length(trim(body)) > 0 and char_length(body) <= 4000);
  end if;
end $$;

create index if not exists support_messages_conversation_idx on support_messages (conversation_id, created_at);
create index if not exists support_conversations_last_message_idx on support_conversations (last_message_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Reads/writes go through the API routes below using each caller's own
-- session client, so these policies are the real access control (not
-- just a backstop) — same posture as bookings/community_subscribers etc.
--   - src/app/api/support/messages/route.ts            (a creator's own thread)
--   - src/app/api/admin/support/conversations/route.ts  (admin inbox list)
--   - src/app/api/admin/support/[id]/messages/route.ts  (an admin's replies)
alter table support_conversations enable row level security;
alter table support_messages enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'support_conversations' and policyname = 'support_conversations select own or admin') then
    create policy "support_conversations select own or admin" on support_conversations for select using (
      user_id = auth.uid() or is_admin()
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'support_conversations' and policyname = 'support_conversations insert own') then
    create policy "support_conversations insert own" on support_conversations for insert with check (
      user_id = auth.uid() or is_admin()
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'support_conversations' and policyname = 'support_conversations update own or admin') then
    -- Both sides only ever update their own *_last_read_at column in
    -- practice (see the API routes) — there's no column-level RLS to
    -- enforce that narrower rule, so this just gates it to "your own
    -- conversation, or any conversation if you're an admin."
    create policy "support_conversations update own or admin" on support_conversations for update using (
      user_id = auth.uid() or is_admin()
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'support_messages' and policyname = 'support_messages select own or admin') then
    create policy "support_messages select own or admin" on support_messages for select using (
      is_admin()
      or exists (select 1 from support_conversations c where c.id = conversation_id and c.user_id = auth.uid())
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'support_messages' and policyname = 'support_messages insert own or admin') then
    create policy "support_messages insert own or admin" on support_messages for insert with check (
      (sender_type = 'admin' and sender_id = auth.uid() and is_admin())
      or (
        sender_type = 'user'
        and sender_id = auth.uid()
        and exists (select 1 from support_conversations c where c.id = conversation_id and c.user_id = auth.uid())
      )
    );
  end if;
end $$;
