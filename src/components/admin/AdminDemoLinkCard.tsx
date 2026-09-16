"use client";

import { useState } from "react";
import { Copy, Check, FlaskConical } from "lucide-react";

// AdminShell is English-only chrome (see AdminAppControls.tsx's own
// comment on that convention) — this follows the same pattern, no
// useLanguage()/translations.ts here.
export default function AdminDemoLinkCard({ demoUrl }: { demoUrl: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(demoUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail (permissions, insecure context) — the link
      // is still visible and selectable by hand either way.
    }
  };

  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col gap-3 max-w-xl">
      <div className="flex items-center gap-2">
        <FlaskConical size={16} className="text-ringo-indigo" />
        <p className="text-sm font-medium text-ringo-text">Try the dashboard — demo link</p>
      </div>
      <p className="text-xs text-ringo-muted">
        Share this link anywhere. Every visitor gets their own fresh, isolated, throwaway Business Pro account —
        zero signup friction, no email or password. Demo accounts auto-expire after 7 days.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-card border border-ringo-border bg-ringo-bg px-3 py-2 text-xs text-ringo-text">
          {demoUrl}
        </code>
        <button
          onClick={copy}
          className="shrink-0 flex items-center gap-1.5 rounded-card bg-ringo-indigo text-white text-xs font-medium px-3 py-2 transition hover:bg-ringo-indigo/90"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
