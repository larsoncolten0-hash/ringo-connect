// The public profile's "stage": the structural presentation that a category brings, separate from the creator's own theme.
//
// A creator's saved theme (accent, background, text, button style and radius: the profiles table's own columns, see lib/theme.ts) is
// authoritative and is never read, changed or migrated here. A stage only describes the fixed STRUCTURE around it: whether the content
// below the hero sits on a light panel, what that panel is made of, and what the player cards inside it are made of. Every color is a
// Ringo foundation token (globals.css), so a stage never introduces a palette of its own.
//
// Music is the first stage. The others (Restaurant: editorial and photo-led, Business: structured, Creator: expressive, E-commerce:
// tactile) are future entries in this table, not forks of ProfileView. A category with no entry gets the default stage, which is "no
// panel": exactly what every non-Music profile renders today.
export type StageId = "default" | "music";

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
  /** The mark around the avatar: the Ringo ring in the creator's accent, instead of the looping pulse. */
  avatarRing: boolean;
  /** A closing Ring emblem above the footer: the page ends on connection. */
  closingRing: boolean;
}

const DEFAULT_STAGE: ProfileStage = { id: "default", panel: null, player: null, avatarRing: false, closingRing: false };

const MUSIC_STAGE: ProfileStage = {
  id: "music",
  panel: {
    background: "rgb(var(--rc-paper))",
    text: "rgb(var(--rc-ink-2))",
    textHex: "#14110A",
    border: "rgb(var(--rc-ink-2) / 0.12)",
    backgroundHex: "#FAFAF8",
    // 32px (the large-object radius), the foundation's deepest elevation, and the page's own spacing
    className: "rounded-ringo-xl p-4 sm:p-5 shadow-ringo-3",
  },
  player: { background: "rgb(var(--rc-ink-2))", text: "rgb(var(--rc-paper))" },
  avatarRing: true,
  closingRing: true,
};

const STAGES: Partial<Record<string, ProfileStage>> = {
  music_entertainment: MUSIC_STAGE,
};

/** The stage for a category id. Unknown or missing categories, and every non-Music category today, get the default (no panel). */
export function getProfileStage(categoryId?: string | null): ProfileStage {
  return (categoryId && STAGES[categoryId]) || DEFAULT_STAGE;
}

/** The Music stage by name, for the Music components that live inside it. */
export const MUSIC = MUSIC_STAGE;
