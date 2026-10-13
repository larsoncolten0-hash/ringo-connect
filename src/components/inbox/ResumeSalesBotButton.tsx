"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import { callInboxTool } from "@/lib/inbox/client";

// Owner-only: pauses the Smart Card sales bot in ONE conversation (it goes silent, nothing is sent to the customer) or hands the conversation back to it. The browser sends
// only the word "pause" for a pause; the conversation is the one in the URL and the owner comes from the session. Shown only when the sales bot is switched on for this deployment.
export default function ResumeSalesBotButton({ conversationId }: { conversationId: string }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<"resumed" | "paused" | "notPaused" | "resumeFailed" | "pauseFailed" | null>(null);
  const inFlight = useRef(false);

  async function change(action: "pause" | "resume") {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNote(null);
    const result = await callInboxTool("POST", `/api/inbox/conversations/${encodeURIComponent(conversationId)}/sales-bot`, action === "pause" ? { action: "pause" } : {});
    inFlight.current = false;
    setBusy(false);
    if (result.kind === "response" && result.body.ok) {
      const state = (result.body as { state?: string }).state;
      setNote(state === "paused" ? "paused" : state === "resumed" ? "resumed" : "notPaused");
      router.refresh();
    } else setNote(action === "pause" ? "pauseFailed" : "resumeFailed");
  }

  const button = "rounded-full border border-ringo-border px-3 py-1 text-[11px] font-medium text-ringo-text transition-colors hover:bg-ringo-surface disabled:opacity-60";
  const message = note === "paused" ? u.pauseSalesBotDone : note === "resumed" ? u.resumeSalesBotDone : note === "notPaused" ? u.resumeSalesBotNotPaused : note === "pauseFailed" ? u.pauseSalesBotFailed : note === "resumeFailed" ? u.resumeSalesBotFailed : null;
  const failed = note === "pauseFailed" || note === "resumeFailed";
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="flex items-center gap-1.5">
        <button type="button" onClick={() => void change("pause")} disabled={busy} data-testid="pause-sales-bot" className={button}>{u.pauseSalesBot}</button>
        <button type="button" onClick={() => void change("resume")} disabled={busy} data-testid="resume-sales-bot" className={button}>{u.resumeSalesBot}</button>
      </span>
      {message && (
        <span role={failed ? "alert" : "status"} className={`max-w-[260px] text-right text-[10px] ${failed ? "text-rose-700 dark:text-rose-400" : "text-ringo-muted"}`}>
          {message}
        </span>
      )}
    </span>
  );
}
