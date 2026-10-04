"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import { callInboxTool, statusUrl, toolErrorKey, type ToolErrorKey } from "@/lib/inbox/client";

// Close / reopen one conversation. It changes ONLY the conversation's status (unread counts, messages and provider statuses are untouched, and
// nothing is deleted). The browser sends the new status; the conversation is the one in the URL and the owner comes from the session.
export default function ConversationStatusButton({ conversationId, status }: { conversationId: string; status: "open" | "closed" }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ToolErrorKey | null>(null);
  const inFlight = useRef(false);
  const next = status === "open" ? "closed" : "open";

  async function change() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const result = await callInboxTool("POST", statusUrl(conversationId), { status: next });
    inFlight.current = false;
    setBusy(false);
    const key = toolErrorKey(result, "status");
    setError(key);
    if (!key) router.refresh();
  }

  return (
    <span className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={() => void change()}
        disabled={busy}
        className="rounded-full border border-ringo-border px-3 py-1 text-[11px] font-medium text-ringo-text transition-colors hover:bg-ringo-surface disabled:opacity-60"
      >
        {status === "open" ? u.closeConversation : u.reopenConversation}
      </button>
      {error && <span role="alert" className="max-w-[220px] text-right text-[10px] text-rose-700 dark:text-rose-400">{u[error]}</span>}
    </span>
  );
}
