import { listReminders, sendReminder } from "@/lib/receivables/handlers";
import { sendEmail } from "@/lib/email/provider";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// GET: the reminder history of one invoice. POST: one MANUAL reminder, { channel: "email" | "whatsapp_manual", client_request_id, share_link? }.
// Email goes through the existing email infrastructure; WhatsApp only prepares a click-to-chat draft (Ringo never sends it).
// A share link is included only if the owner pastes one that the database confirms belongs to this invoice; no link is ever created here.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return withOwner((owner) => listReminders(owner, params.id));
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await readJson(request);
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/, "");
  return withOwner((owner) => sendReminder(owner, params.id, body, { send: sendEmail, origin }));
}
