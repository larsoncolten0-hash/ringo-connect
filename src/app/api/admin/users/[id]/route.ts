import { createAdminClient } from "@/lib/supabase/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { NextResponse } from "next/server";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json(); // e.g. { planId } or { status } or { verified }
  const adminClient = createAdminClient();

  // `verified` lives on profiles, not users — see the comment on that
  // column in 2026-09-14_pin_and_verified.sql (profiles has a public-read
  // RLS policy the public page relies on; users doesn't). Every other key
  // here still targets the users table as before.
  if ("verified" in body) {
    const { error } = await adminClient.from("profiles").update({ verified: body.verified }).eq("user_id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { error } = await adminClient.from("users").update(body).eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const bodyKey = Object.keys(body)[0];
  const action =
    bodyKey === "status"
      ? "suspend"
      : bodyKey === "can_approve_requests"
      ? "set_super_creator"
      : bodyKey === "verified"
      ? "set_verified"
      : "change_plan";

  await adminClient.from("admin_audit_log").insert({
    admin_id: admin.id,
    action,
    target_user_id: params.id,
    details: body,
  });

  return NextResponse.json({ ok: true });
}
