// The order of the content sections on a public profile, below the hero and Connect.
//
// A profile page is the same set of sections for everyone (About / contact card, Links, the catalogue, Events,
// and for Music the tracks and releases); what differs is which ones a visitor of THAT kind of business wants
// first. A shop's visitor wants the products, a clinic's visitor wants the services, a creator's followers want
// the channel links. This module is the one place that decides, as a pure function of the category (and, where it
// matters, the subcategory) and of which sections actually have something to show. No database, no React, no
// browser: the public page and the editor preview (the same ProfileView) get the same answer for the same data.
//
// What it does NOT do: invent sections, rename them, or move the specialised layouts. Music and Restaurant keep
// the order they always had; the Restaurant menu and opening hours and Music's pinned spotlight are drawn by
// ProfileView before this list and are not part of it. Sections with nothing to show are left out (their
// components render nothing anyway); the one exception is the About card, which shows a short "no information
// yet" note when it is empty - that note is kept, but always last, so it never sits above real content.
// Booking is not a section: it is the hero's primary action (lib/heroAction.ts).

export type PublicSection = "about" | "music" | "releases" | "links" | "catalog" | "events";

export interface SectionOrderInput {
  category?: string | null;
  subcategory?: string | null;
  /** The profile has the Music & Entertainment category (primary or additional). */
  isMusic: boolean;
  /** The profile has the Restaurant & Food category (primary or additional). */
  isRestaurant: boolean;
}

/** Which sections have something a visitor could use (Phase 3A meaningful-content rules, applied by the caller). */
export interface SectionContent {
  about: boolean;
  links: boolean;
  catalog: boolean;
  events: boolean;
}

type Flexible = "catalog" | "events" | "about" | "links";

// Services, listings, courses, routes, rooms, portfolio, products: all of them are the catalogue, labelled per
// category by categories.ts. They lead for every category that sells or offers something.
const OFFER_FIRST: Flexible[] = ["catalog", "about", "links", "events"];

const BY_CATEGORY: Record<string, Flexible[]> = {
  business_ecommerce: ["catalog", "links", "about", "events"],
  events_experiences: ["events", "catalog", "about", "links"],
  professional_services: OFFER_FIRST,
  beauty_wellness: OFFER_FIRST,
  health_medical: OFFER_FIRST,
  real_estate: OFFER_FIRST,
  transport_logistics: OFFER_FIRST,
  education_training: OFFER_FIRST,
  travel_hospitality: OFFER_FIRST,
  creative_media: OFFER_FIRST,
  freelancers_creators: OFFER_FIRST,
  construction_home_services: OFFER_FIRST,
  agriculture_agribusiness: OFFER_FIRST,
};

// The long-standing order, used for "other" and for any category this module does not know.
const GENERIC: Flexible[] = ["about", "links", "catalog", "events"];

// Content creators are followed for their channels: their links come before anything they sell.
const LINKS_FIRST_SUBCATEGORIES: Record<string, Set<string>> = {
  freelancers_creators: new Set(["youtuber", "influencer", "blogger", "streamer"]),
};
const LINKS_FIRST: Flexible[] = ["links", "catalog", "about", "events"];

// Music and Restaurant: byte-for-byte the order the page always had.
const MUSIC_LEGACY: PublicSection[] = ["about", "music", "releases", "links", "catalog", "events"];
const RESTAURANT_LEGACY: PublicSection[] = ["about", "links", "catalog", "events"];

export function orderPublicSections(input: SectionOrderInput, has: SectionContent): PublicSection[] {
  if (input.isMusic) return [...MUSIC_LEGACY];
  if (input.isRestaurant) return [...RESTAURANT_LEGACY];

  const category = input.category || "";
  const linksFirst = !!input.subcategory && !!LINKS_FIRST_SUBCATEGORIES[category]?.has(input.subcategory);
  const wanted = linksFirst ? LINKS_FIRST : BY_CATEGORY[category] ?? GENERIC;

  // only what has something to show, in the category's order...
  const shown: PublicSection[] = wanted.filter((k) => has[k]);
  // ...and the empty About note, if there is one, after everything else
  if (!has.about) shown.push("about");
  return shown;
}
