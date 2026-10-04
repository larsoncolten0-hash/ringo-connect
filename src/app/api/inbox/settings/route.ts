import { withInboxOwner } from "@/lib/inbox/route";
import { saveInboxSettings } from "@/lib/inbox/settingsSave";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/inbox/settings   { any of: timezone, business_hours, auto_ack_mode, auto_ack_text, follow_up_enabled, follow_up_after_hours,
//                              notify_new_conversation, notify_failed_message, notify_follow_up, notification_locale }
// Saves the signed-in owner's automation settings. The profile is derived from the session (never from the body); unknown keys are ignored.
export async function POST(request: Request) {
  return withInboxOwner(request, (actor, body) => saveInboxSettings(actor, body));
}
