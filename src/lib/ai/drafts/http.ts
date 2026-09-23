// Draft mutations (apply / discard) are cookie-authenticated, so they also
// refuse cross-site requests: a browser always sends Origin on POST/DELETE,
// and Sec-Fetch-Site when it supports it. Both must say "this site".
export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return !!site; // no Origin: only trust a same-origin Sec-Fetch-Site
  try {
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}
