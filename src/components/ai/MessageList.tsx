"use client";

import { useState } from "react";
import { AlertCircle, Check, Copy, Loader2, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import RichText from "./RichText";

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Server id once persisted (feedback needs it). */
  serverId: string | null;
  pending?: boolean;
  errorCode?: string | null;
  truncated?: boolean;
  rating?: number;
};

function CopyButton({ text }: { text: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked — nothing to do; the text is still selectable.
        }
      }}
      className="inline-flex items-center gap-1 text-[11px] text-ringo-muted hover:text-ringo-text transition"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? t.ringoAi.copied : t.ringoAi.copy}
    </button>
  );
}

export default function MessageList({
  messages,
  toolStatus,
  onRate,
}: {
  messages: UiMessage[];
  toolStatus: string | null;
  onRate: (message: UiMessage, rating: number) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-ringo-indigo text-white px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap break-words">
            {m.content}
          </div>
        ) : (
          <div key={m.id} className="self-start flex gap-2 max-w-[92%]">
            <span className="mt-0.5 w-6 h-6 shrink-0 rounded-lg bg-gradient-to-br from-ringo-indigo to-fuchsia-500 text-white flex items-center justify-center">
              <Sparkles size={12} />
            </span>
            <div className="min-w-0 flex-1">
              {m.content && (
                <div className="rounded-2xl rounded-tl-md bg-ringo-muted/10 text-ringo-text px-3.5 py-2.5 text-sm leading-relaxed break-words">
                  <RichText text={m.content} />
                </div>
              )}
              {m.pending && (
                <div className="flex items-center gap-2 text-xs text-ringo-muted px-1 py-1.5">
                  <Loader2 size={13} className="animate-spin" />
                  {toolStatus ? t.ringoAi.toolStatus[toolStatus] ?? t.ringoAi.toolStatusFallback : t.ringoAi.thinking}
                </div>
              )}
              {m.errorCode && (
                <div className="mt-1 flex items-start gap-1.5 text-xs text-ringo-coral px-1">
                  <AlertCircle size={13} className="shrink-0 mt-px" />
                  <span>{t.ringoAi.errors[m.errorCode] ?? t.ringoAi.errors.internal}</span>
                </div>
              )}
              {m.truncated && !m.pending && <p className="mt-1 text-[11px] text-ringo-muted px-1">{t.ringoAi.truncatedNote}</p>}
              {!m.pending && m.content && m.serverId && (
                <div className="mt-1 flex items-center gap-3 px-1">
                  <CopyButton text={m.content} />
                  <button
                    type="button"
                    aria-label={t.ringoAi.helpful}
                    aria-pressed={m.rating === 1}
                    onClick={() => onRate(m, m.rating === 1 ? 0 : 1)}
                    className={`transition ${m.rating === 1 ? "text-emerald-500" : "text-ringo-muted hover:text-ringo-text"}`}
                  >
                    <ThumbsUp size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label={t.ringoAi.notHelpful}
                    aria-pressed={m.rating === -1}
                    onClick={() => onRate(m, m.rating === -1 ? 0 : -1)}
                    className={`transition ${m.rating === -1 ? "text-ringo-coral" : "text-ringo-muted hover:text-ringo-text"}`}
                  >
                    <ThumbsDown size={12} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}
