import { NextResponse } from "next/server";
import { resolveAiAccess } from "@/lib/ai/guard";
import { createAdminClient } from "@/lib/supabase/server";
import { AI_UPLOAD_MAX_SIZE_BYTES, aiUploadPath, extFromMime, looksLikeImage } from "@/lib/ai/uploads";

// POST /api/ai/uploads/image — the only way Ringo AI ever gets a file into
// storage. Gated exactly like /api/ai/chat (resolveAiAccess: kill switch,
// active account, owns a profile, not a staff workspace, beta allowlist).
// Unlike the Dashboard's client-side ImageUploadField (which validates only
// in the browser), this re-checks type/size server-side and sniffs the
// file's actual bytes, since a Content-Type header can be spoofed. Writes to
// the SAME "uploads" bucket other Ringo images already use, under a NEW
// path prefix (${userId}/ai-uploads/…) — no existing folder, policy or
// upload flow is touched. Returns a public URL only; nothing is attached to
// any Ringo record here — that only happens if/when a draft using this
// image is later confirmed.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_BY_REASON: Record<string, number> = {
  not_authenticated: 401,
  disabled: 403,
  not_configured: 503,
};

export async function POST(request: Request) {
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: STATUS_BY_REASON[access.reason] ?? 403 });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "image_wrong_type" }, { status: 400 });
  if (file.size <= 0 || file.size > AI_UPLOAD_MAX_SIZE_BYTES) return NextResponse.json({ error: "image_too_large" }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeImage(bytes)) return NextResponse.json({ error: "image_wrong_type" }, { status: 400 });

  const path = aiUploadPath(access.access.workspace.userId, extFromMime(file.type));
  const supabase = createAdminClient();
  const { error } = await supabase.storage.from("uploads").upload(path, bytes, {
    upsert: false,
    cacheControl: "3600",
    contentType: file.type,
  });
  if (error) {
    console.error("ai image upload failed:", error.message);
    return NextResponse.json({ error: "image_upload_failed" }, { status: 500 });
  }

  const { data } = supabase.storage.from("uploads").getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
