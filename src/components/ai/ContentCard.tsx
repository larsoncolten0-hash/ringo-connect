"use client";

import { useState } from "react";
import { Bell, Camera, Check, Copy, Languages, Megaphone, MessageCircle, RefreshCw, Sparkles } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ContentView } from "@/lib/ai/content/view";

// The Content Studio card — presents marketing copy Ringo AI already wrote.
// Unlike DraftCard, nothing here is written to Ringo data: there is no
// status, no Confirm/Discard, no apply. It's already "done" the moment it
// renders. Regenerate/language-switch are pure client conveniences that
// resend a chat message; they don't call any new API.

const TYPE_ICON = { promotional_post: Megaphone, whatsapp_promotion: MessageCircle, social_caption: Camera, announcement: Bell } as const;

function CopyChip({ text, label }: { text: string; label: string }) {
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
          // Clipboard blocked — text is still selectable on the card.
        }
      }}
      className="inline-flex items-center gap-1 text-[11px] font-medium text-ringo-indigo hover:underline shrink-0"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? t.ringoAi.copied : label}
    </button>
  );
}

export default function ContentCard({ content, onRegenerate, onSwitchLanguage }: { content: ContentView; onRegenerate: () => void; onSwitchLanguage: (locale: "en" | "fr") => void }) {
  const { t } = useLanguage();
  const c = t.ringoAi.content;
  const Icon = TYPE_ICON[content.type] ?? Sparkles;

  const fullText = [
    content.headline,
    content.body,
    content.cta,
    content.hashtags.length ? content.hashtags.map((h) => `#${h}`).join(" ") : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <div className="mt-2 rounded-2xl border border-ringo-indigo/25 bg-ringo-surface shadow-[0_8px_24px_-16px_rgba(79,70,229,0.45)] overflow-hidden">
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-gradient-to-r from-ringo-indigo/[0.08] via-fuchsia-500/[0.05] to-transparent border-b border-ringo-border/60">
        <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-ringo-indigo to-fuchsia-500 text-white flex items-center justify-center shrink-0">
          <Icon size={14} />
        </span>
        <p className="flex-1 min-w-0 text-sm font-semibold text-ringo-text truncate">{c.typeTitle[content.type]}</p>
        <CopyChip text={fullText} label={c.copyAll} />
      </div>

      <div className="px-3.5 py-3 flex flex-col gap-2.5">
        {content.headline && <p className="text-sm font-semibold text-ringo-text break-words whitespace-pre-wrap">{content.headline}</p>}
        <p className="text-sm text-ringo-text break-words whitespace-pre-wrap leading-relaxed">{content.body}</p>
        {content.cta && <p className="text-sm font-medium text-ringo-indigo break-words whitespace-pre-wrap">{content.cta}</p>}
        {content.hashtags.length > 0 && <p className="text-xs text-ringo-muted break-words">{content.hashtags.map((h) => `#${h}`).join(" ")}</p>}

        {content.shortVersion && (
          <div className="rounded-xl bg-ringo-muted/[0.06] px-3 py-2 mt-1">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ringo-muted">{c.shortVersionLabel}</span>
              <CopyChip text={content.shortVersion} label={t.ringoAi.copy} />
            </div>
            <p className="text-xs text-ringo-text break-words whitespace-pre-wrap">{content.shortVersion}</p>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[11px] text-ringo-muted pt-0.5">
          <Sparkles size={11} />
          {c.generatedNote}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onRegenerate}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-xl border border-ringo-border text-ringo-muted hover:text-ringo-text transition"
          >
            <RefreshCw size={12} />
            {c.regenerate}
          </button>
          <button
            type="button"
            onClick={() => onSwitchLanguage(content.locale === "fr" ? "en" : "fr")}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-xl border border-ringo-border text-ringo-muted hover:text-ringo-text transition"
          >
            <Languages size={12} />
            {content.locale === "fr" ? c.writeInEnglish : c.writeInFrench}
          </button>
        </div>
      </div>
    </div>
  );
}
