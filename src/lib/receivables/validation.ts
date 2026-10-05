// Request validation for the Phase 3 API: a fast, friendly pre-check. The database functions re-validate everything and stay the authority.
import { CONTACT_LIMITS, REMINDER_CHANNELS, REMINDER_RANGES, type ReminderChannel } from "./constants";
import { isUuid, type Parsed } from "@/lib/documents/validation";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const len = (s: string) => Array.from(s).length;
const optText = (v: unknown, max: number, code: string, errors: string[]): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") { errors.push(code); return null; }
  if (len(v) > max) { errors.push(code); return null; }
  return v.trim() === "" ? null : v;
};

export type ContactInput = { name: string; phone: string | null; email: string | null; notes: string | null; address: string | null; client_request_id: string | null };

export function parseContactBody(body: unknown, creating: boolean): Parsed<ContactInput> {
  if (!isObj(body)) return { ok: false, details: ["invalid_body"] };
  const errors: string[] = [];
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name === "" || len(name) > CONTACT_LIMITS.name) errors.push("invalid_customer_name");
  const phone = optText(body.phone, CONTACT_LIMITS.phone, "invalid_phone", errors);
  const email = optText(body.email, CONTACT_LIMITS.email, "invalid_email", errors);
  if (email !== null && !/^[^\s@]+@[^\s@]+$/.test(email.trim())) errors.push("invalid_email");
  const notes = optText(body.notes, CONTACT_LIMITS.notes, "invalid_notes", errors);
  const address = optText(body.address, CONTACT_LIMITS.address, "invalid_address", errors);
  let rid: string | null = null;
  if (body.client_request_id !== undefined && body.client_request_id !== null) {
    if (!isUuid(body.client_request_id)) errors.push("request_id_required"); else rid = body.client_request_id;
  } else if (creating) errors.push("request_id_required");
  return errors.length ? { ok: false, details: errors } : { ok: true, value: { name, phone, email, notes, address, client_request_id: rid } };
}

export type SettingsInput = {
  auto_email_enabled: boolean; remind_before_days: number | null; remind_on_due: boolean; overdue_every_days: number | null;
  max_auto_per_invoice: number; owner_alerts_enabled: boolean;
};

const intIn = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

export function parseSettingsBody(body: unknown): Parsed<SettingsInput> {
  if (!isObj(body)) return { ok: false, details: ["invalid_body"] };
  const errors: string[] = [];
  const bool = (v: unknown) => { if (typeof v === "boolean") return v; errors.push("invalid_setting"); return false; };
  const auto = bool(body.auto_email_enabled), onDue = bool(body.remind_on_due), alerts = bool(body.owner_alerts_enabled);
  let before: number | null = null;
  if (body.remind_before_days !== null && body.remind_before_days !== undefined) {
    before = intIn(body.remind_before_days, REMINDER_RANGES.beforeDays.min, REMINDER_RANGES.beforeDays.max);
    if (before === null) errors.push("invalid_setting");
  }
  let every: number | null = null;
  if (body.overdue_every_days !== null && body.overdue_every_days !== undefined) {
    every = intIn(body.overdue_every_days, REMINDER_RANGES.overdueEveryDays.min, REMINDER_RANGES.overdueEveryDays.max);
    if (every === null) errors.push("invalid_setting");
  }
  const max = intIn(body.max_auto_per_invoice, REMINDER_RANGES.maxAutoPerInvoice.min, REMINDER_RANGES.maxAutoPerInvoice.max);
  if (max === null) errors.push("invalid_setting");
  return errors.length
    ? { ok: false, details: errors }
    : { ok: true, value: { auto_email_enabled: auto, remind_before_days: before, remind_on_due: onDue, overdue_every_days: every, max_auto_per_invoice: max as number, owner_alerts_enabled: alerts } };
}

export const parseBoolBody = (body: unknown, key: string): Parsed<boolean> =>
  isObj(body) && typeof body[key] === "boolean" ? { ok: true, value: body[key] as boolean } : { ok: false, details: ["invalid_setting"] };

export function parseLinkBody(body: unknown): Parsed<string | null> {
  if (!isObj(body) || !("customer_id" in body)) return { ok: false, details: ["invalid_body"] };
  if (body.customer_id === null) return { ok: true, value: null };
  return isUuid(body.customer_id) ? { ok: true, value: body.customer_id } : { ok: false, details: ["customer_not_found"] };
}

/** The raw share token from a pasted link (https://host/d/<token>[/pdf]) or the bare 43-character token. null when it is neither. */
export function extractShareToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (/^[A-Za-z0-9_-]{43}$/.test(s)) return s;
  try {
    const m = /^\/d\/([A-Za-z0-9_-]{43})(?:\/pdf)?\/?$/.exec(new URL(s).pathname);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export type ReminderInput = { channel: ReminderChannel; client_request_id: string; share_token: string | null };

export function parseReminderBody(body: unknown): Parsed<ReminderInput> {
  if (!isObj(body)) return { ok: false, details: ["invalid_body"] };
  const errors: string[] = [];
  if (!(REMINDER_CHANNELS as readonly unknown[]).includes(body.channel)) errors.push("invalid_channel");
  if (!isUuid(body.client_request_id)) errors.push("request_id_required");
  let token: string | null = null;
  if (body.share_link !== undefined && body.share_link !== null && body.share_link !== "") {
    token = extractShareToken(body.share_link);
    if (token === null) errors.push("invalid_share_link");
  }
  return errors.length
    ? { ok: false, details: errors }
    : { ok: true, value: { channel: body.channel as ReminderChannel, client_request_id: body.client_request_id as string, share_token: token } };
}
