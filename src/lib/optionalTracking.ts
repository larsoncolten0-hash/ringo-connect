// The one switch for OPTIONAL advertising / marketing tracking: the Meta and TikTok pixels a page owner can save in their settings, the server-side Meta Conversions API / TikTok Events API
// events that go with them, and the random visitor identifier (`ringo_vid`) and TikTok click id (`ringo_ttclid`) cookies that exist only to match those events.
//
// It is OFF until Ringo has an explicit visitor-choice mechanism: nothing in this group may happen silently. The saved pixel ids and tokens stay untouched (so turning this on later restores
// the feature with no data loss). Essential and first-party functional behaviour does NOT depend on this switch: sign-in, checkout, payments, the first-party click statistics (click_events),
// referral attribution and the language / theme preferences all work exactly as before.
export const OPTIONAL_TRACKING_ENABLED: boolean = false;

// Cookies the optional tracking used to leave in a visitor's browser (Ringo's own two, plus the ones Meta's and TikTok's scripts set on this site). While the switch is off, the page removes
// them, so a visitor who already had one from an earlier visit does not keep it for up to a year.
const OPTIONAL_TRACKING_COOKIES = ["ringo_vid", "ringo_ttclid", "_fbp", "_fbc", "_ttp"];

export function clearOptionalTrackingCookies(): void {
  try {
    for (const name of OPTIONAL_TRACKING_COOKIES) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  } catch {
    // cookies unavailable: nothing to clear
  }
}
