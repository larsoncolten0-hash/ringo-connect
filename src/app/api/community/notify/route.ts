import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendAnnouncementToSubscribers } from "@/lib/community/send";
import { isEmailProviderConfigured } from "@/lib/email/provider";
import { NextResponse } from "next/server";

// Owner-authenticated. The one-shot "📣 Notify community" action on a
// product (see ProductRow.tsx) — re-reads the CURRENTLY SAVED product row
// itself rather than trusting anything from the client, so it can never
// send stale unsaved edits. products.community_notified_at gates this to
// exactly once per product: a second call for the same product is refused,
// not silently re-sent. See the Community system's implementation plan for
// why this is a distinct button rather than folded into CatalogCard's bulk
// saveAll().
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const productId = body?.product_id;
  if (!productId) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
  if (!profile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }
  if (!profile.community_enabled) {
    return NextResponse.json({ error: "Turn Community on in Settings first." }, { status: 400 });
  }

  const { data: product } = await supabase
    .from("products")
    .select("id, name, description, price, image_url, community_notified_at")
    .eq("id", productId)
    .eq("profile_id", profile.id)
    .single();

  if (!product) {
    return NextResponse.json({ error: "Product not found." }, { status: 404 });
  }
  if (!product.name?.trim()) {
    return NextResponse.json({ error: "Give this product a name and save it first." }, { status: 400 });
  }
  if (product.community_notified_at) {
    return NextResponse.json({ error: "This product was already announced to your community." }, { status: 409 });
  }

  const admin = createAdminClient();

  const { data: announcement, error: announcementError } = await admin
    .from("community_announcements")
    .insert({
      profile_id: profile.id,
      title: `New: ${product.name}`.slice(0, 200),
      message: product.description?.trim() || `${product.name} is now available.`,
      image_url: product.image_url || null,
      link_type: "product",
      link_ref_id: product.id,
      audience: "email",
      notification_category: "product",
      status: "sending",
    })
    .select()
    .single();

  if (announcementError || !announcement) {
    console.error("community notify announcement insert failed:", announcementError?.message);
    return NextResponse.json({ error: "Could not send the notification — try again." }, { status: 500 });
  }

  const { recipientCount, sentCount, failedCount } = await sendAnnouncementToSubscribers(admin, announcement, profile);
  const finalStatus = recipientCount > 0 && sentCount === 0 ? "failed" : "sent";

  await admin
    .from("community_announcements")
    .update({
      status: finalStatus,
      recipient_count: recipientCount,
      sent_count: sentCount,
      failed_count: failedCount,
      sent_at: new Date().toISOString(),
    })
    .eq("id", announcement.id);

  await admin.from("products").update({ community_notified_at: new Date().toISOString() }).eq("id", product.id);

  return NextResponse.json({ status: finalStatus, recipientCount, sentCount, failedCount, providerConfigured: isEmailProviderConfigured() });
}
