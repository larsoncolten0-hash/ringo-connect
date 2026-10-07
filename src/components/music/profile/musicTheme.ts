// The Music profile's own atmosphere: a deep plum-black ground with warm paper text, and the ARTIST'S OWN accent for every action (their theme colour, so their choice still
// matters; the platform default is a warm gold). Fixed structure, not theme-driven, like the other category stages. Ringo's brand stays where it belongs (Connect keeps its
// Ringo indigo, the footer says Powered by Ringo Connect).
export const MP = {
  bg: "#120B10",
  surface: "#1D1219",
  raised: "#241720",
  fg: "#F3E9DC",
  muted: "#B9A99C",
  line: "rgba(243,233,220,0.08)",
  lineStrong: "rgba(243,233,220,0.16)",
  /** The one border every contained card uses (song, release, ticket, merch, link, gift, about). Dividers keep `line`. */
  border: "rgba(243,233,220,0.13)",
  cream: "#F3E9DC",
  ink: "#1A0F0A",
  coral: "#E2553A",
  whatsapp: "#1F7A4D",
} as const;

/** The poster-style face (Big Shoulders Display, loaded once for Music profiles only). */
export const DISPLAY = "font-[family-name:var(--font-mp-display)] font-black uppercase leading-[.88]";
/** Small technical labels: eyebrows, prices, dates, durations (Ringo's own micro face, tabular figures). */
export const MICRO = "font-micro tabular-nums";
