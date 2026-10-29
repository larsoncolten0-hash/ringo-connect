import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { grantConsent, withdrawConsent, withdrawForSubscriber, type ConsentChannel } from "@/lib/customer/consent";

// A Community subscriber who is also a connected My Ringo customer has their marketing consent in the
// consent ledger (see src/lib/customer/consent.ts). Switching a channel OFF here records the withdrawal
// there, so a later email confirmation or synchronisation can never switch it back on; switching a
// channel ON here is an explicit grant and FAILS CLOSED if the ledger cannot record it. Subscribers with
// no linked customer (they never had an account) keep exactly the behaviour they always had.
async function linkedConnections(admin: any, subscriberId: string): Promise<Array<{ customer_id: string; profile_id: string }>> {
  const { data } = await admin.from("customer_connections").select("customer_id, profile_id").eq("community_subscriber_id", subscriberId);
  return (data || []) as Array<{ customer_id: string; profile_id: string }>;
}

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
          push_updates: prefs.push_updates ?? true,
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
    // The withdrawal is recorded first, for every linked connection and both channels. It never blocks the unsubscribe below.
    try {
      await withdrawForSubscriber(admin, subscriber.id, ["email", "push"], "community_unsubscribe");
    } catch (e) {
      console.error("community unsubscribe: consent withdrawal failed:", String((e as Error)?.message || "").slice(0, 160));
    }
    await admin
      .from("community_subscription_preferences")
      .update({ email_updates: false, whatsapp_updates: false, updated_at: new Date().toISOString() })
      .eq("subscriber_id", subscriber.id);
    // Separate write: push_updates may not exist yet (migration pending), and that must not
    // undo the two flags above.
    await admin
      .from("community_subscription_preferences")
      .update({ push_updates: false })
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
    "push_updates",
    "notify_products",
    "notify_music",
    "notify_events",
    "notify_announcements",
    "notify_offers",
  ]) {
    if (typeof body?.[key] === "boolean") patch[key] = body[key];
  }

  // Linked customers: record the decision in the consent ledger.
  //   * OFF is always applied (and recorded), connected or not: a person can always withdraw.
  //   * ON is an explicit grant. It needs an ACTIVE connection and a ledger that can record it; otherwise it is NOT applied (409 not_connected for a disconnected customer, 503 when the ledger is
  //     unavailable) and the rest of the change still is. Nothing is switched on without a recorded decision.
  const blocked: string[] = [];
  let blockedBy: "not_connected" | "consent_unavailable" = "consent_unavailable";
  const links = await linkedConnections(admin, subscriber.id);
  // Only a CHANGE is a decision. The page sends every switch each time it saves, so a switch that is unchanged (including a push default that was never a choice) is not a grant or a withdrawal.
  const { data: stored } = links.length > 0 ? await admin.from("community_subscription_preferences").select("*").eq("subscriber_id", subscriber.id).maybeSingle() : { data: null };
  const unchanged = (key: "email_updates" | "push_updates") => patch[key] === (stored ? (stored as any)[key] ?? (key === "push_updates") : key === "push_updates");
  if (links.length > 0) {
    const channels: Array<[ConsentChannel, "email_updates" | "push_updates"]> = [["email", "email_updates"], ["push", "push_updates"]];
    for (const [channel, key] of channels) {
      if (typeof patch[key] !== "boolean" || unchanged(key)) continue;
      for (const link of links) {
        if (patch[key] === false) {
          try {
            await withdrawConsent(admin, { customerId: link.customer_id, profileId: link.profile_id, channel, source: "community_manage" });
          } catch (e) {
            console.error("community preferences: consent withdrawal failed:", String((e as Error)?.message || "").slice(0, 160));
          }
          continue; // the switch is turned off below whatever happened here
        }
        try {
          const { data: c } = await admin.from("ringo_customers").select("id, name, email, phone, email_verified_at").eq("id", link.customer_id).maybeSingle();
          const customer = c ? { id: c.id, name: c.name, email: c.email, phone: c.phone ?? null, emailConfirmed: !!c.email_verified_at } : null;
          const granted = customer ? await grantConsent(admin, { customer, profileId: link.profile_id, channel, source: "community_manage" }, async () => {}) : ({ ok: false, code: "consent_unavailable" } as const);
          if (!granted.ok) {
            blocked.push(key);
            if (granted.code === "not_connected") blockedBy = "not_connected";
            delete patch[key];
          }
        } catch {
          blocked.push(key);
          delete patch[key];
        }
      }
    }
  }

  const { error: updateError } = await admin
    .from("community_subscription_preferences")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("subscriber_id", subscriber.id);
  if (updateError && "push_updates" in patch) {
    // push_updates column not created yet (migration pending): save the other fields.
    const { push_updates: _ignored, ...rest } = patch;
    await admin
      .from("community_subscription_preferences")
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq("subscriber_id", subscriber.id);
  }

  // Re-activate a previously-unsubscribed row if they turned a channel
  // back on from here.
  if (patch.email_updates === true || patch.whatsapp_updates === true || patch.push_updates === true) {
    await admin.from("community_subscribers").update({ status: "active" }).eq("id", subscriber.id);
  }

  if (blocked.length > 0) return NextResponse.json({ error: blockedBy, blocked }, { status: blockedBy === "not_connected" ? 409 : 503 });
  return NextResponse.json({ ok: true });
}
