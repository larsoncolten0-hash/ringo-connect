import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Generates the three PWA icon derivatives for a fan-facing profile's
// home-screen install (see /[username]/manifest.webmanifest/route.ts) —
// called once right after ImageUploadField's own direct-to-storage
// avatar upload completes (see ProfileHeaderCard.tsx), NOT computed fresh
// on every manifest request. Deliberately does NOT write anything to the
// `profiles` row itself: ProfileHeaderCard already stages every field
// (avatar_url included) locally and commits them all together in one
// explicit Save, and these three derivative URLs are just three more
// fields riding along in that same update — keeping avatar_url and its
// derivatives from ever landing in the database out of sync with each
// other.
//
// Auth: the caller's own session only — userId is taken from the
// authenticated user, never trusted from the request body, since this
// writes into that user's own storage folder.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const avatarUrl = body?.avatarUrl;
  if (!avatarUrl || typeof avatarUrl !== "string") {
    return NextResponse.json({ error: "Missing avatarUrl." }, { status: 400 });
  }

  let sourceBuffer: Buffer;
  try {
    const res = await fetch(avatarUrl);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    sourceBuffer = Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    console.error("avatar-icons: could not fetch source avatar:", err?.message);
    return NextResponse.json({ error: "Could not read the uploaded avatar." }, { status: 400 });
  }

  try {
    const [icon192, icon512, maskable512] = await Promise.all([
      sharp(sourceBuffer).resize(192, 192, { fit: "cover" }).png().toBuffer(),
      sharp(sourceBuffer).resize(512, 512, { fit: "cover" }).png().toBuffer(),
      renderMaskableIcon(sourceBuffer),
    ]);

    const folder = `${user.id}/avatar-icons`;
    const id = crypto.randomUUID();
    const uploads: [string, Buffer][] = [
      [`${folder}/${id}-192.png`, icon192],
      [`${folder}/${id}-512.png`, icon512],
      [`${folder}/${id}-maskable-512.png`, maskable512],
    ];

    for (const [path, buf] of uploads) {
      const { error } = await supabase.storage.from("uploads").upload(path, buf, {
        contentType: "image/png",
        upsert: true,
      });
      if (error) throw error;
    }

    const urlFor = (path: string) => supabase.storage.from("uploads").getPublicUrl(path).data.publicUrl;

    return NextResponse.json({
      icon192Url: urlFor(uploads[0][0]),
      icon512Url: urlFor(uploads[1][0]),
      iconMaskable512Url: urlFor(uploads[2][0]),
    });
  } catch (err: any) {
    console.error("avatar-icons: derivative generation/upload failed:", err?.message);
    return NextResponse.json({ error: "Could not generate icon derivatives." }, { status: 500 });
  }
}

// Maskable icon: Android crops this into circles/squircles/etc. depending
// on the device, so the avatar needs to sit inside a safe zone — roughly
// the inner 80% of the canvas — or risk being clipped. Padded onto a
// plain white canvas (not the profile's own theme_color/background_color)
// so the photo itself stays legible regardless of mask shape — same
// reasoning and same ~70%-inner-size convention as
// scripts/generate-pwa-icons.js's platform-logo equivalent.
async function renderMaskableIcon(sourceBuffer: Buffer): Promise<Buffer> {
  const size = 512;
  const innerSize = Math.round(size * 0.7);
  const offset = Math.round((size - innerSize) / 2);

  const resized = await sharp(sourceBuffer).resize(innerSize, innerSize, { fit: "cover" }).toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background: "#FFFFFF" },
  })
    .composite([{ input: resized, left: offset, top: offset }])
    .png()
    .toBuffer();
}
