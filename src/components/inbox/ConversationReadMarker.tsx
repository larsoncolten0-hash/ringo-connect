"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { callInboxTool } from "@/lib/inbox/client";

export const readUrl = (conversationId: string) => `/api/inbox/conversations/${encodeURIComponent(conversationId)}/read`;

// Renders nothing. When the owner opens a conversation it asks OUR route to clear that conversation's unread count (the conversation is the one in
// the URL, the owner comes from the session), then refreshes the server-rendered page ONLY if something was actually cleared, so the badges drop
// to 0 without a manual reload. It runs once per opened conversation; a failure is ignored (the count simply stays until the next visit).
export default function ConversationReadMarker({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    void callInboxTool("POST", readUrl(conversationId)).then((r) => {
      if (!cancelled && r.kind === "response" && r.body.ok && r.body.state === "cleared") router.refresh();
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);
  return null;
}
