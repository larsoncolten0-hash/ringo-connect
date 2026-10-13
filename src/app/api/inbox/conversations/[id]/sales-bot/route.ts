import { withInboxOwner } from "@/lib/inbox/route";
import { resumeSalesBot } from "@/lib/salesBot/handoff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/inbox/conversations/<id>/sales-bot
// The Inbox OWNER resumes the Smart Card sales bot in one conversation after a human hand-off. Owner only (a team member is refused by withInboxOwner); the owner comes from
// the session and the database re-checks that the conversation is theirs. The body is ignored: there is nothing to choose, and nothing from the browser can name an owner.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withInboxOwner(request, (actor) => resumeSalesBot(actor, params.id));
}
