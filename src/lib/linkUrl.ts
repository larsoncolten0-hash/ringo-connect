// One definition of "a link address the editor accepts", shared by the editor (when a link is added or
// saved) and the public page (when a stored address is rendered).
//
// Documented behaviour (the editor shows it to the user as a hint):
//   - surrounding spaces are removed;
//   - a bare web address such as "example.com" or "instagram.com/name" gets "https://" added in front.
//     This happens when the link is SAVED, so the user sees the final address in their list, and the
//     same rule is applied when an older stored address is displayed, so addresses saved before this
//     rule existed no longer turn into broken relative links;
//   - addresses that already have a scheme are kept as typed if the scheme is one we allow:
//     http, https, mailto, tel, sms, whatsapp;
//   - anything else is rejected with a message: "javascript:" and other script/data schemes (a link
//     must never run code), text that is not a web address, and an empty or scheme-only value.
// Deliberately light: no reachability check, no TLD list, no blocking of legitimate local or African
// domains (.cm, .co.za, …) and no rewriting of anything that already has an allowed scheme.

export type LinkUrlCheck =
  | { ok: true; url: string; changed: boolean }
  | { ok: false; reason: "empty" | "invalid" };

const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel", "sms", "whatsapp"]);
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
// "name.tld" optionally followed by a path / query / fragment; no spaces
const BARE_HOST = /^[^\s/?#@:]+\.[^\s/?#@:.]{2,}([/?#]\S*)?$/i;

export function normalizeLinkUrl(input: unknown): LinkUrlCheck {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { ok: false, reason: "empty" };

  const scheme = SCHEME.exec(raw)?.[1]?.toLowerCase();
  if (scheme) {
    if (!ALLOWED_SCHEMES.has(scheme)) return { ok: false, reason: "invalid" };
    const rest = raw.slice(scheme.length + 1).replace(/^\/+/, "").trim();
    if (!rest) return { ok: false, reason: "empty" }; // "https://", "mailto:" with nothing after it
    if (scheme === "http" || scheme === "https") {
      try {
        if (!new URL(raw).hostname) return { ok: false, reason: "invalid" };
      } catch {
        return { ok: false, reason: "invalid" };
      }
    }
    return { ok: true, url: raw, changed: raw !== (typeof input === "string" ? input : raw) };
  }

  if (raw.startsWith("//")) {
    const candidate = `https:${raw}`;
    return normalizeLinkUrl(candidate).ok ? { ok: true, url: candidate, changed: true } : { ok: false, reason: "invalid" };
  }
  if (BARE_HOST.test(raw)) return { ok: true, url: `https://${raw}`, changed: true };
  return { ok: false, reason: "invalid" };
}

/**
 * What to put in an href for a stored value: the normalised address, or "#". Anything that fails the same
 * rules the editor enforces on save (including obfuscated schemes such as "java	script:" that a browser
 * would still run) is never passed through as a link.
 */
export function displayHref(stored: unknown): string {
  const check = normalizeLinkUrl(stored);
  return check.ok ? check.url : "#";
}
