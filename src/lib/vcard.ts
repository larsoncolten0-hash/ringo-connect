// Builds a vCard (.vcf) so a visitor can save this profile straight to
// their phone's own Contacts app instead of retyping the name and number
// by hand. vCard 3.0 is used over 4.0 because it's the version both
// iOS/macOS Contacts and Android's contact importer parse most reliably.

// Dedupe: the WhatsApp number and the "about" phone are very often the
// same number, and a contact with one phone listed twice looks broken.
// Shared by the vCard and the Android contact intent so both list the same numbers in the same order.
function collectPhones(profile: any): string[] {
  const phones = new Set<string>();
  if (profile?.whatsapp_number) phones.add(String(profile.whatsapp_number).trim());
  if (profile?.about_phone) phones.add(String(profile.about_phone).trim());
  for (const p of profile?.profile_phone_numbers || []) {
    if (p?.phone_number?.trim()) phones.add(p.phone_number.trim());
  }
  return [...phones];
}

export function buildVCard(profile: any, pageUrl?: string): string {
  const escape = (s: string) =>
    String(s)
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");

  const name = profile?.name?.trim() || "Contact";
  const nameParts = name.split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escape(name)}`,
    // N is only required for some Android parsers to file the contact
    // correctly — FN alone already satisfies iOS/macOS Contacts.
    `N:${escape(lastName)};${escape(firstName)};;;`,
  ];

  if (profile?.about_position) lines.push(`TITLE:${escape(profile.about_position)}`);
  if (profile?.about_company) lines.push(`ORG:${escape(profile.about_company)}`);

  for (const phone of collectPhones(profile)) {
    lines.push(`TEL;TYPE=CELL:${escape(phone)}`);
  }

  if (profile?.about_email) lines.push(`EMAIL:${escape(profile.about_email)}`);
  if (profile?.about_location) lines.push(`ADR;TYPE=WORK:;;${escape(profile.about_location)};;;;`);
  if (pageUrl) lines.push(`URL:${escape(pageUrl)}`);

  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export function vCardFileName(profile: any): string {
  const base = (profile?.name || "contact").trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${base || "contact"}.vcf`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Android: open the Contacts app's own "create contact" screen, pre-filled, instead of downloading a .vcf the visitor then has to find, open and import.
//
// How: an Android intent link (intent:#Intent;action=android.intent.action.INSERT;type=vnd.android.cursor.dir/contact;S.name=...;end). In Chrome for Android (the one browser
// whose documentation covers intent links) it is meant to hand the link to the phone's Contacts app, where the visitor reviews the pre-filled screen and taps Save themselves.
// Nothing is saved by this page, and nothing here may ever claim it was.
// Every other browser, every WebView / in-app browser, iPhone and desktop keep the vCard link untouched. If Chrome does not open anything and the page keeps focus, the existing
// vCard download runs as the fallback. Chrome only launches activities that declare the BROWSABLE category and it is NOT known whether the stock Contacts screen does:
// if it does not, the intent never opens and the visitor just gets the vCard after the wait (see ANDROID_CONTACT_INTENT_ENABLED below).
// NOT verified on a physical device yet.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const INTENT_FIELD_MAX = 200;

// One value for an intent extra: no control characters or line breaks, bounded in length, then fully percent-encoded so that ";", "=", "#" and a literal "end" can never
// close the intent or add an extra of their own (Android splits on ";" first and decodes the value afterwards).
function intentValue(raw: unknown): string {
  const clean = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, INTENT_FIELD_MAX);
  return encodeURIComponent(clean);
}

/** The Android intent link for this profile, or null when there is nothing worth pre-filling (no phone and no e-mail). Pure: same inputs, same output. */
export function buildAndroidContactIntent(profile: any, pageUrl?: string): string | null {
  const phones = collectPhones(profile);
  const email = profile?.about_email ? String(profile.about_email).trim() : "";
  if (!phones.length && !email) return null;

  const extras: [string, string][] = [["name", profile?.name?.trim() || "Contact"]];
  // Android's Contacts insert screen takes up to three numbers; any more still travel in the vCard fallback.
  const phoneKeys = ["phone", "secondary_phone", "tertiary_phone"];
  phones.slice(0, 3).forEach((p, i) => extras.push([phoneKeys[i], p]));
  if (email) extras.push(["email", email]);
  if (profile?.about_company) extras.push(["company", String(profile.about_company)]);
  if (profile?.about_position) extras.push(["job_title", String(profile.about_position)]);
  if (profile?.about_location) extras.push(["postal", String(profile.about_location)]);
  // This screen has no URL field; the profile link goes in the notes so the contact keeps a way back to the page.
  if (pageUrl) extras.push(["notes", pageUrl]);

  const parts = extras.map(([k, v]) => `S.${k}=${intentValue(v)}`);
  return `intent:#Intent;action=android.intent.action.INSERT;type=vnd.android.cursor.dir/contact;${parts.join(";")};end`;
}

/**
 * One switch for the whole Android intent path. While this is false (or if the intent turns out not to work on real phones) every browser gets the vCard download exactly as
 * before. Chrome's own documentation says it only launches activities that declare the BROWSABLE category; whether the stock Contacts "create contact" screen does is NOT
 * verified, so this has to be proven on physical devices before it is relied on.
 */
export const ANDROID_CONTACT_INTENT_ENABLED = true;

export type BrowserEnv = {
  userAgent?: string;
  /** navigator.userAgentData.platform (Chromium only). */
  userAgentDataPlatform?: string;
  /** navigator.userAgentData.brands[].brand (Chromium only), e.g. ["Not)A;Brand", "Google Chrome", "Chromium"]. */
  userAgentDataBrands?: string[];
};

// Anything that is not plain Chrome, plus in-app browsers / WebViews that commonly refuse intent links. They all keep today's behaviour (the vCard download).
// Samsung Internet and Firefox are deliberately here: there is no evidence in hand that they open this intent, and reports of intent links in Samsung Internet are mixed.
const NOT_PLAIN_CHROME =
  /; wv\)|\bwv\b|SamsungBrowser|Firefox|FxiOS|OPR\/|OPT\/|Opera|EdgA|Edg\/|UCBrowser|UBrowser|MiuiBrowser|HeyTapBrowser|OPPO|VivoBrowser|YaBrowser|Vivaldi|HuaweiBrowser|Silk|Brave|DuckDuckGo|FBAN|FBAV|FB_IAB|Instagram|Snapchat|MicroMessenger|Line\/|TikTok|musical_ly|Bytedance|Twitter|GSA\//i;
const OTHER_BRANDS = /Microsoft Edge|Opera|Samsung|Brave|Vivaldi|DuckDuckGo|Yandex|UC|Huawei/i;

/**
 * True only for Chrome on Android, the one browser whose documentation covers intent links. iPhone/iPad, desktop, every other Android browser, WebViews, in-app browsers and
 * unknown environments are false and keep the vCard link.
 */
export function supportsAndroidContactIntent(env: BrowserEnv): boolean {
  if (!ANDROID_CONTACT_INTENT_ENABLED) return false;
  const ua = env.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return false;
  // Prefer what the browser reports about itself (Chromium's User-Agent Client Hints); the user-agent string is only the fallback where that does not exist.
  const onAndroid = env.userAgentDataPlatform ? env.userAgentDataPlatform === "Android" : /Android/i.test(ua);
  if (!onAndroid) return false;
  if (NOT_PLAIN_CHROME.test(ua)) return false;
  if (env.userAgentDataBrands && env.userAgentDataBrands.length) {
    const brands = env.userAgentDataBrands;
    return brands.includes("Google Chrome") && !brands.some((b) => OTHER_BRANDS.test(b));
  }
  return /Chrome\/\d/.test(ua);
}

export type SaveContactDeps = {
  env: BrowserEnv;
  /** Start the intent (a navigation made inside the visitor's tap). */
  navigate: (url: string) => void;
  /** The existing vCard download, used when the intent seems not to have opened anything. */
  downloadVCard: () => void;
  /** True only while the page is still in front of the visitor AND has focus. A Contacts editor opening on top (even as a floating window) takes focus. */
  isPageActive: () => boolean;
  /** Call `cb` if the page is hidden / left / loses focus (the Contacts app took over). Returns an unsubscribe function. */
  onLeave: (cb: () => void) => () => void;
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Shared by every Save Contact link on the page: one attempt at a time, so repeated taps cannot start a second intent or a second download. */
  inFlight?: { current: boolean };
  waitMs?: number;
};

/**
 * Click handler for the Save Contact link. Returns true when it took over (Android Chrome intent), false when the browser should follow the link as it always did.
 * It only calls preventDefault when it takes over, so iPhone / desktop / other browsers / in-app browsers are completely unaffected.
 *
 * Fallback rules (the vCard download runs at most ONCE per tap, and only if all of these hold when the wait ends):
 *   - the page never reported being hidden, left or blurred (so the Contacts app did not take over), and
 *   - the page is still visible AND focused.
 * If the page was left, or is no longer focused, nothing is downloaded: the safe failure is "the visitor can tap again", never "an unwanted file after the editor opened".
 * A browser that silently ignores the intent while the page keeps focus is the case the fallback exists for.
 */
export function handleSaveContactClick(event: { preventDefault: () => void }, profile: any, pageUrl: string | undefined, deps: SaveContactDeps): boolean {
  if (!supportsAndroidContactIntent(deps.env)) return false;
  const intent = buildAndroidContactIntent(profile, pageUrl);
  if (!intent) return false;

  event.preventDefault();
  // A second tap while the first attempt is still being resolved is swallowed: no second intent, and no second download later.
  if (deps.inFlight?.current) return true;
  if (deps.inFlight) deps.inFlight.current = true;

  let settled = false;
  let timer: unknown = null;
  let unsubscribe: (() => void) | null = null;
  const finish = () => {
    settled = true;
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    unsubscribe?.();
    unsubscribe = null;
    if (deps.inFlight) deps.inFlight.current = false;
  };
  unsubscribe = deps.onLeave(() => {
    // The Contacts app (or any other app) took over: the intent worked, so there is nothing to fall back to.
    if (!settled) finish();
  });
  timer = deps.setTimer(() => {
    if (settled) return;
    const stillHere = deps.isPageActive();
    finish();
    if (stillHere) deps.downloadVCard();
  }, deps.waitMs ?? 2000);
  deps.navigate(intent);
  return true;
}
