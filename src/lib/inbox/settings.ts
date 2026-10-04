// Inbox automation settings: the shape, defaults and checks shared by the settings page (browser) and the save route (server).
// Browser-safe: no Node module, no secret. The DATABASE re-validates every value (inbox_settings_save), so these checks are only for a clear
// message before saving. Everything defaults to OFF.

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];
export type HoursMap = Partial<Record<Day, [string, string][]>>;
export type AckMode = "off" | "outside_hours" | "always";

export interface InboxSettings {
  timezone: string;
  businessHours: HoursMap;
  autoAckMode: AckMode;
  autoAckText: string;
  followUpEnabled: boolean;
  followUpAfterHours: number;
  notifyNewConversation: boolean;
  notifyFailedMessage: boolean;
  notifyFollowUp: boolean;
  notificationLocale: "en" | "fr";
}

export const ACK_MAX = 500;
export const DEFAULT_TIMEZONE = "Africa/Douala";
export const DEFAULT_SETTINGS: InboxSettings = {
  timezone: DEFAULT_TIMEZONE,
  businessHours: {},
  autoAckMode: "off",
  autoAckText: "",
  followUpEnabled: false,
  followUpAfterHours: 24,
  notifyNewConversation: true,
  notifyFailedMessage: true,
  notifyFollowUp: true,
  notificationLocale: "fr",
};

export type SettingsErrorKey = "ackTextRequired" | "ackTooLong" | "hoursInvalid" | "timezoneInvalid" | "followHoursInvalid" | "saveFailed";

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const isDay = (v: unknown): v is Day => typeof v === "string" && (DAYS as readonly string[]).includes(v);

export function isValidTimezone(tz: unknown): boolean {
  if (typeof tz !== "string" || tz.trim() === "" || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/** Well-formed weekly hours: known days only, at most 3 intervals a day, "HH:MM", start before end. */
export function isValidHours(h: unknown): h is HoursMap {
  if (!h || typeof h !== "object" || Array.isArray(h)) return false;
  for (const [day, intervals] of Object.entries(h as Record<string, unknown>)) {
    if (!isDay(day) || !Array.isArray(intervals) || intervals.length > 3) return false;
    for (const i of intervals) {
      if (!Array.isArray(i) || i.length !== 2 || typeof i[0] !== "string" || typeof i[1] !== "string") return false;
      if (!TIME.test(i[0]) || !TIME.test(i[1]) || i[0] >= i[1]) return false;
    }
  }
  return true;
}

/** The row as stored (snake_case) -> the settings the page works with. Anything missing or odd falls back to the safe default. */
export function settingsFromRow(row: Record<string, unknown> | null | undefined): InboxSettings {
  if (!row) return { ...DEFAULT_SETTINGS, businessHours: {} };
  const mode = row.auto_ack_mode === "always" || row.auto_ack_mode === "outside_hours" ? row.auto_ack_mode : "off";
  const hours = isValidHours(row.business_hours) ? (row.business_hours as HoursMap) : {};
  const after = typeof row.follow_up_after_hours === "number" && row.follow_up_after_hours >= 1 && row.follow_up_after_hours <= 168 ? Math.floor(row.follow_up_after_hours) : DEFAULT_SETTINGS.followUpAfterHours;
  return {
    timezone: typeof row.timezone === "string" && row.timezone ? row.timezone : DEFAULT_TIMEZONE,
    businessHours: hours,
    autoAckMode: mode,
    autoAckText: typeof row.auto_ack_text === "string" ? row.auto_ack_text : "",
    followUpEnabled: row.follow_up_enabled === true,
    followUpAfterHours: after,
    notifyNewConversation: row.notify_new_conversation !== false,
    notifyFailedMessage: row.notify_failed_message !== false,
    notifyFollowUp: row.notify_follow_up !== false,
    notificationLocale: row.notification_locale === "en" ? "en" : "fr",
  };
}

/** The page's settings -> the snake_case document the save function takes. */
export function toSavePayload(s: InboxSettings): Record<string, unknown> {
  const text = s.autoAckText.trim();
  return {
    timezone: s.timezone.trim(),
    business_hours: s.businessHours,
    auto_ack_mode: s.autoAckMode,
    auto_ack_text: text === "" ? null : text,
    follow_up_enabled: s.followUpEnabled,
    follow_up_after_hours: s.followUpAfterHours,
    notify_new_conversation: s.notifyNewConversation,
    notify_failed_message: s.notifyFailedMessage,
    notify_follow_up: s.notifyFollowUp,
    notification_locale: s.notificationLocale,
  };
}

/** A clear message BEFORE saving (the database enforces the same rules). null = fine. */
export function validateSettings(s: InboxSettings): SettingsErrorKey | null {
  if (!isValidTimezone(s.timezone)) return "timezoneInvalid";
  if (!isValidHours(s.businessHours)) return "hoursInvalid";
  const text = s.autoAckText.trim();
  if (Array.from(text).length > ACK_MAX) return "ackTooLong";
  if (s.autoAckMode !== "off" && text === "") return "ackTextRequired";
  if (!Number.isInteger(s.followUpAfterHours) || s.followUpAfterHours < 1 || s.followUpAfterHours > 168) return "followHoursInvalid";
  return null;
}
