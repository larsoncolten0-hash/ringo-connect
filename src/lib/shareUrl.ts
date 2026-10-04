// The address a visitor shares from a public page. The browser's own address bar may carry the advertising and
// analytics identifiers the visitor arrived with (a Facebook, Google or TikTok click id, utm_* campaign tags);
// those belong to one visit, not to the page, and should not be passed on to the next person. Everything else
// in the address (the path, a ?service= or ?table= the page itself uses, the #section) is kept exactly as it is.
// Pure: no browser API, so it runs the same in the page and in the tests.

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "msclkid",
  "ttclid",
  "twclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
]);

export function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith("utm_") || TRACKING_PARAMS.has(n);
}

/** `href` without tracking parameters. A value that is not an absolute URL is returned unchanged. */
export function cleanShareUrl(href: string): string {
  try {
    const url = new URL(href);
    for (const key of Array.from(url.searchParams.keys())) if (isTrackingParam(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return href;
  }
}
