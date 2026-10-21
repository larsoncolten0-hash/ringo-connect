// Custom profile addresses (david.<profile domain>). Pure helpers shared by the middleware, the dashboard API and the tests: no I/O, so they run unchanged on the edge.
//
// The profile domain comes ONLY from NEXT_PUBLIC_PROFILE_DOMAIN. It is unset until Ringo owns the domain and its wildcard DNS / Vercel domain are verified; while it is unset
// every function here reports "disabled" and the whole feature is inert. The Host header is never trusted for anything but being matched against that configured domain.

import { isPaidPlan } from "@/lib/pricing";

export const SUBDOMAIN_MIN = 3;
export const SUBDOMAIN_MAX = 30;

// A name someone released stays reserved for them this long (see the migration): printed cards and shared links to the old address must not start showing a stranger's page.
export const SUBDOMAIN_RESERVE_DAYS = 90;

export type SubdomainErrorCode = "empty" | "too_short" | "too_long" | "invalid_chars" | "edge_hyphen" | "double_hyphen" | "reserved" | "taken" | "recently_released" | "plan_required";

/**
 * Who may have a custom address: an active (not suspended) account on a PAID plan (isPaidPlan, the same rule the rest of the app uses). `account` must come from the database
 * (users.status and the plan joined through users.plan_id), never from the request. A downgrade to Free (by expiry after the grace period, self-service or admin) fails this on
 * the very next request; nothing is deleted (see planEntitlements.ts: subscription controls ACCESS, never data retention).
 */
export function profileSubdomainAllowed(account: { status?: string | null; plans?: { name?: string | null } | { name?: string | null }[] | null } | null | undefined): boolean {
  if (!account || account.status === "suspended") return false;
  const plan = Array.isArray(account.plans) ? account.plans[0] : account.plans;
  return typeof plan?.name === "string" && isPaidPlan(plan.name);
}

// Names that would imitate Ringo, its infrastructure or its own route families. Checked on the normalized name.
const RESERVED = new Set([
  "www", "app", "api", "admin", "administrator", "dashboard", "auth", "login", "logout", "signin", "signup", "register", "account", "accounts", "my", "me", "root", "system",
  "mail", "email", "smtp", "imap", "pop", "mx", "ns", "ns1", "ns2", "dns", "ftp", "sftp", "ssh", "vpn", "cdn", "static", "assets", "img", "images", "media", "files", "upload", "uploads",
  "support", "help", "status", "billing", "pay", "payment", "payments", "checkout", "invoice", "invoices", "subscription", "subscriptions", "stripe", "fapshi", "webhook", "webhooks", "cron",
  "shop", "store", "blog", "docs", "news", "about", "contact", "legal", "terms", "privacy", "cookies", "security", "abuse", "postmaster", "hostmaster", "webmaster", "noreply", "no-reply",
  "dev", "develop", "staging", "stage", "test", "testing", "demo", "preview", "beta", "alpha", "sandbox", "internal", "localhost",
  "ringo", "ringoconnect", "ringo-connect", "ringopage", "connect", "official", "team", "staff", "community", "association", "affiliate", "ambassador", "scanner", "order", "orders",
  "get-started", "m", "r", "c", "d", "book", "item", "card", "cards",
]);

/** The one normalization: trim + lowercase. Anything outside [a-z0-9-] is then rejected by validate, never silently rewritten. */
export function normalizeSubdomain(input: unknown): string {
  return typeof input === "string" ? input.trim().toLowerCase() : "";
}

/** Format + reserved-name rules. "taken" is a database fact and is decided by the API, not here. */
export function validateSubdomain(input: unknown): { ok: true; subdomain: string } | { ok: false; code: SubdomainErrorCode } {
  const s = normalizeSubdomain(input);
  if (!s) return { ok: false, code: "empty" };
  if (s.length < SUBDOMAIN_MIN) return { ok: false, code: "too_short" };
  if (s.length > SUBDOMAIN_MAX) return { ok: false, code: "too_long" };
  if (!/^[a-z0-9-]+$/.test(s)) return { ok: false, code: "invalid_chars" };
  if (s.startsWith("-") || s.endsWith("-")) return { ok: false, code: "edge_hyphen" };
  // "--" also covers the punycode prefix "xn--", so look-alike (internationalized) hostnames can never be claimed.
  if (s.includes("--")) return { ok: false, code: "double_hyphen" };
  if (RESERVED.has(s)) return { ok: false, code: "reserved" };
  return { ok: true, subdomain: s };
}

/** The configured profile domain, or null when the feature is not switched on (unset, or not a plain hostname). */
// The default reads the variable as a literal `process.env.NEXT_PUBLIC_PROFILE_DOMAIN` on purpose: Next only inlines NEXT_PUBLIC_ values written that way, and this runs in the browser and on the edge.
export function getProfileDomain(env: Record<string, string | undefined> = { NEXT_PUBLIC_PROFILE_DOMAIN: process.env.NEXT_PUBLIC_PROFILE_DOMAIN }): string | null {
  const raw = (env.NEXT_PUBLIC_PROFILE_DOMAIN || "").trim().toLowerCase();
  if (!raw) return null;
  // A bare hostname only: no scheme, path, port, wildcard or credentials. Anything else is a misconfiguration and disables the feature rather than guessing.
  if (!/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(raw)) return null;
  return raw;
}

export type HostClass =
  | { kind: "off" }                          // feature not configured, or not a profile-domain host: handle the request exactly as before
  | { kind: "apex" }                         // the profile domain itself, or a reserved name (www ...): send to the main site
  | { kind: "invalid" }                      // under the profile domain but not a single valid label (a.b.domain, bad characters, reserved): 404
  | { kind: "profile"; subdomain: string };  // a candidate customer subdomain: look it up

/** Classifies a request Host against the configured profile domain. Only a host ending in ".<domain>" (after dropping a port) is ever treated as a profile host. */
export function classifyHost(hostHeader: string | null | undefined, domain: string | null): HostClass {
  if (!domain || !hostHeader) return { kind: "off" };
  const host = hostHeader.trim().toLowerCase().replace(/:\d{1,5}$/, "").replace(/\.$/, "");
  if (host === domain) return { kind: "apex" };
  if (!host.endsWith(`.${domain}`)) return { kind: "off" };
  const label = host.slice(0, -(domain.length + 1));
  if (label === "www") return { kind: "apex" };
  if (label.includes(".")) return { kind: "invalid" };
  const v = validateSubdomain(label);
  return v.ok ? { kind: "profile", subdomain: v.subdomain } : { kind: "invalid" };
}

// What a customer subdomain may serve itself. Everything else is either refused (system routes) or sent to the main site, so a subdomain can never reach the dashboard,
// admin, auth, payment or webhook routes, nor another tenant's pages.
const PASS_THROUGH_PREFIXES = ["/_next/", "/brand/"];
const PASS_THROUGH_FILES = new Set(["/favicon.ico", "/logo.png", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/pwa-sw.js", "/robots.txt"]);
const SYSTEM_SEGMENTS = new Set([
  "dashboard", "admin", "api", "auth", "my-ringo", "scanner", "d", "c", "order", "team", "association", "community", "m-card", "get-started", "get-started-affiliate",
  "get-started-association", "get-started-cards", "dev-preview-checkout", "dev-preview-foundation", "dev-preview-profile", "dev-preview-receipt", "demo", "shop", "cookies", "privacy", "terms",
]);

export type SubdomainRoute =
  | { action: "rewrite"; pathname: string }   // serve the profile at "/"
  | { action: "next" }                        // static asset / the profile's own manifest / the page-view beacon: serve as is
  | { action: "main-site" }                   // a normal public page that lives on the main site: redirect there
  | { action: "not-found" };                  // a system route: 404 on a subdomain

export function routeSubdomainRequest(pathname: string, method: string, username: string): SubdomainRoute {
  if (pathname === "/" || pathname === "") return { action: "rewrite", pathname: `/${username}` };
  if (PASS_THROUGH_FILES.has(pathname) || PASS_THROUGH_PREFIXES.some((p) => pathname.startsWith(p))) return { action: "next" };
  if (pathname === `/${username}/manifest.webmanifest`) return { action: "next" };
  // The only API a visitor's profile page needs is its page-view / click beacon, and only as a POST.
  if (pathname === "/api/track") return method === "POST" ? { action: "next" } : { action: "not-found" };
  const first = pathname.split("/")[1] || "";
  if (SYSTEM_SEGMENTS.has(first) || pathname.includes("..") || pathname.includes("//")) return { action: "not-found" };
  return { action: "main-site" };
}

/** The public address of a custom profile, or null when the feature is off. */
export function profileAddress(subdomain: string, domain: string | null): string | null {
  return domain && subdomain ? `https://${subdomain}.${domain}` : null;
}
