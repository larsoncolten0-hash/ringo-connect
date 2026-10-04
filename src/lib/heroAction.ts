// The ONE primary action at the top of a GENERIC public profile (every category except Restaurant and Music,
// which keep their own authoritative hero buttons and never come through here).
//
// Pure and synchronous on purpose: it takes plain profile data and a language, touches no React state, browser
// API, customer API or database, so the public page and the editor's live preview (the same ProfileView) get
// the same answer for the same data, and the hero never waits for anything. Whether the VISITOR can use
// Connect (signed in, already connected, the owner looking at their own page) is Connect's own business and
// deliberately not an input here.
//
// Precedence (first one that is real wins):
//   1. booking   - bookings are switched on (the existing bookings_enabled flag; wording, including a
//                  category's "Request Viewing" / "Request a Quote" / "Book a Class", comes from the existing
//                  booking configuration in categories.ts, with the owner's own button text winning)
//   2. whatsapp  - a usable WhatsApp number
//   3. phone     - a usable phone number (About)
//   4. email     - a usable e-mail address (About)
//   5. link      - the owner's first meaningful, safe link (the Phase 3A rules, shared with the links list)
//   6. connect   - nothing else is actionable: invite the visitor to Connect
// "Usable" means not blank and not a placeholder. Raw truthiness is never enough: "   " or "+" must not create a
// button that goes nowhere.
//
// Everything that is not the primary may stay as a quieter shortcut, except what repeats the primary.

import { getBookingConfig } from "./categories";
import { displayHref } from "./linkUrl";
import { isPublicLink, publicLinkTitle, publicRows } from "./publicContent";

export type HeroPrimary =
  | { kind: "booking"; label: string; href: string }
  | { kind: "whatsapp"; number: string }
  | { kind: "phone"; number: string }
  | { kind: "email"; address: string }
  | { kind: "link"; id: string; href: string; title: string; label: "website" | "link" }
  | { kind: "connect" };

export type HeroSecondary = "whatsapp" | "call" | "save";

export interface HeroAction {
  primary: HeroPrimary;
  /** Quiet shortcuts shown under the primary, never repeating it. Order is the display order. */
  secondary: HeroSecondary[];
  /** The number the Call shortcut dials (the About phone if usable, else the WhatsApp number), or null. */
  callNumber: string | null;
}

const DIGITS = /\D/g;

/** A phone / WhatsApp number a person could actually dial: 7-15 digits (E.164 allows 15), not all zeros. */
export function isUsablePhone(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const digits = v.replace(DIGITS, "");
  return digits.length >= 7 && digits.length <= 15 && /[1-9]/.test(digits);
}

// The same shape the editor asks for, minus characters that would turn a mailto: into extra headers.
const EMAIL = /^[^\s@?#&]+@[^\s@?#&]+\.[^\s@?#&]+$/;

/** An e-mail address that can safely go behind a mailto: link. */
export function isUsableEmail(v: unknown): boolean {
  return typeof v === "string" && EMAIL.test(v.trim());
}

function bookingLabel(profile: any, locale: "en" | "fr"): string {
  // identical to BookingButton: the owner's own text wins, then the category / subcategory wording
  return profile?.booking_button_text?.trim?.() || getBookingConfig(profile?.category, profile?.subcategory).buttonLabel[locale];
}

export function resolveHeroAction(profile: any, locale: "en" | "fr"): HeroAction {
  const wa = isUsablePhone(profile?.whatsapp_number) ? String(profile.whatsapp_number).trim() : null;
  const phone = isUsablePhone(profile?.about_phone) ? String(profile.about_phone).trim() : null;
  const email = isUsableEmail(profile?.about_email) ? String(profile.about_email).trim() : null;
  const username = typeof profile?.username === "string" ? profile.username.trim() : "";
  const link = publicRows<any>(profile?.links, isPublicLink).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))[0];

  let primary: HeroPrimary;
  if (profile?.bookings_enabled && username) {
    primary = { kind: "booking", label: bookingLabel(profile, locale), href: `/${username}/book` };
  } else if (wa) {
    primary = { kind: "whatsapp", number: wa };
  } else if (phone) {
    primary = { kind: "phone", number: phone };
  } else if (email) {
    primary = { kind: "email", address: email };
  } else if (link) {
    const href = displayHref(link.url);
    primary = { kind: "link", id: String(link.id ?? ""), href, title: publicLinkTitle(link), label: /^https?:/i.test(href) ? "website" : "link" };
  } else {
    primary = { kind: "connect" };
  }

  const callNumber = phone ?? wa;
  const secondary: HeroSecondary[] = [];
  if (wa && primary.kind !== "whatsapp") secondary.push("whatsapp");
  if (callNumber && primary.kind !== "phone") secondary.push("call");
  if (wa || phone) secondary.push("save");

  return { primary, secondary, callNumber };
}
