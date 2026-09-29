"use client";

import { Download, ExternalLink, ImageIcon, Sparkles } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ImageView } from "@/lib/ai/content/imageView";

// The generated-image card — presents an image Ringo AI already generated
// and saved. Unlike DraftCard, nothing here is written to Ringo data: there
// is no status, no Confirm/Discard, no apply. It's already "done" (and
// already durably stored) the moment it renders.

export default function ImageCard({ image }: { image: ImageView }) {
  const { t } = useLanguage();
  const c = t.ringoAi.image;

  return (
    <div className="mt-2 rounded-2xl border border-ringo-indigo/25 bg-ringo-surface shadow-[0_8px_24px_-16px_rgba(79,70,229,0.45)] overflow-hidden max-w-full">
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-gradient-to-r from-ringo-indigo/[0.08] via-fuchsia-500/[0.05] to-transparent border-b border-ringo-border/60">
        <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-ringo-indigo to-fuchsia-500 text-white flex items-center justify-center shrink-0">
          <ImageIcon size={14} />
        </span>
        <p className="flex-1 min-w-0 text-sm font-semibold text-ringo-text truncate">{c.title}</p>
      </div>

      <div className="px-3.5 py-3 flex flex-col gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.imageUrl} alt={image.prompt} className="w-full h-auto max-h-80 object-contain rounded-xl border border-ringo-border/60 bg-ringo-muted/[0.06]" />

        <div className="flex items-center gap-1.5 text-[11px] text-ringo-muted">
          <Sparkles size={11} />
          {c.generatedNote}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <a
            href={image.imageUrl}
            download
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-xl border border-ringo-border text-ringo-muted hover:text-ringo-text transition"
          >
            <Download size={12} />
            {c.download}
          </a>
          <a
            href={image.imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-xl border border-ringo-border text-ringo-muted hover:text-ringo-text transition"
          >
            <ExternalLink size={12} />
            {c.openFullSize}
          </a>
        </div>
      </div>
    </div>
  );
}
