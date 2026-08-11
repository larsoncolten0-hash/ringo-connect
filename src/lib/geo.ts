/** Full country name from an ISO 3166-1 alpha-2 code, e.g. "US" -> "United States".
 *  Same ICU-version caveat as currency names — only call this after mount,
 *  never during the render Next.js compares against server HTML. */
export function getRegionName(code: string, locale = "en"): string {
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: "region" });
    return displayNames.of(code) || code;
  } catch {
    return code;
  }
}

/** Hostname from a referrer URL, or a "Direct" label when there isn't one. */
export function getReferrerSource(referrer: string | null, directLabel: string): string {
  if (!referrer) return directLabel;
  try {
    return new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return directLabel;
  }
}