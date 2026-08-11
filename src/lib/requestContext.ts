// Extracts referrer + location from request headers, server-side only.
//
// Rather than calling a third-party IP-geolocation API (extra cost,
// extra latency, another point of failure), this reads Vercel's built-in
// geo headers — populated automatically for every request on Vercel's
// edge network. Locally (and on non-Vercel hosts) these will simply be
// absent, so country/city fall back to null gracefully rather than
// throwing.
export function extractRequestContext(headers: Headers) {
  const referrer = headers.get("referer") || null;
  const country = headers.get("x-vercel-ip-country") || null;
  const rawCity = headers.get("x-vercel-ip-city");
  const city = rawCity ? decodeURIComponent(rawCity) : null;
  return { referrer, country, city };
}