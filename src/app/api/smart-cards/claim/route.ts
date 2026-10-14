import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { clientIp, isUuidLike } from "@/lib/smartCards/ids";
import { isSameOriginRequest } from "@/lib/ai/drafts/http";
import { claimCard } from "@/lib/smartCards/scan";

// Claims a pre-issued Ringo Smart Card (the QR code's token) for the SIGNED-IN user's own profile. Separate from the NFC Card Writer (/api/ringo-cards).
// The browser supplies only { token, profileId }. Who is claiming comes from the session; whether the profile is theirs is checked inside the
// atomic database function (smartcard_claim), which locks the card row, so two simultaneous claims can never both succeed and a claimed card is never moved.
// The token is never logged and never echoed back.
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const reply = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return reply({ error: "forbidden" }, 403);
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return reply({ error: "not_authenticated" }, 401);

  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  const profileId = typeof body?.profileId === "string" ? body.profileId : "";
  if (!token || !isUuidLike(profileId)) return reply({ error: "unavailable" }, 404);

  const admin = createAdminClient();
  const out = await claimCard(admin, { token, userId: user.id, profileId, ip: clientIp(request.headers) });
  if (out.kind === "limited") return reply({ error: "rate_limited" }, 429);
  if (out.kind === "already_claimed") return reply({ error: "already_claimed" }, 409);
  if (out.kind === "profile_not_allowed") return reply({ error: "profile_not_allowed" }, 403);
  if (out.kind !== "claimed") return reply({ error: "unavailable" }, 404);

  // the profile's current username, from the session client (RLS), only to point the visitor at it
  const { data: profile } = await supabase.from("profiles").select("username").eq("id", profileId).eq("user_id", user.id).maybeSingle();
  return reply({ ok: true, serial: out.serial, already: out.already, username: profile?.username ?? null }, 200);
}
