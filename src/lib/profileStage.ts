// The public profile's "stage": the structural presentation that a category brings, separate from the creator's own theme.
//
// A creator's saved theme (accent, background, text, button style and radius: the profiles table's own columns, see lib/theme.ts) is
// authoritative and is never read, changed or migrated here. A stage only describes the fixed STRUCTURE around it: how tall the photo is,
// what the avatar is made of, how the name and the section headings are set, whether the content below the hero sits on a light panel,
// and what the player cards inside it are made of. Every color is a Ringo foundation token (globals.css), so a stage never introduces a
// palette of its own, and every value is a plain choice from a short list, so a category's personality is one row in a table, not a fork
// of ProfileView.
//
// Seven stages cover the sixteen categories. Categories that share a personality share a stage; "other" and any unknown category get the
// default, which is exactly what a profile rendered before stages existed.
export type StageId = "default" | "music" | "event" | "editorial" | "calm" | "expressive" | "structured";

/** The mark around the avatar.
 *  pulse  the looping accent rings: the original, and the neutral default
 *  ring   the Ringo ring, open with its node, in the creator's accent: a still signature around a person
 *  still  one accent border and no loop: calm, for hospitality and care
 *  tile   a rounded square, for a brand mark or a logo */
export type AvatarMark = "pulse" | "ring" | "still" | "tile";

export interface ProfileStage {
  id: StageId;
  /** The content panel under the hero, or null when the page's own background simply continues (the default). */
  panel: null | {
    /** CSS background and text for the panel, as foundation tokens. */
    background: string;
    text: string;
    /** The same text color as hex, for helpers that take hex (hexToRgba); kept in step with --rc-ink-2 in globals.css. */
    textHex: string;
    /** A hairline for rows and cards inside the panel. */
    border: string;
    /** The panel's surface as hex, so contrast against it can be computed (kept in step with --rc-paper in globals.css). */
    backgroundHex: string;
    className: string;
  };
  /** Dark "player" cards sitting inside a panel (tracks, tickets): always Ink, whatever the creator's theme. */
  player: { background: string; text: string } | null;
  avatar: AvatarMark;
  /** The cover photo: "tall" gives image-led categories more of the picture. */
  cover: "standard" | "tall";
  /** The name under the avatar: "upper" is the original all-caps display line, "natural" keeps the name as its owner wrote it. */
  name: "upper" | "natural";
  /** "editorial" sets every section title as a real heading in the display face; "label" leaves each section's own quiet label. */
  headings: "label" | "editorial";
  /** How an event card shows its date: "badge" is the small stamp on the thumbnail, "lead" puts a large date first, so the date is the card's anchor. */
  eventDate: "badge" | "lead";
  /** The page ends on a connection seal (the Ring between two hairlines) instead of simply stopping. */
  closingRing: boolean;
}

const DEFAULT_STAGE: ProfileStage = { id: "default", panel: null, player: null, avatar: "pulse", cover: "standard", name: "upper", headings: "label", eventDate: "badge", closingRing: false };

const PAPER_PANEL: NonNullable<ProfileStage["panel"]> = {
  background: "rgb(var(--rc-paper))",
  text: "rgb(var(--rc-ink-2))",
  textHex: "#14110A",
  border: "rgb(var(--rc-ink-2) / 0.12)",
  backgroundHex: "#FAFAF8",
  // 32px (the large-object radius), the foundation's deepest elevation, and the page's own spacing
  className: "rounded-ringo-xl p-4 sm:p-5 shadow-ringo-3",
};
const INK_PLAYER = { background: "rgb(var(--rc-ink-2))", text: "rgb(var(--rc-paper))" };

// Music: a light Paper panel below the dark hero, Ink player cards inside it, the Ring around the artist.
const MUSIC_STAGE: ProfileStage = { ...DEFAULT_STAGE, id: "music", panel: PAPER_PANEL, player: INK_PLAYER, avatar: "ring", closingRing: true };

// Events: the same Paper panel and Ink ticket cards Music uses (the ticketing components are shared), an image-led cover, and the date
// leading every event card.
const EVENT_STAGE: ProfileStage = { ...DEFAULT_STAGE, id: "event", panel: PAPER_PANEL, player: INK_PLAYER, avatar: "still", cover: "tall", eventDate: "lead", closingRing: true };

// Restaurant, Travel and Real Estate: photo-led and welcoming. A taller picture, a name set as written, real headings, a calm avatar.
const EDITORIAL_STAGE: ProfileStage = { ...DEFAULT_STAGE, id: "editorial", avatar: "still", cover: "tall", name: "natural", headings: "editorial", closingRing: true };

// Beauty, Health and Education: the same warmth without the large photograph (their pages are about people and services, not a place).
const CALM_STAGE: ProfileStage = { ...DEFAULT_STAGE, id: "calm", avatar: "still", name: "natural", headings: "editorial", closingRing: true };

// Freelancers, Creators and Creative: the person is the hero. The Ringo ring around them, their name as written, real headings.
const EXPRESSIVE_STAGE: ProfileStage = { ...DEFAULT_STAGE, id: "expressive", avatar: "ring", name: "natural", headings: "editorial", closingRing: true };

// Business, Professional, Transport, Construction and Agriculture: structured and commercial. A brand-mark tile, the all-caps name,
// each section's own compact label.
const STRUCTURED_STAGE: ProfileStage = { ...DEFAULT_STAGE, id: "structured", avatar: "tile", closingRing: true };

const STAGES: Partial<Record<string, ProfileStage>> = {
  music_entertainment: MUSIC_STAGE,
  events_experiences: EVENT_STAGE,
  restaurant_food: EDITORIAL_STAGE,
  travel_hospitality: EDITORIAL_STAGE,
  real_estate: EDITORIAL_STAGE,
  beauty_wellness: CALM_STAGE,
  health_medical: CALM_STAGE,
  education_training: CALM_STAGE,
  freelancers_creators: EXPRESSIVE_STAGE,
  creative_media: EXPRESSIVE_STAGE,
  business_ecommerce: STRUCTURED_STAGE,
  professional_services: STRUCTURED_STAGE,
  transport_logistics: STRUCTURED_STAGE,
  construction_home_services: STRUCTURED_STAGE,
  agriculture_agribusiness: STRUCTURED_STAGE,
};

/** The stage for a category id. "other", an unknown id and a missing category all get the default (the original, neutral Ringo foundation). */
export function getProfileStage(categoryId?: string | null): ProfileStage {
  return (categoryId && STAGES[categoryId]) || DEFAULT_STAGE;
}

/** The Music stage by name, for the Music components that live inside it (the tracks, releases and tickets use its Ink player cards). */
export const MUSIC = MUSIC_STAGE;
