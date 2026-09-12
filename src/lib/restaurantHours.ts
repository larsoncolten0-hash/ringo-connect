// Shared between the public profile page and the /r/[username] ordering
// page — both need to answer "is this restaurant open right now?" from
// the same opening_hours jsonb shape profiles.opening_hours stores:
// { mon: { open: "08:00", close: "22:00", closed: false }, ... }.

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type DayHours = { open: string; close: string; closed: boolean };
export type OpeningHours = Partial<Record<DayKey, DayHours>>;

const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Today's hours for `hours`, keyed off the visitor's own local clock — a
 *  day with no entry at all is treated as open with the default hours
 *  (same default RestaurantSettingsCard seeds a brand-new day with). */
export function getTodayHours(hours: OpeningHours | null | undefined): DayHours {
  const key = DAY_KEYS[new Date().getDay()];
  return hours?.[key] || { open: "08:00", close: "22:00", closed: false };
}

/** True if the current local time falls within today's open/close window
 *  (and today isn't marked closed). Doesn't handle overnight hours that
 *  cross midnight (e.g. 6pm–2am) — a known simplification for Phase 1. */
export function isOpenNow(hours: OpeningHours | null | undefined): boolean {
  const today = getTodayHours(hours);
  if (today.closed) return false;
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = today.open.split(":").map(Number);
  const [closeH, closeM] = today.close.split(":").map(Number);
  return minutesNow >= openH * 60 + openM && minutesNow <= closeH * 60 + closeM;
}

/** "8:00 AM – 10:00 PM" style formatting for a stored "HH:MM" time. */
export function formatTime(time: string, locale: string): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(locale === "fr" ? "fr-FR" : "en-US", { hour: "numeric", minute: "2-digit" });
}
