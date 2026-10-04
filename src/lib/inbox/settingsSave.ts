import { isValidHours, isValidTimezone } from "./settings";
import type { Actor } from "./tools";

// Saves the owner's automation settings: ONE call to inbox_settings_save (service role only). The route has already authenticated the user and
// derived their profile from the session. Only the known keys are forwarded, with a basic type check; the database validates every value again
// (time zone, hours, mode, text, hours-before-reminder) and decides ownership itself. Nothing recipient-like is ever accepted.

export interface SettingsResult {
  status: number;
  body: { ok: true } | { ok: false; error: "invalid" | "not_found" | "server_error" };
}
const bad = (status: number, error: "invalid" | "not_found" | "server_error"): SettingsResult => ({ status, body: { ok: false, error } });

const BOOLEANS = ["follow_up_enabled", "notify_new_conversation", "notify_failed_message", "notify_follow_up"] as const;

/** Whitelists and shape-checks the request body. null = reject. */
export function pickSettings(body: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if ("timezone" in body) {
    if (!isValidTimezone(body.timezone)) return null;
    out.timezone = (body.timezone as string).trim();
  }
  if ("business_hours" in body) {
    if (!isValidHours(body.business_hours)) return null;
    out.business_hours = body.business_hours;
  }
  if ("auto_ack_mode" in body) {
    if (body.auto_ack_mode !== "off" && body.auto_ack_mode !== "outside_hours" && body.auto_ack_mode !== "always") return null;
    out.auto_ack_mode = body.auto_ack_mode;
  }
  if ("auto_ack_text" in body) {
    if (body.auto_ack_text !== null && typeof body.auto_ack_text !== "string") return null;
    out.auto_ack_text = body.auto_ack_text;
  }
  if ("follow_up_after_hours" in body) {
    const h = body.follow_up_after_hours;
    if (typeof h !== "number" || !Number.isInteger(h) || h < 1 || h > 168) return null;
    out.follow_up_after_hours = h;
  }
  for (const k of BOOLEANS) {
    if (k in body) {
      if (typeof body[k] !== "boolean") return null;
      out[k] = body[k];
    }
  }
  if ("notification_locale" in body) {
    if (body.notification_locale !== "en" && body.notification_locale !== "fr") return null;
    out.notification_locale = body.notification_locale;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function saveInboxSettings(actor: Actor, body: Record<string, unknown>): Promise<SettingsResult> {
  const picked = pickSettings(body);
  if (!picked) return bad(422, "invalid");
  try {
    const res = await actor.admin.rpc("inbox_settings_save", { p_actor_user_id: actor.userId, p_profile_id: actor.profileId, p_settings: picked });
    if (res.error) {
      console.error(JSON.stringify({ scope: "inbox_settings", result: "rpc_failed", code: String(res.error.code || "rpc_error").slice(0, 20) }));
      return bad(500, "server_error");
    }
    const r = (res.data && typeof res.data === "object" ? res.data : {}) as { result?: string };
    if (r.result === "saved") return { status: 200, body: { ok: true } };
    if (r.result === "not_found") return bad(404, "not_found");
    if (r.result === "invalid") return bad(422, "invalid");
    return bad(500, "server_error");
  } catch {
    console.error(JSON.stringify({ scope: "inbox_settings", result: "rpc_exception" }));
    return bad(500, "server_error");
  }
}


