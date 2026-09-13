import { Webhook } from "svix";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Resend's delivery-event webhook — PHASE 4 of the email deliverability
// work. Configure this URL in the Resend dashboard (Webhooks → Add
// Endpoint), subscribed at minimum to: email.delivered, email.bounced,
// email.complained, email.failed.
//
// Resend signs webhook requests via Svix (https://resend.com/docs/
// dashboard/webhooks/verify-webhooks-requests) — svix-id/svix-timestamp/
// svix-signature headers, verified here with the official `svix` package
// rather than a hand-rolled HMAC check, since getting a security-critical
// verification like this subtly wrong (timestamp tolerance, header
// canonicalization, multi-signature support) is exactly the kind of thing
// worth a maintained library for. NEVER trust an unverified request body —
// see the 401 branch below.
//
// This is the first webhook receiver this app has that isn't Stripe/
// Fapshi's existing pattern (see src/app/api/billing/stripe/webhook,
// .../fapshi/webhook) — same posture, new provider: verify the signature
// before touching the body at all, and treat every event as possibly a
// retry/redelivery (idempotent updates only, never an insert that would
// duplicate a row on a second delivery of the same event).
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("Resend webhook received but RESEND_WEBHOOK_SECRET is not configured.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  // The raw, unparsed body — Svix's signature covers these exact bytes,
  // so parsing/re-serializing JSON first (even losslessly) would break
  // verification for some payloads.
  const payload = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") || "",
    "svix-timestamp": request.headers.get("svix-timestamp") || "",
    "svix-signature": request.headers.get("svix-signature") || "",
  };

  let event: any;
  try {
    // svix's verify() only verifies — it deliberately returns `undefined`,
    // not the parsed payload (confirmed against the installed package's
    // own source; this is easy to assume otherwise from libraries that DO
    // hand back the parsed body). It throws on a bad signature, so a
    // successful call here is the actual proof this payload is genuine;
    // only then is it safe to parse and act on.
    new Webhook(secret).verify(payload, headers);
    event = JSON.parse(payload);
  } catch (err: any) {
    console.error("Resend webhook signature verification failed:", err?.message || err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();
  const data = event?.data || {};
  const messageId: string | undefined = data.email_id;
  const recipients: string[] = Array.isArray(data.to) ? data.to : typeof data.to === "string" ? [data.to] : [];

  const updateLogStatus = async (status: "delivered" | "bounced" | "complained" | "failed", error: string | null) => {
    if (!messageId) return;
    let query = admin.from("email_delivery_logs").update({ status, ...(error ? { error } : {}) }).eq("provider_message_id", messageId);
    // Resend fires one event per affected recipient for a multi-recipient
    // send — scope the update to that recipient when it's present rather
    // than flipping every row that shares this message id, so one
    // person's bounce on a 3-admin fan-out doesn't mislabel the other two.
    if (recipients.length > 0) query = query.in("recipient_email", recipients);
    await query;
  };

  const suppress = async (reason: "bounced" | "complained", sourceEvent: string) => {
    if (recipients.length === 0) return;
    await admin
      .from("email_suppressions")
      .upsert(
        recipients.map((email) => ({ email: email.toLowerCase(), reason, source_event: sourceEvent })),
        { onConflict: "email", ignoreDuplicates: true }
      );
  };

  switch (event?.type) {
    case "email.delivered":
      await updateLogStatus("delivered", null);
      break;

    case "email.bounced": {
      const bounceMessage = data.bounce?.message || null;
      await updateLogStatus("bounced", bounceMessage);
      // Resend's own "type" already distinguishes a permanent rejection
      // (mailbox doesn't exist, domain doesn't exist) from a transient one
      // (mailbox full, server temporarily down) — only a permanent bounce
      // means the address itself is bad; a transient one deserves another
      // attempt later, not a standing suppression.
      if (data.bounce?.type === "Permanent") {
        await suppress("bounced", "email.bounced");
      }
      break;
    }

    case "email.complained":
      await updateLogStatus("complained", null);
      // A spam complaint is unambiguous, unlike a bounce — always suppress,
      // no type check needed.
      await suppress("complained", "email.complained");
      break;

    case "email.failed":
      await updateLogStatus("failed", data.failed?.reason || null);
      break;

    default:
      // email.sent/opened/clicked/scheduled/delivery_delayed and anything
      // else — acknowledged, not tracked. 'sent' is already recorded at
      // send time by provider.ts itself; open/click tracking isn't
      // something this app's delivery log needs.
      break;
  }

  return NextResponse.json({ received: true });
}
