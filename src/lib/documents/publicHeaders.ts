// Headers for everything served under a share link. The URL itself is a secret, so: never cached anywhere, never indexed, never sent
// onward as a referrer, never framed, and no sniffing.
export const PUBLIC_SHARE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Frame-Options": "DENY",
} as const;

/** The one and only answer for a link that is unknown, expired, revoked or malformed: nothing distinguishes them. */
export function uniformUnavailable(status: 404 | 429): Response {
  return new Response(JSON.stringify({ error: status === 429 ? "rate_limited" : "unavailable" }), {
    status,
    headers: { ...PUBLIC_SHARE_HEADERS, "Content-Type": "application/json" },
  });
}
