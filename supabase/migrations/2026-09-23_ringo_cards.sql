-- Ringo Card Writer — physical NFC card → digital Ringo profile bridge.
--
-- Product framing (see src/components/dashboard/RingoCardWriter.tsx): a
-- physical "Ringo Card" (an NTAG216 NFC tag Ringo Connect distributes)
-- stores ONLY a Ringo profile URL, e.g. https://ringoconnectltd.com/jaykay.
-- It never stores the profile's data itself, so a creator can freely edit
-- their profile later without ever needing to rewrite the physical card.
-- This table is the server-side record of which physical card points at
-- which creator/profile — not the card's content (that lives on the NFC
-- chip itself, written client-side via the Web NFC API).
--
-- Design notes:
--
-- * `user_id` + `profile_id` are both kept (like `bookings.profile_id`
--   elsewhere, though here we also keep user_id) so the architecture
--   supports a user eventually owning multiple profiles, and a profile
--   eventually being reassigned to a different one of that same user's
--   profiles ("Rewrite Your Ringo Card") — see profile_id's "on delete set
--   null" below. Today the app only ever creates one profile per user, but
--   this table deliberately never assumes that.
--
-- * `card_reference` is the customer-facing identifier (e.g.
--   RNG-CARD-000123, see src/lib/ringoCardReference.ts) — never the raw
--   uuid `id`, which stays purely internal.
--
-- * `card_uid` is the NFC chip's hardware serial number, captured
--   best-effort where the browser exposes it (Chrome's Web NFC
--   NDEFReadingEvent.serialNumber). It is stored strictly as device
--   metadata for diagnostics/inventory — NEVER treated as a secret or an
--   authentication credential (a UID is trivially readable by anyone who
--   taps the card) and never exposed on any public/unauthenticated route.
--
-- * `destination_url` is always computed server-side from the owning
--   profile's username at write/rewrite time (see /api/ringo-cards/[id]/
--   write) — it is never accepted as free-form input from the client, so
--   a Ringo Card can only ever be pointed at a Ringo-owned profile URL.
--
-- * `status` mirrors the full future lifecycle described in the Ringo
--   Card product brief (available/assigned/active/lost/disabled/replaced)
--   even though V1's UI only ever produces assigned -> active — this
--   leaves room for a future staff/bulk inventory tool without a schema
--   change.
--
-- * profile_id "on delete set null" (not cascade): deleting a profile must
--   never leave an orphaned FK violation, but the physical card record
--   (and its history) is real-world state a physical object still exists
--   for — it should survive as an unassigned/disabled record, not vanish
--   or block the profile deletion.
--
-- Additive/idempotent, same convention as every migration since 2026-09-12.

create table if not exists ringo_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  -- Customer-facing reference, e.g. "RNG-CARD-000123" — see
  -- src/lib/ringoCardReference.ts. Never expose the `id` column itself.
  card_reference text not null unique,
  -- NFC hardware serial number, where the browser/device exposes one.
  -- Metadata only — see comment above. Never a secret, never used for auth.
  card_uid text,
  -- The physical chip family. NTAG216 is what Ringo Connect distributes;
  -- kept as text (not an enum) since future card stock may vary.
  card_type text not null default 'ntag216',
  status text not null default 'assigned' check (
    status in ('available', 'assigned', 'active', 'lost', 'disabled', 'replaced')
  ),
  -- The exact URL written to (or intended for) the physical chip. Always
  -- server-computed from profile_id's username — see write/rewrite route.
  destination_url text,
  assigned_at timestamptz,
  last_written_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ringo_cards_user_id_idx on ringo_cards (user_id, created_at desc);
create index if not exists ringo_cards_profile_id_idx on ringo_cards (profile_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Same posture as most owner-scoped tables in this schema (profiles,
-- booking_services): the owning creator or an admin can do everything,
-- nobody else can see or touch a row. There is no public/anon policy at
-- all — card_uid must never be readable by anyone but the owner/admin.
--
-- The USING clause (read/update/delete visibility) only needs user_id —
-- but the WITH CHECK clause (what a write is allowed to set) also
-- requires profile_id to actually belong to that same user, mirroring
-- the exists-subquery pattern every other profile_id-referencing table in
-- this schema uses (see booking_services/bookings above). Without that,
-- RLS alone would let a signed-in creator point their OWN ringo_cards row
-- at a profile_id belonging to someone else via a direct client insert/
-- update — the API routes already enforce this server-side, but RLS is
-- this schema's real security boundary, and should never depend on every
-- caller going through the intended route.
alter table ringo_cards enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ringo_cards' and policyname = 'ringo_cards owner all') then
    create policy "ringo_cards owner all" on ringo_cards for all using (
      user_id = auth.uid() or is_admin()
    ) with check (
      (user_id = auth.uid() or is_admin())
      and (
        profile_id is null
        or exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
      )
    );
  end if;
end $$;
