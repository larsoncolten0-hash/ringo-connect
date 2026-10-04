import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getWhatsAppAccountConfig, partitionByAccount } from "@/lib/whatsapp/config";
import { dedupeEvents } from "@/lib/whatsapp/idempotency";
import { parseWhatsAppWebhook } from "@/lib/whatsapp/parseWebhook";
import { IngestFailure, ingestEvent } from "@/lib/whatsapp/ingest";
import { getWhatsAppAppSecret, verifyWhatsAppSignature } from "@/lib/whatsapp/signature";

// Meta WhatsApp Cloud API webhook: signature verification, event normalization and (Phase 4) persistence.
// Public callback URL: https://www.ringoconnectltd.com/api/integrations/whatsapp/webhook
//
// Order is fixed: raw body -> HMAC signature -> JSON parse -> normalize -> account allowlist -> persist.
// Persistence hands each accepted, normalized event to the Phase 4 database functions (see lib/whatsapp/ingest.ts). The owner
// profile is derived by the database from the phone_number_id; nothing from the request is trusted as an owner.
// Answers: 200 for stored, duplicate or deliberately ignored events; 5xx ONLY when the database fails, so Meta retries (safe: the
// unique indexes make redelivery idempotent). Still no outbound messages, AI, media download or other external call.

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

  if (accepted.length > 0) {
    // Every event is attempted even if an earlier one fails, so one bad event cannot block the rest; any failure then
    // fails the whole delivery (5xx) and Meta redelivers it. Already-stored events come back as "duplicate".
    let failed = 0;
    let client: ReturnType<typeof createAdminClient> | null = null;
    try {
      client = createAdminClient();
    } catch {
      client = null;
    }
    for (const e of accepted) {
      try {
        if (!client) throw new IngestFailure("client_unavailable");
        const outcome = await ingestEvent(client, e);
        // Metadata only. A non-created/duplicate outcome is deliberate and acknowledged: retrying cannot change it.
        log({ result: "ingest", ingest: outcome, event: e.kind, phone_number_id: e.phoneNumberId, id: e.messageId });
      } catch (err) {
        failed++;
        // Code only: database error text can echo row data (message bodies, numbers), so it is never logged.
        console.error(JSON.stringify({ scope: "whatsapp_webhook", result: "ingest_failed", event: e.kind, phone_number_id: e.phoneNumberId, id: e.messageId, code: err instanceof IngestFailure ? err.code : "unknown" }));
      }
    }
    if (failed > 0) return NextResponse.json({ error: "ingest_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
