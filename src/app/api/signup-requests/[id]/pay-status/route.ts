import { createAdminClient } from "@/lib/supabase/server";
import { fapshiGetStatus } from "@/lib/fapshi";
import { notifyAdmins, notifyUser, getSignupRequestReviewers } from "@/lib/notifications";
import { emailShell, sendEmail } from "@/lib/email";
import { NextResponse } from "next/server";

// Forces this route to actually run on every request instead of being
// served from Next.js's static/edge cache. This handler reads no cookies
// and no request-derived input besides the URL param, so without this it
// qualifies as statically optimizable — the FIRST response (typically
// "PENDING", checked moments after direct-pay is initiated) gets cached
// and every later poll, for every customer, replays that same frozen
// snapshot forever instead of re-checking Fapshi. That's what was causing
// the client to spin on "waiting for payment" even after a payment had
// actually gone through.
export const dynamic = "force-dynamic";

// Public — same customer-facing pattern as the pay route this checks on.
// Never trust a claimed status from the client, always re-verify with an
// authenticated GET straight to Fapshi.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { data: signupRequest } = await admin
    .from("signup_requests")
    .select("pending_fapshi_trans_id, full_name, email, referral_code")
    .eq("id", params.id)
    .single();

  if (!signupRequest?.pending_fapshi_trans_id) {
    return NextResponse.json({ error: "No payment has been started for this request." }, { status: 404 });
  }

  try {
    const tx = await fapshiGetStatus(signupRequest.pending_fapshi_trans_id);
    let justPaid = false;

    if (tx.status === "SUCCESSFUL") {
      // Marks the request as paid for the admin's review screen — without
      // this, RequestReview.tsx's "customer already paid" indicator and
      // its chargeStatus="success" seed (which unblocks account creation
      // without the admin needing to charge the customer a second time)
      // never actually had anything setting the flag they read.
      //
      // Conditioned on customer_paid still being false AND checked via the
      // UPDATE's own result (not a separate read beforehand) — the client
      // polls this endpoint every few seconds while waiting, so this is
      // what makes the notify/email fan-out below fire exactly once even
      // if two polls land back-to-back.
      const { data: updated } = await admin
        .from("signup_requests")
        .update({ customer_paid: true })
        .eq("id", params.id)
        .eq("customer_paid", false)
        .select("id");
      justPaid = (updated?.length ?? 0) > 0;
    }

    if (justPaid) {
      // Best-effort, same reasoning as the fan-out in
      // /api/signup-requests — a payment already succeeded, nothing here
      // should turn that into an error response for the customer waiting
      // on this poll.
      const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, "");
      const { adminEmails, superCreator } = await getSignupRequestReviewers(signupRequest.referral_code);

      await Promise.allSettled([
        notifyAdmins({
          type: "signup_request_paid",
          title: `Payment received — ${signupRequest.full_name}`,
          body: "Ready to review and approve.",
          link: `/admin/requests/${params.id}`,
        }),
        superCreator
          ? notifyUser(superCreator.id, {
              type: "signup_request_paid",
              title: `Payment received — ${signupRequest.full_name}`,
              body: "Ready to review and approve.",
              link: `/dashboard/requests/${params.id}`,
            })
          : Promise.resolve(),
        adminEmails.length > 0
          ? sendEmail({
              to: adminEmails,
              subject: `Payment received — ${signupRequest.full_name}`,
              html: emailShell(`
                <p style="font-size:14px; margin:0 0 16px;"><strong>${signupRequest.full_name}</strong> just paid for their plan at signup — ready for you to review and approve.</p>
                <a href="${siteUrl}/admin/requests/${params.id}" style="display:inline-block; background:#4F46E5; color:#fff; text-decoration:none; padding:10px 18px; border-radius:8px; font-size:14px; font-weight:500;">Review request</a>
              `),
            })
          : Promise.resolve(),
        superCreator?.email
          ? sendEmail({
              to: superCreator.email,
              subject: `Payment received — ${signupRequest.full_name}`,
              html: emailShell(`
                <p style="font-size:14px; margin:0 0 16px;"><strong>${signupRequest.full_name}</strong> (from your affiliate link) just paid for their plan — ready for you to review and approve.</p>
                <a href="${siteUrl}/dashboard/requests/${params.id}" style="display:inline-block; background:#4F46E5; color:#fff; text-decoration:none; padding:10px 18px; border-radius:8px; font-size:14px; font-weight:500;">Review request</a>
              `),
            })
          : Promise.resolve(),
        signupRequest.email
          ? sendEmail({
              to: signupRequest.email,
              subject: "Payment received — Ringo Connect",
              html: emailShell(`
                <p style="font-size:14px; margin:0 0 12px;">Hi ${signupRequest.full_name},</p>
                <p style="font-size:14px; margin:0;">We've received your payment. Your page is now waiting on final approval — we'll email you again as soon as it's live.</p>
              `),
            })
          : Promise.resolve(),
      ]);
    }

    // Include `reason` — Fapshi sets it on FAILED/EXPIRED transactions
    // (e.g. "insufficient funds", "user cancelled") — so the client can
    // show the customer why it failed instead of a generic message.
    return NextResponse.json({ status: tx.status, transId: tx.transId, reason: tx.reason || null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not check payment status." }, { status: 502 });
  }
}
