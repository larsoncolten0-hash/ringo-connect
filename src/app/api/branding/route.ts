import { getBrandingSettings } from "@/lib/branding";
import { NextResponse } from "next/server";

// Public and unauthenticated by design — nothing in BrandingSettings is
// secret, and this is what lets AuthShell.tsx (rendered from Client
// Components — see its own comment on why it can't import
// src/lib/branding.ts directly) show the platform's real logo/name on
// the logged-out login/signup panel.
//
// force-dynamic: this route has no cookies/headers dependency, so
// without this Next.js would treat it as static and cache the response
// from whenever it was first built — meaning an admin's change in
// /admin/branding would never reach AuthShell's client-side fetch until
// the next deploy. Every other branding read site (dashboard/admin/
// landing layouts) already lives on a page with its own
// `dynamic = "force-dynamic"` for unrelated reasons, so this route is
// the one place that needed it added explicitly.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getBrandingSettings());
}
