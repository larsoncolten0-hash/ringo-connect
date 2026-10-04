import { NextResponse } from "next/server";

// Meta WhatsApp Cloud API webhook — STAGE 1 (verification + acknowledge only).
// Public callback URL: https://www.ringoconnectltd.com/api/integrations/whatsapp/webhook
//
// This stage deliberately does nothing with the payload: no Supabase writes,
// no logging of message content, no outbound WhatsApp sends. Later stages
// will add signature verification (X-Hub-Signature-256) and persistence.

export const dynamic = "force-dynamic";

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

// Event deliveries. Parse defensively and acknowledge fast — Meta retries on
// non-2xx, so a malformed body is still answered 200 rather than looping.
// The parsed payload is intentionally discarded.
export async function POST(request: Request) {
  try {
    await request.json();
  } catch {
    // Unparseable body — ignore.
  }
  return NextResponse.json({ received: true }, { status: 200 });
}
