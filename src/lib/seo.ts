// Search / social-sharing metadata for public Ringo pages, as pure functions: no database, no React, no
// network. profileMetadata.ts feeds them the handful of public fields it already reads, the profile page feeds
// the JSON-LD builder what it already renders, and the tests call them directly.
//
// Rules this module holds to:
//  - Only public, displayed content is used (name, bio, About role/company, avatar/cover, public social links).
//    Never email, phone, location, hours, prices, ids, tokens or anything owner-private.
//  - Nothing is invented. When there is no usable description the metadata says so with a short, honest
//    Ringo fallback; the structured data simply omits the field.
//  - Profile-controlled text is only ever data: whitespace-collapsed, control characters removed, length-bounded.
//    Next.js escapes it in <head>; the JSON-LD serializer escapes it for the <script> element.
//  - The visitor's language is not known on the server (it lives in the browser), so nothing here is, or claims
//    to be, language-specific; the fallback description is bilingual.

import type { Metadata } from "next";
import { siteBase } from "./deepLinks";
import { isPublicSocialLink } from "./publicContent";
import { normalizeLinkUrl } from "./linkUrl";

export const SITE_NAME = "Ringo Connect";
/** The existing brand share image (public/brand/ringo-og.png, 1200x630). */
export const FALLBACK_OG_IMAGE = { url: "/brand/ringo-og.png", width: 1200, height: 630, alt: SITE_NAME };

const DESCRIPTION_MAX = 200;

/** The production (or configured) site origin, no trailing slash: the one existing mechanism (lib/deepLinks). */
export function seoSiteUrl(): string {
  return siteBase();
}

// C0/C1 control characters, zero-width / bidi-override characters and the line / paragraph separators.
const charRange = (from: number, to: number) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
const UNSAFE_CHARS = new RegExp(`[\x00-\x1f\x7f-\x9f${charRange(0x200b, 0x200f)}${charRange(0x2028, 0x202e)}${charRange(0x2060, 0x2064)}${String.fromCharCode(0xfeff)}]`, "g");

/** Public text made safe for a meta tag: no control characters, whitespace collapsed, trimmed. "" if nothing is left. */
export function cleanText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim();
}

/** `cleanText` shortened to `max` characters at a word boundary, with an ellipsis. */
export function truncateText(input: unknown, max = DESCRIPTION_MAX): string {
  const text = cleanText(input);
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

function supabaseHosts(): string[] {
  const hosts: string[] = [];
  try {
    const h = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname;
    if (h) hosts.push(h.toLowerCase());
  } catch {
    // no configured project URL: only the *.supabase.co rule below applies
  }
  return hosts;
}

/**
 * An image URL that may be advertised in public metadata: absolute https, on the same public image
 * infrastructure the app already allows (next.config.js: **.supabase.co, plus the configured project host).
 * Anything else (javascript:, data:, blob:, http:, relative paths, malformed or foreign hosts, credentials in
 * the URL) is rejected, and the caller falls back to the Ringo image. Returns the normalized URL or null.
 */
export function safePublicImageUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f\s]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const allowed = host.endsWith(".supabase.co") || supabaseHosts().includes(host);
  return allowed ? url.toString() : null;
}

export interface SeoProfile {
  name?: string | null;
  username: string;
  bio?: string | null;
  about_position?: string | null;
  about_company?: string | null;
  avatar_url?: string | null;
  cover_image_url?: string | null;
  category?: string | null;
  social_links?: unknown;
}

/** The profile's display name as the page shows it. */
export function profileDisplayName(profile: Pick<SeoProfile, "name" | "username">): string {
  return cleanText(profile.name) || cleanText(profile.username);
}

/**
 * The real description of a profile, or "" when it has none: the bio, else the role / company the About card
 * displays (never its email, phone, location or hours). Used as-is by the structured data, which must not
 * carry an invented sentence.
 */
export function realProfileDescription(profile: Pick<SeoProfile, "bio" | "about_position" | "about_company">): string {
  const bio = truncateText(profile.bio);
  if (bio) return bio;
  const position = cleanText(profile.about_position);
  const company = cleanText(profile.about_company);
  return truncateText([position, company].filter(Boolean).join(" — "));
}

/** Short, honest, bilingual fallback for a profile with nothing to describe (the server cannot know the visitor's language). */
export function fallbackProfileDescription(displayName: string): string {
  return `Profil Ringo Connect de ${displayName} · ${displayName}'s Ringo Connect profile.`;
}

export function profileDescription(profile: SeoProfile): string {
  return realProfileDescription(profile) || fallbackProfileDescription(profileDisplayName(profile));
}

/** The path (no origin, no query) of a profile's public page. */
export function profilePath(username: string): string {
  return `/${encodeURIComponent(username)}`;
}

type SeoImage = { url: string; width?: number; height?: number; alt?: string };

/** The image to advertise: avatar, else cover, else the Ringo brand image. `wide` says whether it suits a large card. */
export function pickShareImage(profile: Pick<SeoProfile, "avatar_url" | "cover_image_url" | "name" | "username">): { image: SeoImage; wide: boolean } {
  const alt = profileDisplayName(profile);
  const avatar = safePublicImageUrl(profile.avatar_url);
  if (avatar) return { image: { url: avatar, alt }, wide: false };
  const cover = safePublicImageUrl(profile.cover_image_url);
  if (cover) return { image: { url: cover, alt }, wide: true };
  return { image: FALLBACK_OG_IMAGE, wide: true };
}

/** Title, description, canonical, Open Graph and Twitter for a public profile page. */
export function buildProfileSeo(profile: SeoProfile): Metadata {
  const displayName = profileDisplayName(profile);
  const title = `${displayName} | ${SITE_NAME}`;
  const description = profileDescription(profile);
  const path = profilePath(profile.username);
  const { image, wide } = pickShareImage(profile);
  return {
    metadataBase: new URL(seoSiteUrl()),
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "profile", url: path, siteName: SITE_NAME, title, description, images: [image] },
    twitter: { card: wide ? "summary_large_image" : "summary", title, description, images: [image.url] },
  };
}

export const NOINDEX = { index: false, follow: false } as const;

/**
 * An item page (product, dish, track, ticket...) as its own shareable page: canonical to itself, its own
 * title / description / image, falling back to the profile's. `base` is the profile's metadata.
 */
export function withItemSeo(
  base: Metadata,
  item: { path: string; title: string; description?: unknown; image?: unknown }
): Metadata {
  const title = truncateText(item.title, 120) || (typeof base.title === "string" ? base.title : SITE_NAME);
  const description = truncateText(item.description) || (typeof base.description === "string" ? base.description : undefined);
  const own = safePublicImageUrl(item.image);
  const baseImages = (base.openGraph as any)?.images;
  const images = own ? [{ url: own }] : baseImages;
  const twitterImages = own ? [own] : (base.twitter as any)?.images;
  const card = own ? "summary_large_image" : (base.twitter as any)?.card ?? "summary_large_image";
  return {
    ...base,
    title,
    description,
    alternates: { canonical: item.path },
    openGraph: { ...(base.openGraph as any), type: "website", url: item.path, title, description, images },
    twitter: { ...(base.twitter as any), card, title, description, images: twitterImages },
  };
}

/** The same page with a different title (e.g. a shared booking link that previews as one service); canonical is untouched. */
export function withTitle(base: Metadata, rawTitle: string): Metadata {
  const title = truncateText(rawTitle, 120);
  if (!title) return base;
  return { ...base, title, openGraph: { ...(base.openGraph as any), title }, twitter: { ...(base.twitter as any), title } };
}

// ----------------------------------------------------------------------------------------------- JSON-LD

// Categories that are businesses by nature, not individuals. Everything else is decided by the profile's own
// data (a role on the About card = a person) or left untyped rather than guessed.
const ORGANIZATION_CATEGORIES = new Set([
  "business_ecommerce",
  "restaurant_food",
  "transport_logistics",
  "travel_hospitality",
  "construction_home_services",
  "agriculture_agribusiness",
  "education_training",
  "events_experiences",
]);
const PERSON_CATEGORIES = new Set(["freelancers_creators"]);

/** "Person", "Organization", or null when the profile's own data does not say which. */
export function entityType(profile: Pick<SeoProfile, "category" | "about_position" | "about_company">): "Person" | "Organization" | null {
  if (cleanText(profile.about_position)) return "Person";
  if (PERSON_CATEGORIES.has(profile.category || "")) return "Person";
  if (ORGANIZATION_CATEGORIES.has(profile.category || "")) return "Organization";
  if (cleanText(profile.about_company)) return "Organization";
  return null;
}

/** The public social profiles of a profile as http(s) URLs, de-duplicated, in the owner's order. */
export function publicSameAs(socialLinks: unknown): string[] {
  const out: string[] = [];
  for (const row of Array.isArray(socialLinks) ? socialLinks : []) {
    if (!isPublicSocialLink(row)) continue;
    const check = normalizeLinkUrl((row as any).url);
    if (!check.ok) continue;
    let url: URL;
    try {
      url = new URL(check.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const href = url.toString();
    if (!out.includes(href)) out.push(href);
  }
  return out;
}

/**
 * Conservative schema.org ProfilePage for a public profile: name, url, image (a real, safe avatar/cover only),
 * description (only when the profile really has one) and public social URLs. No address, phone, hours,
 * prices, ratings or anything else. Returns null for a profile that must not carry structured data.
 */
export function buildProfileJsonLd(profile: SeoProfile & { is_demo?: boolean | null }): Record<string, unknown> | null {
  if (profile.is_demo) return null;
  const name = profileDisplayName(profile);
  if (!name || !profile.username) return null;
  const url = `${seoSiteUrl()}${profilePath(profile.username)}`;
  const image = safePublicImageUrl(profile.avatar_url) || safePublicImageUrl(profile.cover_image_url);
  const description = realProfileDescription(profile);
  const sameAs = publicSameAs(profile.social_links);
  const type = entityType(profile);

  const page: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url,
    name,
  };
  if (type) {
    const entity: Record<string, unknown> = { "@type": type, name, url };
    if (image) entity.image = image;
    if (description) entity.description = description;
    if (sameAs.length) entity.sameAs = sameAs;
    page.mainEntity = entity;
  }
  return page;
}

/** JSON for a `<script type="application/ld+json">` body that profile-controlled text cannot break out of. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .split(String.fromCharCode(0x2028))
    .join("\\u2028")
    .split(String.fromCharCode(0x2029))
    .join("\\u2029");
}
