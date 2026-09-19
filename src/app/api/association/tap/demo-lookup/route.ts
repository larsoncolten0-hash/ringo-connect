import { NextResponse } from "next/server";
import { requireAssociationAccessJson } from "@/lib/association/access";
import { isActiveDemoProfile } from "@/lib/association/demoProfile";
import { createAdminClient } from "@/lib/supabase/server";

// POST /api/association/tap/demo-lookup — body: { associationProfileId, code }.
//
// DEMO/TEST ONLY. A browser-only stand-in for tapping a physical Membership Card, so a demo Partner can
// exercise the REAL Partner dashboard without Web NFC. It resolves one member's demo card code (the first 8
// hex characters of the member id) to that member's identity and balance, exactly like the real
// /api/association/tap/lookup does for a card reference. It changes nothing: the actual earn and redeem still
// go through the unchanged /api/association/tap/earn and /tap/redeem, which derive partner_profile_id from the
// authenticated session.
//
// Fails closed unless ALL of these hold (each is re-derived on the server; nothing is trusted from the body
// except the Association id and the code, and both are validated):
//   1. the caller is signed in and is an ACTIVE Partner of exactly this Association (requireAssociationAccessJson);
//      an Owner or platform admin is refused (the Owner already has the Simulated Tap tab);
//   2. the caller's own profile is an ACTIVE demo profile: is_demo = true AND demo_expires_at is set and still in
//      the future (server clock);
//   3. the Association's profile is an ACTIVE demo profile, by the same definition;
//   4. the code matches exactly ONE member of THAT Association (a code from another Association never resolves).
// It never returns the roster: the response is at most one member's id, name and balance. It is not a search:
// the code must be exactly 8 hex characters and a non-unique or unknown code is just "not recognized".
const DEMO_CODE = /^[0-9a-f]{8}$/i;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const associationProfileId = typeof body?.associationProfileId === "string" ? body.associationProfileId : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!associationProfileId || !DEMO_CODE.test(code)) {
    return NextResponse.json({ code: "demo_code_not_recognized", error: "That demo card code wasn't recognized." }, { status: 400 });
  }

  const auth = await requireAssociationAccessJson(associationProfileId);
  if (!auth.ok) return auth.response;
  const { access } = auth;

  if (!access.isPartner || access.isOwner || access.isAdmin || !access.partnerProfileId) {
    return NextResponse.json({ code: "not_authorized", error: "Not authorized." }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: flagRows } = await admin
    .from("profiles")
    .select("id, is_demo, demo_expires_at")
    .in("id", [associationProfileId, access.partnerProfileId]);
  const now = new Date(); // the server's clock, never the client's
  const isActiveDemo = (id: string) => isActiveDemoProfile((flagRows || []).find((p: any) => p.id === id), now);
  if (!isActiveDemo(associationProfileId) || !isActiveDemo(access.partnerProfileId)) {
    return NextResponse.json({ code: "demo_only", error: "This test shortcut is only available in demo mode." }, { status: 403 });
  }

  // The prefix match is done here, on the server, over this one Association's members only; only the single
  // matching member is ever returned.
  const { data: members } = await admin
    .from("association_members")
    .select("id, name, points_balance, status")
    .eq("association_profile_id", associationProfileId)
    .limit(1000);

  const wanted = code.toLowerCase();
  const matches = (members || []).filter((m: any) => typeof m.id === "string" && m.id.toLowerCase().startsWith(wanted));
  if (matches.length !== 1) {
    return NextResponse.json({ code: "demo_code_not_recognized", error: "That demo card code wasn't recognized for this Association." }, { status: 404 });
  }

  const member = matches[0] as any;
  if (member.status === "disabled") {
    return NextResponse.json({ code: "member_disabled", error: "This Member's account is disabled." }, { status: 409 });
  }

  return NextResponse.json({ member: { id: member.id, name: member.name, pointsBalance: member.points_balance } });
}
