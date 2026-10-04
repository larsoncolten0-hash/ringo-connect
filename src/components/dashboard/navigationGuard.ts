// Phase 2B.6: which link clicks should be intercepted while there is genuinely unsaved work.
// Pure, so the rule can be tested. The guard only ever acts on an ordinary same-site link that would
// leave the current page state. It must never get in the way of: new-tab / modified clicks, downloads,
// mailto:/tel:/external links, in-page anchors, the public-profile link (opens a new tab), or a link to
// the page the user is already on.

export interface ClickFacts {
  /** The anchor's href attribute (as written), or null. */
  href: string | null;
  /** The anchor's target attribute. */
  target: string | null;
  download: boolean;
  /** MouseEvent.button */
  button: number;
  /** ctrl / meta / shift / alt held */
  modified: boolean;
  /** window.location.href */
  currentUrl: string;
}

/** The same-site destination (path + search + hash) to confirm before leaving, or null to let the click through. */
export function guardedNavigationTarget(c: ClickFacts): string | null {
  if (!c.href || c.download || c.modified || c.button !== 0) return null;
  if (c.target && c.target !== "_self") return null;
  let current: URL;
  let dest: URL;
  try {
    current = new URL(c.currentUrl);
    dest = new URL(c.href, current);
  } catch {
    return null;
  }
  if (dest.protocol !== "http:" && dest.protocol !== "https:") return null; // mailto:, tel:, javascript:…
  if (dest.origin !== current.origin) return null; // another site
  const samePage = dest.pathname === current.pathname && dest.search === current.search;
  if (samePage) return null; // in-page anchor or the page we are already on
  return dest.pathname + dest.search + dest.hash;
}

/** Whether leaving to `target` stays on the same path (so a hard navigation is needed to re-read ?section=). */
export function isSamePath(target: string, currentUrl: string): boolean {
  try {
    return new URL(target, currentUrl).pathname === new URL(currentUrl).pathname;
  } catch {
    return false;
  }
}
