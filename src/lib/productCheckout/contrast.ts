// Readable colors on a seller's own brand color (WCAG relative-luminance contrast). Pure, browser-safe.
// A seller may pick any accent — including dark navy or forest green — so text placed ON the accent
// (the pay button, the selected wallet) and accent-colored text on the page background must each be
// chosen for legibility instead of assuming a mid-tone gold.

const HEX6 = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #RRGGBB colors (1–21). Unparseable input → 0. */
export function contrastRatio(a: string, b: string): number {
  if (!HEX6.test(a) || !HEX6.test(b)) return 0;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text color for content placed ON the accent: near-black or white, whichever reads better. */
export function onAccent(accent: string): string {
  if (!HEX6.test(accent)) return "#111111";
  return contrastRatio("#111111", accent) >= contrastRatio("#FFFFFF", accent) ? "#111111" : "#FFFFFF";
}

/** The accent as TEXT on the page background — or the normal text color when the accent would be hard to read there. */
export function readableAccent(accent: string, background: string, foreground: string): string {
  if (!HEX6.test(accent) || !HEX6.test(background)) return accent;
  return contrastRatio(accent, background) >= 3 ? accent : foreground;
}
