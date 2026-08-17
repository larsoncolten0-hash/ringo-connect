import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Deliberately restricted to pending/rejected requests — an "approved"
// request already has a real auth user + profile + payment history
// behind it (see approve/route.ts), and permanently deleting a live
// customer account is a much bigger, separate decision than cleaning up
// a form submission. This route never touches auth.users, public.users,
// or profiles at all.
const UPLOADS_MARKER = "/object/public/uploads/";

function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf(UPLOADS_MARKER);
  if (i === -1) return null;
  return url.slice(i + UPLOADS_MARKER.length);
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const adminClient = createAdminClient();

  const { data: signupRequest } = await adminClient
    .from("signup_requests")
    .select("id, status, full_name, whatsapp_number, email, avatar_url, requested_products, created_user_id")
    .eq("id", params.id)
    .single();

  if (!signupRequest) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  if (signupRequest.status === "approved" || signupRequest.created_user_id) {
    return NextResponse.json(
      { error: "This request already became an account and can't be deleted here." },
      { status: 400 }
    );
  }

  // Best-effort cleanup of anything the customer uploaded while filling
  // out the form (avatar + any product photos) — failing to remove a
  // storage object shouldn't block deleting the request itself.
  const paths = [
    storagePathFromUrl(signupRequest.avatar_url),
    ...(Array.isArray(signupRequest.requested_products)
      ? signupRequest.requested_products.map((p: any) => storagePathFromUrl(p?.image_url))
      : []),
  ].filter((p): p is string => !!p);

  if (paths.length > 0) {
    const { error: storageError } = await adminClient.storage.from("uploads").remove(paths);
    if (storageError) console.error("Failed to remove uploaded files for signup request:", storageError.message);
  }

  const { error: deleteError } = await adminClient.from("signup_requests").delete().eq("id", params.id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 400 });

  // No target_user_id — no user exists for a pending/rejected request.
  // The identifying details go in `details` instead so the log entry
  // still says who this was after the row is gone.
  await adminClient.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "delete_signup_request",
    details: {
      requestId: signupRequest.id,
      fullName: signupRequest.full_name,
      whatsappNumber: signupRequest.whatsapp_number,
      email: signupRequest.email,
      status: signupRequest.status,
    },
  });

  return NextResponse.json({ ok: true });
}
