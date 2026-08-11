import { createAdminClient } from "@/lib/supabase/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { NextResponse } from "next/server";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json(); // e.g. { planId } or { status }
  const adminClient = createAdminClient();

  const { error } = await adminClient.from("users").update(body).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await adminClient.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: Object.keys(body)[0] === "status" ? "suspend" : "change_plan",
    target_user_id: params.id,
    details: body,
  });

  return NextResponse.json({ ok: true });
}