import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Public, token-scoped by design — a subscriber has no Ringo account, so
// this is the only way they can reach/change their own row. The token is
// an unguessable uuid (community_subscribers.unsubscribe_token), never the
// row's own id — same reasoning restaurant_tables.public_code uses for its
// QR links. No anon RLS policy exists on these tables at all; this route
// (service-role admin client) is the only way in, and it only ever
// resolves exactly the one row matching the token in the URL.
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient();

  const { data: subscriber } = await admin
    .from("community_subscribers")
    .select("id, name, email, status, profiles!inner(name, username), community_subscription_preferences(*)")
    .eq("unsubscribe_token", params.token)
    .maybeSingle();

  if (!subscriber) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const prefs = subscriber.community_subscription_preferences as any;
  return NextResponse.json({
    name: subscriber.name,
    email: subscriber.email,
    status: subscriber.status,
    creatorName: (subscriber as any).profiles?.name || (subscriber as any).profiles?.username,
    preferences: prefs
      ? {
          email_updates: prefs.email_updates,
          whatsapp_updates: prefs.whatsapp_updates,
          notify_products: prefs.notify_products,
          notify_music: prefs.notify_music,
          notify_events: prefs.notify_events,
          notify_announcements: prefs.notify_announcements,
          notify_offers: prefs.notify_offers,
        }
      : null,
  });
}

export async function POST(request: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient();
  const body = await request.json().catch(() => null);

  const { data: subscriber } = await admin
    .from("community_subscribers")
    .select("id")
    .eq("unsubscribe_token", params.token)
    .maybeSingle();

  if (!subscriber) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // Full unsubscribe — flips both channel flags off and marks the
  // subscriber inactive, rather than only touching one preference.
  if (body?.unsubscribe === true) {
    await admin
      .from("community_subscription_preferences")
      .update({ email_updates: false, whatsapp_updates: false, updated_at: new Date().toISOString() })
      .eq("subscriber_id", subscriber.id);
    await admin
      .from("community_subscribers")
      .update({ status: "unsubscribed", updated_at: new Date().toISOString() })
      .eq("id", subscriber.id);
    return NextResponse.json({ ok: true });
  }

  // Otherwise, a plain preferences update — only ever the known boolean
  // fields, never an arbitrary client-supplied object.
  const patch: Record<string, boolean> = {};
  for (const key of [
    "email_updates",
    "whatsapp_updates",
    "notify_products",
    "notify_music",
    "notify_events",
    "notify_announcements",
    "notify_offers",
  ]) {
    if (typeof body?.[key] === "boolean") patch[key] = body[key];
  }

  await admin
    .from("community_subscription_preferences")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("subscriber_id", subscriber.id);

  // Re-activate a previously-unsubscribed row if they turned a channel
  // back on from here.
  if (patch.email_updates === true || patch.whatsapp_updates === true) {
    await admin.from("community_subscribers").update({ status: "active" }).eq("id", subscriber.id);
  }

  return NextResponse.json({ ok: true });
}
