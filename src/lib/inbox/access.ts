import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Access to the Inbox: OWNER ONLY (first increment). The profile is never taken from the request: it is the signed-in user's OWN profile
// (profiles.user_id = auth user), resolved on the server with the user's own session. Staff acting inside someone else's organization
// are not admitted (their own profile has no WhatsApp account), and no Team permission is involved.
// The Inbox exists only for a profile that has a WhatsApp account row (wa_accounts); everyone else is sent back to the dashboard.
// This is a UX gate. The data is protected independently: every query filters on the owner's profile id and the Phase 4 tables'
// owner-read RLS applies to the user's session.

export type InboxDenial = "not_signed_in" | "no_profile" | "no_account";

export type InboxOwner = { userId: string; profileId: string; supabase: ReturnType<typeof createClient> };

// cache(): the layout and the page both ask in one request; the answer is computed once.
export const resolveInboxOwner = cache(async (): Promise<{ ok: true; owner: InboxOwner } | { ok: false; reason: InboxDenial }> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not_signed_in" };

  const { data: profile } = await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
  if (!profile?.id) return { ok: false, reason: "no_profile" };

  if (!(await hasWhatsAppAccount(supabase, profile.id))) return { ok: false, reason: "no_account" };
  return { ok: true, owner: { userId: user.id, profileId: profile.id, supabase } };
});

/** Whether this profile owns a WhatsApp account. Fails closed (false) on any error or missing table. */
export async function hasWhatsAppAccount(supabase: { from(table: string): any }, profileId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("wa_accounts").select("id").eq("profile_id", profileId).limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/** Whether to show "Inbox" in the dashboard navigation (owners with a WhatsApp account only; one cheap indexed query). */
export async function inboxNavVisible(args: { supabase: { from(table: string): any }; profileId: string | null | undefined }): Promise<boolean> {
  if (!args.profileId) return false;
  return hasWhatsAppAccount(args.supabase, args.profileId);
}
