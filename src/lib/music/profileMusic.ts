// Pure helpers for the Music artist profile view (components/music/profile/*). No I/O, no React. Everything here DERIVES from the artist's own rows; nothing is invented, and
// nothing about how music is sold changes: a priced song still opens its own page (/m/<username>/track/<id>) where the cart, the 10-second preview and the payment live.
import { formatPrice } from "@/lib/currency";
import { safeExternalUrl } from "@/lib/linkUrl";

const CFA = new Set(["XAF", "XOF"]);

/** "1,000 FCFA" (en) / "1 000 FCFA" (fr) for the CFA franc, the platform's own currency; any other currency uses the platform's existing formatter. Never invents an amount. */
export function formatMusicPrice(amount: number | string | null | undefined, currency: string | null | undefined, locale: string = "en"): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  const code = (currency || "").toUpperCase();
  if (CFA.has(code)) {
    const num = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
    return `${num} FCFA`;
  }
  return formatPrice(n, currency || "USD", locale);
}

export type TrackAction = {
  /** What the round button does: the short protected clip, a plain play of the artist's own free upload, an outbound listen link, or nothing. */
  listen: "preview" | "play" | "external" | null;
  isProtected: boolean;
  /** The song's own page: every song has one; the cover and title always open it. */
  detailHref: string;
  /** How a fan gets the song. A priced song goes to its own page (the purchase happens there); a price-less song only has the artist's own link / WhatsApp. */
  buy: { kind: "detail"; href: string } | { kind: "external"; href: string } | { kind: "whatsapp" } | null;
  priceLabel: string | null;
};

/** The same decisions MusicSection makes for a song row, as data (protected = the full file is never public, so the player can only ever play the short clip). */
export function trackActions(track: any, ctx: { username: string; currency: string; locale: string; hasWhatsapp: boolean }): TrackAction {
  const isProtected = !!track?.protected_audio_path;
  const previewUrl = isProtected ? track?.preview_audio_url : track?.audio_url;
  const external = isProtected ? null : safeExternalUrl(track?.external_url);
  const listen: TrackAction["listen"] = previewUrl ? (isProtected ? "preview" : "play") : external ? "external" : null;

  const detailHref = `/m/${ctx.username}/track/${track?.id}`;
  const priced = !!track?.price;
  const buyUrl = isProtected ? null : safeExternalUrl(track?.buy_url);
  const canBuy = isProtected ? priced : !!buyUrl || priced;
  const buy: TrackAction["buy"] = !canBuy ? null : priced ? { kind: "detail", href: detailHref } : buyUrl ? { kind: "external", href: buyUrl } : ctx.hasWhatsapp ? { kind: "whatsapp" } : null;
  return { listen, isProtected, detailHref, buy, priceLabel: priced ? formatMusicPrice(track.price, ctx.currency, ctx.locale) || null : null };
}

/** The artist's name split over at most three display lines (one word per line up to three words; longer names pair words), so the poster-style name stacks. */
export function heroNameLines(name: string | null | undefined): string[] {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words;
  if (words.length <= 3) return words;
  const per = Math.ceil(words.length / 3);
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += per) lines.push(words.slice(i, i + per).join(" "));
  return lines;
}

/** The artist name as a normal profile heading (px): a touch larger for short names, never a poster headline. */
export function profileNameSize(name: string | null | undefined): number {
  const len = (name || "").trim().length;
  return len <= 12 ? 40 : len <= 20 ? 36 : len <= 30 ? 32 : 28;
}

/** The artist's own cover photo (NOT the avatar: the two are separate images). Null when there is none (the header then shows a plain accent-tinted ground, never a stock photo). */
export function coverImage(profile: { cover_image_url?: string | null }): string | null {
  return profile.cover_image_url || null;
}

/** A font size (px) that lets the longest line fit a ~350px column in the condensed display face, clamped so short names are large but never absurd. */
export function heroFontSize(lines: string[]): number {
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return Math.max(40, Math.min(112, Math.floor(330 / (longest * 0.47))));
}

/** Month / day of an ISO event date ("2026-11-14") in the visitor's language, or null when there is no usable date. */
export function eventDateParts(iso: string | null | undefined, locale: string): { month: string; day: number } | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { month: "short" }).replace(/\.$/, "").toUpperCase();
  return { month, day: d.getDate() };
}

/** First word of the artist's name, for "Gift Kojo" style lines (the whole name when it is one word). */
export function firstName(name: string | null | undefined): string {
  return (name || "").trim().split(/\s+/)[0] || "";
}

/** The profile's own hero image: the artist's portrait (avatar) first, then the cover photo. Null when neither exists (the hero then shows a plain tinted ground, never a stock photo). */
export function heroImage(profile: { avatar_url?: string | null; cover_image_url?: string | null }): string | null {
  return profile.avatar_url || profile.cover_image_url || null;
}
