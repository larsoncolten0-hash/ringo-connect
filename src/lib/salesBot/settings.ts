import type { Actor, ToolResult } from "@/lib/inbox/tools";
import { isUuid } from "@/lib/inbox/format";

// The account OWNER's ON/OFF switch for the Smart Card sales bot. Two calls to service-role-only database functions (supabase/migrations/2026-12-20_whatsapp_sales_bot_owner_switch.sql).
// The caller has already authenticated the user and derived the profile from the session (withInboxOwner / resolveInboxOwner); the database re-checks that the profile belongs to
// that user and has a WhatsApp account, and records every change. Nothing here accepts an owner, profile or phone number id from the browser.

/** Reads the owner's switch for the settings page. null = it could not be read (the page then hides the control instead of guessing). */
export async function loadSalesBotSwitch(admin: Actor["admin"], userId: string, profileId: string): Promise<boolean | null> {
  try {
    const res = await admin.rpc("wa_sales_settings_get", { p_actor_user_id: userId, p_profile_id: profileId });
    if (res.error || !res.data || typeof res.data !== "object") return null;
    const d = res.data as { result?: string; enabled?: unknown };
    return d.result === "ok" && typeof d.enabled === "boolean" ? d.enabled : null;
  } catch {
    return null;
  }
}

export async function saveSalesBotSwitch(actor: Actor, body: Record<string, unknown>): Promise<ToolResult> {
  if (typeof body.enabled !== "boolean") return { status: 422, body: { ok: false, error: "invalid" } };
  if (!isUuid(actor.profileId)) return { status: 404, body: { ok: false, error: "not_found" } };
  let res: { data: unknown; error: { code?: string } | null };
  try {
    res = await actor.admin.rpc("wa_sales_settings_set", { p_actor_user_id: actor.userId, p_profile_id: actor.profileId, p_enabled: body.enabled });
  } catch {
    console.error(JSON.stringify({ scope: "sales_bot", result: "switch_exception" }));
    return { status: 500, body: { ok: false, error: "server_error" } };
  }
  if (res.error) {
    console.error(JSON.stringify({ scope: "sales_bot", result: "switch_failed", code: String(res.error.code || "rpc_error").slice(0, 20) }));
    return { status: 500, body: { ok: false, error: "server_error" } };
  }
  if (res.data === "ok" || res.data === "noop") return { status: 200, body: { ok: true, state: body.enabled ? "on" : "off" } };
  if (res.data === "not_found") return { status: 404, body: { ok: false, error: "not_found" } };
  return { status: 422, body: { ok: false, error: "invalid" } };
}
