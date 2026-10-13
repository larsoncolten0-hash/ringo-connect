import { withInboxOwner } from "@/lib/inbox/route";
import { saveSalesBotSwitch } from "@/lib/salesBot/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/inbox/sales-bot   { enabled: boolean }
// The Inbox OWNER switches the Smart Card sales bot on or off for their own WhatsApp account. Owner only (a team member is refused by withInboxOwner); the profile comes from the session and the
// database re-checks it and logs the change. The bot still answers only when WHATSAPP_SALES_BOT_PHONE_NUMBER_ID also matches the number: this switch can never turn it on by itself.
export async function POST(request: Request) {
  return withInboxOwner(request, (actor, body) => saveSalesBotSwitch(actor, body));
}
