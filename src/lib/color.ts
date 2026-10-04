export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const bigint = parseInt(full, 16) || 0;
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- Contrast helpers (Phase 3). A creator's accent is authoritative and is never changed or stored differently; these only choose a
// legible text color to put ON it, or a legible shade of it to use AS TEXT on a surface the creator did not pick (for example the
// fixed light content panel of a Music profile). Pure functions of hex strings.
function channels(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = parseInt(full, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function relativeLuminance(hex: string): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = channels(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two hex colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of `dark` / `light` reads better on `bg`: the text color for a button filled with a creator's accent. */
export function readableOn(bg: string, dark = "#14110A", light = "#FFFFFF"): string {
  return contrastRatio(bg, dark) >= contrastRatio(bg, light) ? dark : light;
}

const toHex = (c: [number, number, number]) => "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

/**
 * `accent`, as text on `surface`: the accent itself when it already reads (>= `min`), otherwise the same hue moved toward black (on a light
 * surface) or white (on a dark one) in small steps until it does. Keeps the creator's color identity; never returns something illegible.
 */
export function accentTextOn(surface: string, accent: string, min = 4.5): string {
  if (contrastRatio(surface, accent) >= min) return accent;
  const target: [number, number, number] = relativeLuminance(surface) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  const base = channels(accent);
  for (let step = 1; step <= 20; step++) {
    const t = step / 20;
    const mixed = toHex([base[0] + (target[0] - base[0]) * t, base[1] + (target[1] - base[1]) * t, base[2] + (target[2] - base[2]) * t]);
    if (contrastRatio(surface, mixed) >= min) return mixed;
  }
  return toHex(target);
}
