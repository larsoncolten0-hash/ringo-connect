import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const MAX_SIZE_BYTES = 2 * 1024 * 1024;

// Logo/favicon upload for /admin/branding — a server-side route using the
// service-role client (unlike ImageUploadField.tsx's direct client-side
// storage upload) because there's no per-user path this could scope a
// storage RLS policy to: these files belong to the platform, not a
// creator, and this repo's `uploads` bucket policies live in the live
// Supabase project, not in a tracked migration this session can inspect
// or safely extend. Going through the admin client sidesteps needing to
// know or add one.
export async function POST(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const kind = formData?.get("kind"); // "logo" | "favicon" — path/labeling only

  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Please choose an image file." }, { status: 400 });
  if (file.size > MAX_SIZE_BYTES) return NextResponse.json({ error: "Images must be under 2MB." }, { status: 400 });

  const ext = file.name.split(".").pop() || "png";
  const label = kind === "favicon" ? "favicon" : "logo";
  const path = `branding/${label}-${crypto.randomUUID()}.${ext}`;

  const supabase = createAdminClient();
  const { error: uploadError } = await supabase.storage.from("uploads").upload(path, file, {
    upsert: true,
    cacheControl: "3600",
    contentType: file.type,
  });
  if (uploadError) {
    console.error("branding upload failed:", uploadError.message);
    return NextResponse.json({ error: "Upload failed. Try again." }, { status: 500 });
  }

  const { data } = supabase.storage.from("uploads").getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
