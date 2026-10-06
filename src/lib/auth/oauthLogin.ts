// Pure rules for "Continue with Google / Apple" on the Log in page. OAuth only AUTHENTICATES a person who already
// has a Ringo account; it never creates one (new accounts come from /get-started). No Supabase, no React, no
// network here, so the callback route, the button component and the tests share one definition.

export type OAuthProvider = "google" | "apple";

export type OAuthErrorKey = "cancelled" | "failed" | "no_account" | "suspended";

const ERROR_KEYS: ReadonlySet<string> = new Set(["cancelled", "failed", "no_account", "suspended"]);

/** Is `value` one of the error keys the login page knows how to word? (it arrives in a URL, so never trusted) */
export function isOAuthErrorKey(value: unknown): value is OAuthErrorKey {
  return typeof value === "string" && ERROR_KEYS.has(value);
}

/**
 * Which providers the Log in page offers. Google is always offered; Apple stays hidden until
 * NEXT_PUBLIC_APPLE_LOGIN_ENABLED is exactly "true" (Apple Developer + Supabase must be configured first).
 */
export function enabledProviders(appleFlag: string | undefined): OAuthProvider[] {
  return appleFlag === "true" ? ["google", "apple"] : ["google"];
}

/**
 * A pending team invitation token (see lib/team/invitations.ts: 32 random bytes, base64url). Anything else is
 * dropped, so it can never smuggle a path, a scheme or a query into the redirect.
 */
export function safeInviteToken(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : null;
}

/**
 * A same-site path the callback may send the person to, or null. Only an absolute PATH is accepted: it must start
 * with a single "/", carry no backslash or control character, resolve to the same origin, and not point back at the
 * callback itself. "//evil.com", "https://evil.com", "/\evil.com", "javascript:..." all give null.
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, "http://ringo.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "http://ringo.invalid") return null;
  if (parsed.pathname.startsWith("/auth/callback")) return null;
  // The URL parser has ALREADY resolved dot-segments ("/.", "/..", "/%2e") by now, so "/.//evil.com" has the
  // pathname "//evil.com". Returning that would hand back a protocol-relative URL that `new URL(path, origin)`
  // turns into https://evil.com/. A normalized path must therefore never start with a second slash.
  if (parsed.pathname.startsWith("//")) return null;
  // A percent-encoded slash or backslash in the path is never a legitimate internal path here, and a proxy or server that
  // decodes it would turn "/%2F%2Fevil.com" into "//evil.com". Refuse it rather than rely on every hop leaving it encoded.
  if (/%2f|%5c/i.test(parsed.pathname)) return null;
  const result = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  // Belt and braces: the exact value we hand back must itself resolve to the same origin.
  try {
    if (new URL(result, "http://ringo.invalid").origin !== "http://ringo.invalid") return null;
  } catch {
    return null;
  }
  return result;
}

/**
 * The URL to redirect to: `destination` resolved against `origin`, but only if it really stays on that origin;
 * otherwise (a different origin, or a value that does not parse) the fallback path on `origin`. The last line of
 * defence in front of NextResponse.redirect, so nothing upstream can send the browser to another site.
 */
export function sameOriginRedirect(destination: string, origin: string, fallback = "/dashboard"): URL {
  try {
    const target = new URL(destination, origin);
    if (target.origin === new URL(origin).origin) return target;
  } catch {
    // fall through to the fallback
  }
  return new URL(fallback, origin);
}

/**
 * What a provider (or Supabase) put in the callback query when sign-in did not complete, as one of our keys, or
 * null when there is no error. A person who closed or refused the provider's screen is "cancelled". A brand-new
 * person (Supabase could not create an account row for them: "Database error saving new user") is "no_account".
 * Everything else is a generic failure. The raw description is never shown.
 */
export function oauthErrorFromParams(params: { get(name: string): string | null }): OAuthErrorKey | null {
  const error = params.get("error");
  const code = params.get("error_code");
  const description = (params.get("error_description") || "").toLowerCase();
  if (!error && !code && !description) return null;
  if (error === "access_denied" || code === "access_denied" || code === "user_cancelled" || description.includes("access_denied") || description.includes("cancel")) return "cancelled";
  if (description.includes("database error saving new user")) return "no_account";
  return "failed";
}

/** A Supabase user object, narrowed to the one field the rule needs. */
export interface IdentityBearer {
  identities?: { provider?: string }[] | null;
}

/**
 * Does this person already have a Ringo email-and-password identity? Every existing Ringo account does (self-serve
 * signup, the admin-approved /get-started accounts). An account that exists ONLY because of this OAuth sign-in
 * has just the provider's identity, so it is not an existing Ringo account and is refused. Supabase's automatic
 * linking (same verified email) adds the provider identity to the existing user, so linked people pass.
 */
export function hasEmailIdentity(user: IdentityBearer | null | undefined): boolean {
  return !!user?.identities?.some((i) => i?.provider === "email");
}

/** Where everyone lands after signing in unless they were heading somewhere specific: Ringo Home, "how is my Ringo doing and what next". The editor is one tap away in the menu. */
export const DASHBOARD_HOME = "/dashboard/home";

/** Where a signed-in person goes next: a pending invitation first, then a safe `next`, then the role's home (Ringo Home for everyone but admins). */
export function resolveDestination(input: { role: string | null | undefined; invite?: unknown; next?: unknown }): string {
  const invite = safeInviteToken(input.invite);
  if (invite) return `/team/invite/${invite}`;
  const next = safeNextPath(input.next);
  if (next) return next;
  return input.role === "admin" ? "/admin" : DASHBOARD_HOME;
}
