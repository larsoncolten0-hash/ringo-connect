// Server-side WhatsApp Cloud API sending (text only). Never imported by client code: it reads the access token.
//
//   POST https://graph.facebook.com/v21.0/<phone_number_id>/messages
//   Authorization: Bearer <WHATSAPP_ACCESS_TOKEN>      (server environment only; never NEXT_PUBLIC_, never logged)
//
// Meta has no idempotency key, so the outcome of one send is classified three ways and the caller acts on that (see lib/inbox/send.ts):
//   accepted  - Meta answered 2xx with a message id (wamid)                      -> record it
//   rejected  - Meta answered a definite 4xx                                     -> safe to mark failed; nothing was sent
//   unknown   - timeout, network error, 5xx, 2xx without an id, unreadable body  -> Meta may or may not have sent it: NEVER resend automatically
// Meta's own error text is never returned or logged: only a numeric code is kept, and it is mapped to a small set of safe categories.

export const GRAPH_VERSION = "v21.0";
export const SEND_TIMEOUT_MS = 10_000;
/** WhatsApp text bodies are limited to 4096 characters; the database enforces the same limit. */
export const MAX_TEXT_LENGTH = 4096;

/** The permanent System User token. Blank/missing -> null, and sending is refused (fails closed) rather than attempted. */
export function getWhatsAppAccessToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return (env.WHATSAPP_ACCESS_TOKEN || "").trim() || null;
}

export type SendErrorKind = "window_closed" | "rate_limited" | "rejected";
export type SendOutcome =
  | { kind: "accepted"; providerMessageId: string }
  | { kind: "rejected"; error: SendErrorKind; code: number | null; httpStatus: number }
  | { kind: "unknown"; reason: "timeout" | "network" | "server_error" | "bad_response" };

// 131047: re-engagement message (outside the 24h customer-service window). 130429 / 80007 / 131056: throughput or pair rate limits.
function classify(httpStatus: number, code: number | null): SendErrorKind {
  if (code === 131047) return "window_closed";
  if (httpStatus === 429 || code === 130429 || code === 80007 || code === 131056) return "rate_limited";
  return "rejected";
}

export async function sendWhatsAppText(
  args: { phoneNumberId: string; to: string; body: string; token: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SendOutcome> {
  // Both come from the database, but are validated again before being placed in a URL / payload.
  if (!/^[0-9]{5,32}$/.test(args.phoneNumberId) || !/^[0-9]{6,20}$/.test(args.to) || !args.body) {
    return { kind: "rejected", error: "rejected", code: null, httpStatus: 0 };
  }
  let res: Response;
  try {
    res = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${args.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: args.to, type: "text", text: { preview_url: false, body: args.body } }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    return { kind: "unknown", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (res.ok) {
    const id = json?.messages?.[0]?.id;
    return typeof id === "string" && id.trim() && id.length <= 256 ? { kind: "accepted", providerMessageId: id } : { kind: "unknown", reason: "bad_response" };
  }
  if (res.status >= 500 || res.status === 408) return { kind: "unknown", reason: "server_error" };
  const code = typeof json?.error?.code === "number" && Number.isInteger(json.error.code) ? (json.error.code as number) : null;
  return { kind: "rejected", error: classify(res.status, code), code, httpStatus: res.status };
}
