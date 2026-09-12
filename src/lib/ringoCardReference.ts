import { randomInt } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Generates the customer-facing Ringo Card identifier — e.g.
// "RNG-CARD-000123" — shown to creators instead of the internal
// ringo_cards.id uuid (see 2026-09-23_ringo_cards.sql). Six digits gives
// a million references before collisions become likely at all, and the
// retry loop below handles the rare collision rather than assuming
// uniqueness up front.
function randomCardReference(): string {
  const n = randomInt(0, 1_000_000);
  return `RNG-CARD-${String(n).padStart(6, "0")}`;
}

// Called from inside the /api/ringo-cards POST handler, which already has
// a Supabase client scoped to the request (RLS doesn't matter here since
// this only ever checks for an existing reference, never other people's
// data — the unique index is the real guarantee; this loop just avoids
// surfacing a constraint-violation error to the creator on the rare
// collision).
export async function generateUniqueCardReference(supabase: SupabaseClient, attempts = 5): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const candidate = randomCardReference();
    const { data } = await supabase.from("ringo_cards").select("id").eq("card_reference", candidate).maybeSingle();
    if (!data) return candidate;
  }
  // Astronomically unlikely with a million-value space, but never leave
  // this able to loop forever or silently produce a duplicate.
  throw new Error("Could not generate a unique Ringo Card reference — please try again.");
}
