import { assertAdmin } from "@/lib/assertAdmin";
import { updateBrandingSettings, getBrandingSettings } from "@/lib/branding";
import { NextResponse } from "next/server";

export async function PATCH(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  try {
    await updateBrandingSettings(body, admin.id);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  return NextResponse.json({ branding: await getBrandingSettings() });
}
