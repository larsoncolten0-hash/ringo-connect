import { accentTextOn, contrastRatio, hexToRgba, readableOn } from "@/lib/color";

// The Churches & Ministries template's own visual language: warm linen paper, deep ink, one evening-slate band, and a serif voice for headings. Used only by the
// church site (ChurchSiteView) and the church cards it composes, so no other category changes. The owner's accent still drives every action; it is adjusted here
// to stay readable on these surfaces (contrast is computed, never assumed).

export const CH = {
  /** Page ground: warm linen. */
  paper: "#F7F2E9",
  /** Raised surface on the ground (cards, the visit panel). */
  surface: "#FFFDF8",
  /** Body text. 15.9:1 on paper. */
  ink: "#1C1915",
  /** Secondary text, tinted from the ink (7.1:1 on paper), never a neutral gray. */
  muted: "#5E554B",
  /** Hairlines and card edges. */
  line: "rgba(28, 25, 21, 0.12)",
  /** The one dark band (hero without a cover, testimonies): evening slate. */
  night: "#18212B",
  /** Text on the night band. */
  nightText: "#F4EEE4",
  nightMuted: "#C9C0B2",
} as const;

/** The display serif (Literata: a bookish reading face, at home with Scripture and French accents), with fallbacks that keep the same warm, bookish character while it loads (or in the editor preview, where it is not loaded). */
export const SERIF = `"Literata", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`;

/** Loaded only by the church site (a plain stylesheet link, so the offline test renderer can render the real page). */
export const SERIF_HREF = "https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,500;0,7..72,600;1,7..72,500&display=swap";

export interface ChurchPalette {
  accent: string;
  /** The accent as text on the paper ground. */
  accentText: string;
  /** The accent as text on the night band. */
  accentOnNight: string;
  /** Text colour on an accent-filled button. */
  onAccent: string;
  /** A soft accent wash for the selection colour and quiet highlights. */
  accentWash: string;
}

/** The owner's accent, only if it is a 6-digit hex colour (the editor stores free text, and the church site writes a few colours into a style rule); otherwise the Ringo gold. */
export function safeAccent(accent: unknown): string {
  return typeof accent === "string" && /^#[0-9a-f]{6}$/i.test(accent.trim()) ? accent.trim() : "#D4A954";
}

export function churchPalette(accent: string): ChurchPalette {
  accent = safeAccent(accent);
  return {
    accent,
    accentText: accentTextOn(CH.paper, accent, 4.5),
    accentOnNight: accentTextOn(CH.night, accent, 4.5),
    onAccent: readableOn(accent, CH.ink, "#FFFFFF"),
    accentWash: hexToRgba(accent, 0.22),
  };
}

/** The props every church card takes, filled for the church site's paper ground. */
export function churchCardTheme(p: ChurchPalette) {
  return { accent: p.accent, accentText: p.accentText, textColor: CH.ink, borderTint: CH.line, radiusClass: "rounded-[22px]" };
}

export interface ChurchHeroTheme {
  /** The hero's background (the owner's Appearance background), and the gradient's far end when the owner chose a gradient (else the same colour). */
  bg: string;
  bgEnd: string;
  gradient: boolean;
  /** Body text on the hero: the owner's text colour when it reads on the whole background, otherwise black or white, whichever does. */
  ink: string;
  /** The accent as text on the hero (adjusted like every accent text on this page). */
  accentText: string;
}

const HEX6 = /^#[0-9a-f]{6}$/i;
const pick = (v: unknown, fallback: string): string => (typeof v === "string" && HEX6.test(v.trim()) ? v.trim() : fallback);

/** The owner's Appearance settings (background colour, text colour, solid or gradient) for the church hero. These kept their meaning when the church got its own
 *  template: they paint the hero, and the content below sits on the church's fixed linen ground (as it sat on the shared Paper panel before). Nothing the owner can
 *  choose can make the hero unreadable: text and accent text are checked against BOTH ends of a gradient, and an unusable value falls back to the page default. */
export function churchHeroTheme(profile: { background_color?: unknown; text_color?: unknown; background_style?: unknown; background_gradient_end?: unknown }, accent: string): ChurchHeroTheme {
  const bg = pick(profile.background_color, "#0A0A0A");
  let gradient = profile.background_style === "gradient";
  let bgEnd = gradient ? pick(profile.background_gradient_end, bg) : bg;
  const wanted = pick(profile.text_color, "#FAFAFA");
  const worst = (c: string) => Math.min(contrastRatio(c, bg), contrastRatio(c, bgEnd));
  let ink = [wanted, "#14110A", "#FFFFFF"].find((c) => worst(c) >= 4.5);
  if (!ink) {
    // a gradient whose two ends are so far apart that no text colour reads across it (white to black): the hero uses the starting colour alone, where black or white always reads
    gradient = false;
    bgEnd = bg;
    ink = [wanted, "#14110A", "#FFFFFF"].find((c) => worst(c) >= 4.5) as string;
  }
  const onStart = accentTextOn(bg, accent, 4.5);
  const adjusted = gradient && bgEnd !== bg ? accentTextOn(bgEnd, onStart, 4.5) : onStart;
  // on a mid-tone background (a gold accent on a gold hero) no shade of the accent reads: use the hero's own text colour instead
  const accentText = worst(adjusted) >= 4.5 ? adjusted : ink;
  return { bg, bgEnd, gradient, ink, accentText };
}
