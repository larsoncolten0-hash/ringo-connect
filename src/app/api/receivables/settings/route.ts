import { getReminderSettings, putReminderSettings } from "@/lib/receivables/handlers";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only reminder settings. Automatic email reminders are OFF by default and can only be turned on when the business has an email
// (used as the reply address). Owner alerts are OFF by default too.
export async function GET() {
  return withOwner((owner) => getReminderSettings(owner));
}

export async function PUT(request: Request) {
  const body = await readJson(request);
  return withOwner((owner) => putReminderSettings(owner, body));
}
