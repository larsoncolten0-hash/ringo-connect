// "Opening the dashboard" always starts on Ringo Home. The Editor lives at /dashboard, and people reach it from inside the app (the Editor menu item, the dock, links in the
// dashboard, in-page redirects), so /dashboard itself must stay the Editor for those. What the owner asked for is the OTHER case: the dashboard being OPENED, not navigated within:
// typing or bookmarking the address, the installed app, a link from another site or a chat, a notification. Those requests are recognisable on the server:
// a top-level navigation whose initiator is not this site (Sec-Fetch-Site none / cross-site / same-site), or, on a browser that sends no Sec-Fetch headers, one that carries no
// Referer from this host. In-app navigation (Next's router fetches, or a same-origin click) is never redirected. Pure: no I/O.

export type EntryHeaders = {
  secFetchSite?: string | null;
  secFetchMode?: string | null;
  referer?: string | null;
  host?: string | null;
  /** Next's App Router data requests (soft navigation / prefetch) carry an RSC header. */
  rsc?: string | null;
};

const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

/** True when this request to /dashboard is the dashboard being opened from outside the app (so it should land on Ringo Home). */
export function opensDashboardFromOutside(h: EntryHeaders): boolean {
  if (h.rsc) return false; // a client-side navigation inside the app
  const mode = (h.secFetchMode || "").toLowerCase();
  if (mode && mode !== "navigate") return false; // a data / prefetch request, never a page being opened
  const site = (h.secFetchSite || "").toLowerCase();
  if (site) return site !== "same-origin";
  // No Sec-Fetch headers (older browsers): fall back to the Referer. No referer, or one from another host, means it was opened from outside.
  const ref = hostOf(h.referer);
  const host = (h.host || "").toLowerCase();
  return !ref || !host || ref !== host;
}
