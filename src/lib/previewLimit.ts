// The ONE definition of how long an unpurchased track may be previewed.
//
// Product rule: unpurchased music = at most a 10-second preview; the full
// track is available only through the paid-order-authorized signed-URL route
// (/api/music/tracks/[id]/audio), which this constant has nothing to do with.
//
// Kept in its own tiny module (not in audioTrim.ts) because the public
// profile's player needs the number at runtime, and audioTrim.ts imports the
// MP3 encoder — pulling that into every public page's bundle just to read a
// constant would be wasteful. audioTrim.ts re-exports it, so existing imports
// keep working.
export const MAX_PREVIEW_SECONDS = 10;
