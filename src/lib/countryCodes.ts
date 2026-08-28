import { whereNumeric } from "iso-3166-1";

// Bridges two different country-code systems: click_events.country stores
// the plain ISO alpha-2 code Vercel's geo headers hand us (e.g. "US"),
// while the world map's topojson (Natural Earth, via world-atlas) keys
// each country shape by its ISO 3166-1 NUMERIC code (e.g. "840") — the
// standard `world-atlas`/`us-atlas` convention. A hand-rolled 240-entry
// lookup table would be one typo away from silently mis-coloring a
// country, so this defers to `iso-3166-1`'s maintained data instead.
export function numericToAlpha2(numeric: string): string | null {
  return whereNumeric(numeric)?.alpha2 || null;
}
