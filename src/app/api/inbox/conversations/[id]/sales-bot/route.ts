import { withInboxOwner } from "@/lib/inbox/route";
import { pauseSalesBot, resumeSalesBot } from "@/lib/salesBot/handoff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/inbox/conversations/<id>/sales-bot
// POST body: { action: "pause" } pauses the Smart Card sales bot in this conversation (it goes silent, nothing is sent); anything else, or no body, resumes it after a human hand-off.
// The Inbox OWNER only (a team member is refused by withInboxOwner); the owner comes from the session and the database re-checks that the conversation is theirs.
// The only field read from the body is the word "pause": nothing from the browser can name an owner, a profile or a recipient.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withInboxOwner(request, (actor, body) => (body.action === "pause" ? pauseSalesBot(actor, params.id) : resumeSalesBot(actor, params.id)));
}
