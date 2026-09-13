import { createClient, createAdminClient } from "@/lib/supabase/server";
import { notifyAdmins } from "@/lib/notifications";
import { sendPushToAdmins } from "@/lib/push/send";
import { NextResponse } from "next/server";

// A signed-in creator's own blue-tick verification request — the API
// behind the profile menu's "Request verification" modal (see
// src/components/dashboard/VerificationRequestModal.tsx). RLS
// (verification_requests' own policies) is the real access control here:
// a user can only ever see/create their own request.
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [{ data: profile }, { data: request }] = await Promise.all([
    supabase.from("profiles").select("verified").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("verification_requests")
      .select("id, full_name, phone_number, location, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return NextResponse.json({ verified: !!profile?.verified, request: request || null });
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const fullName = typeof body?.full_name === "string" ? body.full_name.trim().slice(0, 120) : "";
  const phoneNumber = typeof body?.phone_number === "string" ? body.phone_number.trim().slice(0, 40) : "";
  const location = typeof body?.location === "string" ? body.location.trim().slice(0, 120) : "";

  if (!fullName || !phoneNumber || !location) {
    return NextResponse.json({ error: "Fill in every field before submitting." }, { status: 400 });
  }

  const { data: created, error } = await supabase
    .from("verification_requests")
    .insert({ user_id: user.id, full_name: fullName, phone_number: phoneNumber, location })
    .select("id, full_name, phone_number, location, status, created_at")
    .single();

  if (error) {
    // The one-pending-per-user partial unique index — someone double-
    // submitting (e.g. two tabs) rather than a real error to log.
    if (error.code === "23505") {
      return NextResponse.json({ error: "You already have a request awaiting review." }, { status: 409 });
    }
    console.error("verification request insert failed:", error.message);
    return NextResponse.json({ error: "Could not submit your request — try again." }, { status: 500 });
  }

  const { data: profile } = await supabase.from("profiles").select("username").eq("user_id", user.id).maybeSingle();
  const who = profile?.username ? `@${profile.username}` : user.email || "A creator";

  await Promise.all([
    notifyAdmins({
      type: "verification_requested",
      title: `Verification requested by ${who}`,
      body: `${fullName} · ${location}`,
      link: `/admin/verification?r=${created.id}`,
    }),
    sendPushToAdmins(createAdminClient(), {
      category: "verification_requested",
      title: `Verification requested by ${who}`,
      body: `${fullName} · ${location}`,
      url: `/admin/verification?r=${created.id}`,
    }),
  ]);

  return NextResponse.json({ request: created });
}
