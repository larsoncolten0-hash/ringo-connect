import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendAnnouncementToSubscribers } from "@/lib/community/send";
import { isEmailProviderConfigured } from "@/lib/email/provider";
import { NextResponse } from "next/server";

// Owner-authenticated (cookie session, not a token) — only the announcement's
// own creator can trigger this. Ownership is verified with the normal
// server client (which is RLS-scoped to their own rows), then the actual
// fan-out across subscribers/preferences/delivery_logs uses the admin
// client — same "who's calling vs. what gets touched" split every other
// cross-cutting write in this project uses.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: announcement } = await supabase
    .from("community_announcements")
    .select("*, profiles!inner(user_id)")
    .eq("id", params.id)
    .single();

  if (!announcement || (announcement as any).profiles?.user_id !== user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (announcement.status === "sending") {
    return NextResponse.json({ error: "Already sending." }, { status: 409 });
  }
  if (announcement.status === "sent") {
    return NextResponse.json({ error: "Already sent." }, { status: 409 });
  }

  const admin = createAdminClient();
  await admin.from("community_announcements").update({ status: "sending" }).eq("id", announcement.id);

  const { data: profile } = await admin.from("profiles").select("*").eq("id", announcement.profile_id).single();

  const { recipientCount, sentCount, failedCount } = await sendAnnouncementToSubscribers(admin, announcement, profile);

  // recipientCount > 0 but nothing actually went out (most commonly: no
  // email provider configured yet) — surface that as a real failure, never
  // as a quiet "sent to 0."
  const finalStatus = recipientCount > 0 && sentCount === 0 ? "failed" : "sent";

  await admin
    .from("community_announcements")
    .update({
      status: finalStatus,
      recipient_count: recipientCount,
      sent_count: sentCount,
      failed_count: failedCount,
      sent_at: new Date().toISOString(),
    })
    .eq("id", announcement.id);

  return NextResponse.json({ status: finalStatus, recipientCount, sentCount, failedCount, providerConfigured: isEmailProviderConfigured() });
}
