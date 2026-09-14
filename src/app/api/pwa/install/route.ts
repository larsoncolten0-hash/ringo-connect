import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Fired once by ActivitySignals.tsx when the browser's `appinstalled` event
// fires. This event does NOT fire on iOS Safari — Apple has never
// implemented it — so pwa_installed_at structurally undercounts iOS users
// who added the app to their home screen via the share-sheet flow instead.
// The admin Users analytics view surfaces that caveat rather than
// presenting this count as complete; see AdminUsersAnalytics.tsx.
//
// Only ever sets the column the first time (.is("pwa_installed_at", null))
// — a later reinstall doesn't need to move the recorded date.
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({ pwa_installed_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("pwa_installed_at", null);

  if (error) {
    console.error("pwa install ping failed:", error.message);
    return NextResponse.json({ error: "Could not record install." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
