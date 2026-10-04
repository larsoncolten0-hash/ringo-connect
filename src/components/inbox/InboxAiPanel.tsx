"use client";

import { useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { interpretAssist, postAssist, type AssistAction, type AssistView } from "@/lib/inbox/client";

// AI assistance next to the reply box. It only ever shows text (and offers to put a drafted reply into the box): it never sends, and a failure
// here is a calm message that leaves the reply box untouched. The browser sends only the action and the language; the server loads the messages.
export default function InboxAiPanel({ conversationId, canSuggest, onInsert }: { conversationId: string; canSuggest: boolean; onInsert: (text: string) => void }) {
  const { t, locale } = useLanguage();
  const u = t.inbox;
  const [loading, setLoading] = useState<AssistAction | null>(null);
  const [last, setLast] = useState<AssistAction | null>(null);
  const [view, setView] = useState<AssistView | null>(null);
  const busy = useRef(false);

  async function run(action: AssistAction) {
    if (busy.current) return;
    busy.current = true;
    setLoading(action);
    setLast(action);
    setView(null);
    const result = await postAssist(conversationId, action, locale === "fr" ? "fr" : "en");
    busy.current = false;
    setLoading(null);
    setView(interpretAssist(result));
  }

  const btn = "inline-flex items-center gap-1.5 rounded-full border border-ringo-border px-3 py-1.5 text-xs text-ringo-text transition-colors hover:bg-ringo-surface disabled:opacity-60";
  return (
    <section aria-label={u.aiHeading} className="border-t border-ringo-border px-4 py-2" data-testid="inbox-ai">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ringo-muted"><Sparkles size={12} aria-hidden="true" />{u.aiHeading}</span>
        <button type="button" className={btn} disabled={loading !== null} onClick={() => run("summarize")}>{u.aiSummarize}</button>
        {canSuggest && <button type="button" className={btn} disabled={loading !== null} onClick={() => run("suggest_reply")}>{u.aiSuggest}</button>}
      </div>
      <div aria-live="polite">
        {loading && <p className="mt-2 text-xs text-ringo-muted">{u.aiLoading}</p>}
        {view?.state === "error" && <p role="status" className="mt-2 text-xs text-ringo-muted">{u[view.error]}</p>}
        {view && view.state !== "error" && (
          <div className="mt-2 rounded-xl border border-ringo-border/70 bg-ringo-muted/10 p-3 text-xs text-ringo-text" data-ai-result={view.state}>
            {view.state === "summary" ? (
              <dl className="space-y-2">
                <div><dt className="font-medium">{u.aiSummaryLabel}</dt><dd className="whitespace-pre-wrap">{view.summary}</dd></div>
                {view.context && <div><dt className="font-medium">{u.aiContextLabel}</dt><dd className="whitespace-pre-wrap">{view.context}</dd></div>}
                {view.nextAction && <div><dt className="font-medium">{u.aiNextLabel}</dt><dd className="whitespace-pre-wrap">{view.nextAction}</dd></div>}
              </dl>
            ) : (
              <div><p className="font-medium">{u.aiDraftLabel}</p><p className="whitespace-pre-wrap">{view.reply}</p></div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {view.state === "reply" && <button type="button" className={btn} onClick={() => { onInsert(view.reply); setView(null); }}>{u.aiInsert}</button>}
              {last && <button type="button" className={btn} disabled={loading !== null} onClick={() => run(last)}>{u.aiRegenerate}</button>}
              <button type="button" className="inline-flex items-center gap-1 text-[11px] text-ringo-muted hover:text-ringo-text" onClick={() => setView(null)}><X size={12} aria-hidden="true" />{u.aiDismiss}</button>
            </div>
            <p className="mt-2 text-[10px] text-ringo-muted">{u.aiNote}</p>
          </div>
        )}
      </div>
    </section>
  );
}
