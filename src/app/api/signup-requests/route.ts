import { createAdminClient } from "@/lib/supabase/server";
import { isCategoryId, sanitizeCategoryIds } from "@/lib/categories";
import { NextResponse } from "next/server";
import { getSignupRequestReviewers, notifyAdmins, notifyUser } from "@/lib/notifications";
import { emailShell, sendEmail } from "@/lib/email";

// Public, unauthenticated by design — this is the whole point of the
// assisted-onboarding form. There's no session to scope a regular client
// to, and RLS on signup_requests permits INSERT only (no read/update/
// delete for anon), which would make an anon client's INSERT...RETURNING
// come back empty. The admin client is used solely to insert this one
// row and hand back its id — nothing here reads or exposes other rows.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body?.full_name?.trim() || !body?.whatsapp_number?.trim()) {
    return NextResponse.json({ error: "Name and WhatsApp number are required." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() || null : null;
  // 40 chars, not shorter — see the matching comment in src/lib/referral.ts.
  const referralCode =
    typeof body.referral_code === "string" ? body.referral_code.trim().toUpperCase().slice(0, 40) || null : null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("signup_requests")
    .insert({
      full_name: body.full_name.trim(),
      whatsapp_number: body.whatsapp_number.trim(),
      email,
      suggested_username: body.suggested_username || null,
      avatar_url: body.avatar_url || null,
      business_note: body.business_note || null,
      category: isCategoryId(body.category) ? body.category : null,
      categories: sanitizeCategoryIds(body.categories),
      // 40 chars, not shorter — see the matching comment in src/lib/referral.ts.
      referral_code: typeof body.referral_code === "string" ? body.referral_code.trim().toUpperCase().slice(0, 40) || null : null,
      delivery_location: body.delivery_location || null,
      requested_plan_id: body.requested_plan_id || null,
      requested_interval: body.requested_interval === "yearly" ? "yearly" : "monthly",
      requested_links: Array.isArray(body.requested_links) ? body.requested_links : [],
      requested_products: Array.isArray(body.requested_products) ? body.requested_products : [],
      requested_social_links: Array.isArray(body.requested_social_links) ? body.requested_social_links : [],
      requested_addon_ids: Array.isArray(body.requested_addon_ids) ? body.requested_addon_ids : [],
      // "affiliate" = submitted through /get-started-affiliate, where
      // online payment is mandatory — see the matching check in
      // /api/signup-requests/[id]/pay. Anything else falls back to the
      // regular public-form default.
      source: body.source === "affiliate" ? "affiliate" : "get_started",
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("signup_requests insert failed:", error?.message);
    // Surface the real reason (not just a generic message) so the client
    // can show what actually went wrong instead of a dead end.
    return NextResponse.json(
      { error: error?.message ? `Could not submit — ${error.message}` : "Could not submit — try again." },
      { status: 500 }
    );
  }

  // Fan-out below is best-effort — the request itself is already saved,
  // so nothing here should turn a successful submission into an error
  // response. Every notify/send call swallows its own failures; this
  // route just awaits them (rather than firing-and-forgetting) because a
  // serverless function can be frozen the instant the response is sent,
  // which would silently drop anything still in flight.
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, "");
  const reviewNote = body.source === "affiliate" ? "Submitted via the affiliate get-started page." : null;

  const { adminEmails, superCreator } = await getSignupRequestReviewers(referralCode);

  await Promise.allSettled([
    notifyAdmins({
      type: "signup_request",
      title: `New signup request — ${body.full_name.trim()}`,
      body: reviewNote,
      link: `/admin/requests/${data.id}`,
    }),
    superCreator
      ? notifyUser(superCreator.id, {
          type: "signup_request",
          title: `New signup through your link — ${body.full_name.trim()}`,
          link: `/dashboard/requests/${data.id}`,
        })
      : Promise.resolve(),
    adminEmails.length > 0
      ? sendEmail({
          to: adminEmails,
          subject: `New signup request — ${body.full_name.trim()}`,
          html: emailShell(`
            <p style="font-size:14px; margin:0 0 16px;"><strong>${body.full_name.trim()}</strong> just submitted a signup request${reviewNote ? " (affiliate page)" : ""}.</p>
            <a href="${siteUrl}/admin/requests/${data.id}" style="display:inline-block; background:#4F46E5; color:#fff; text-decoration:none; padding:10px 18px; border-radius:8px; font-size:14px; font-weight:500;">Review request</a>
          `),
        })
      : Promise.resolve(),
    superCreator?.email
      ? sendEmail({
          to: superCreator.email,
          subject: `New signup through your link — ${body.full_name.trim()}`,
          html: emailShell(`
            <p style="font-size:14px; margin:0 0 16px;">Someone just signed up through your affiliate link: <strong>${body.full_name.trim()}</strong>.</p>
            <a href="${siteUrl}/dashboard/requests/${data.id}" style="display:inline-block; background:#4F46E5; color:#fff; text-decoration:none; padding:10px 18px; border-radius:8px; font-size:14px; font-weight:500;">Review request</a>
          `),
        })
      : Promise.resolve(),
    email
      ? sendEmail({
          to: email,
          subject: "We've received your request — Ringo Connect",
          html: emailShell(`
            <p style="font-size:14px; margin:0 0 12px;">Hi ${body.full_name.trim()},</p>
            <p style="font-size:14px; margin:0 0 12px;">Thanks for signing up for Ringo Connect! Your request is in and our team is reviewing it now — we'll typically reach out on WhatsApp within a day.</p>
            <p style="font-size:14px; margin:0;">You'll get another email as soon as your page is approved and live.</p>
          `),
        })
      : Promise.resolve(),
  ]);

  return NextResponse.json({ ok: true, id: data.id });
}