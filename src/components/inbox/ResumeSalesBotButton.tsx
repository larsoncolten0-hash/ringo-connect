"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import { callInboxTool } from "@/lib/inbox/client";

// Owner-only: hands the conversation back to the Smart Card sales bot after a human hand-off. The browser sends nothing; the conversation is the one in the URL and the owner
// comes from the session. Shown only when the sales bot is switched on for this deployment.
export default function ResumeSalesBotButton({ conversationId }: { conversationId: string }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<"done" | "notPaused" | "failed" | null>(null);
  const inFlight = useRef(false);

  async function resume() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNote(null);
    const result = await callInboxTool("POST", `/api/inbox/conversations/${encodeURIComponent(conversationId)}/sales-bot`, {});
    inFlight.current = false;
    setBusy(false);
    if (result.kind === "response" && result.body.ok) {
      setNote((result.body as { state?: string }).state === "resumed" ? "done" : "notPaused");
      router.refresh();
    } else {
      setNote("failed");
    }
  }

  return (
    <span className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={() => void resume()}
        disabled={busy}
        className="rounded-full border border-ringo-border px-3 py-1 text-[11px] font-medium text-ringo-text transition-colors hover:bg-ringo-surface disabled:opacity-60"
      >
        {u.resumeSalesBot}
      </button>
      {note && (
        <span role={note === "failed" ? "alert" : "status"} className={`max-w-[220px] text-right text-[10px] ${note === "failed" ? "text-rose-700 dark:text-rose-400" : "text-ringo-muted"}`}>
          {note === "done" ? u.resumeSalesBotDone : note === "notPaused" ? u.resumeSalesBotNotPaused : u.resumeSalesBotFailed}
        </span>
      )}
    </span>
  );
}
