import { NextResponse } from "next/server";
import { getWhatsAppAccountConfig, partitionByAccount } from "@/lib/whatsapp/config";
import { dedupeEvents } from "@/lib/whatsapp/idempotency";
import { parseWhatsAppWebhook } from "@/lib/whatsapp/parseWebhook";
import { getWhatsAppAppSecret, verifyWhatsAppSignature } from "@/lib/whatsapp/signature";

// Meta WhatsApp Cloud API webhook: Phase 3 (signature verification + inbound event normalization).
// Public callback URL: https://www.ringoconnectltd.com/api/integrations/whatsapp/webhook
//
// Still deliberately does NOT persist anything, call any external API, run AI or send messages.
// Events are verified, parsed, account-checked and summarised in a metadata-only log line.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Metadata-only structured log: never bodies, phone numbers, names or secrets.
function log(entry: Record<string, unknown>) {
  console.info(JSON.stringify({ scope: "whatsapp_webhook", ...entry }));
}

// Meta's one-time subscription handshake. Echo hub.challenge back only when
// the mode and the shared verify token both match; anything else is a 403.
export async function GET(request: Request) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const params = new URL(request.url).searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (!verifyToken || mode !== "subscribe" || token !== verifyToken || challenge === null) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const appSecret = getWhatsAppAppSecret();
  if (!appSecret) {
    // Nothing to verify against: refuse rather than trust unsigned traffic.
    log({ result: "app_secret_not_configured" });
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  // Raw body first: the signature covers these exact bytes, so JSON parsing must come after.
  const rawBody = await request.text();
  if (!verifyWhatsAppSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    log({ result: "invalid_signature" });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // Signed but not JSON: acknowledge so Meta does not retry forever.
    log({ result: "malformed_json" });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const parsed = parseWhatsAppWebhook(body);
  const { accepted, rejected } = partitionByAccount(dedupeEvents(parsed.events), getWhatsAppAccountConfig());

  for (const e of rejected) {
    log({ result: "ignored_foreign_account", event: e.kind, phone_number_id: e.phoneNumberId });
  }
  for (const e of accepted) {
    log({
      result: "accepted",
      event: e.kind,
      phone_number_id: e.phoneNumberId,
      id: e.messageId,
      ...(e.kind === "message" ? { type: e.type } : { status: e.status }),
    });
  }
  if (parsed.skipped > 0) log({ result: "skipped_items", count: parsed.skipped });

  return NextResponse.json({ received: true }, { status: 200 });
}
