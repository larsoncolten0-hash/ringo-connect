import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractRequestContext } from "@/lib/requestContext";
import { dispatchServerPixelEvents, extractClientIp } from "@/lib/pixelTracking";
import type { PixelTargetType } from "@/lib/pixelEvents";

// Used for link/product/WhatsApp click events, which originate from a
// browser interaction. Page views are logged directly in the profile
// page's server component instead, since that's already server-rendered
// and doesn't need a round trip.
//
// RLS already permits anonymous inserts into click_events (`with check
// (true)`), so this uses the regular (anon-key) server client — no
// service role needed here.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.profileId || !body?.targetType) {
    return NextResponse.json({ error: "Missing profileId or targetType" }, { status: 400 });
  }

  const { profileId, targetType, targetId } = body;
  if (!["link", "product", "whatsapp"].includes(targetType)) {
    return NextResponse.json({ error: "Invalid targetType" }, { status: 400 });
  }

  const { referrer, country, city } = extractRequestContext(request.headers);
  const supabase = createClient();

  // Own internal analytics (dashboard) and the Meta/TikTok server-side
  // sends run in parallel — a slow or failing ad-network call must never
  // delay or break our own click_events insert, and vice versa.
  const [insertResult] = await Promise.allSettled([
    supabase.from("click_events").insert({
      profile_id: profileId,
      target_type: targetType,
      target_id: targetId || null,
      referrer,
      country,
      city,
    }),
    dispatchServerPixelEvents(
      profileId,
      targetType as PixelTargetType,
      {
        // Falls back to a server-generated id only if the browser call
        // somehow didn't send one — normally ProfileView.tsx generates
        // this and fires the matching fbq/ttq call with the same id, so
        // Meta/TikTok can dedupe the two into one event.
        eventId: typeof body.eventId === "string" && body.eventId ? body.eventId : randomUUID(),
        eventSourceUrl: referrer || request.url,
        clientIp: extractClientIp(request.headers),
        userAgent: request.headers.get("user-agent"),
        fbp: request.cookies.get("_fbp")?.value || null,
        fbc: request.cookies.get("_fbc")?.value || null,
        ttp: request.cookies.get("_ttp")?.value || null,
        ttclid: request.cookies.get("ringo_ttclid")?.value || null,
        externalId: request.cookies.get("ringo_vid")?.value || null,
      },
      {
        contentName: typeof body.contentName === "string" ? body.contentName : null,
        contentId: targetId || null,
        value: typeof body.value === "number" ? body.value : null,
        currency: typeof body.currency === "string" ? body.currency : null,
      }
    ),
  ]);

  if (insertResult.status === "rejected" || insertResult.value.error) {
    const message =
      insertResult.status === "rejected" ? String(insertResult.reason) : insertResult.value.error!.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
