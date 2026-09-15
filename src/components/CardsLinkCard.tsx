"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

// The dedicated "Ringo Card only" get-started link (/get-started-cards,
// see that page for how it differs from the shared /get-started form's
// own ?card=1 track). Unlike SalesFunnelLinkCard.tsx, this link carries
// no affiliate code — it's the same URL for everyone, so this card is
// just a copy affordance, always available from /admin/addons.
export default function CardsLinkCard({ siteUrl }: { siteUrl: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${siteUrl.replace(/\/$/, "")}/get-started-cards`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Clipboard API can be unavailable — the link is still visible and
      // selectable by hand.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="text-sm font-medium text-ringo-text mb-1">Ringo Card get-started link</p>
      <p className="text-xs text-ringo-muted mb-3">
        Skips straight to the Ringo Card options — no Personal/Business or plan picking. Share this on its own
        wherever you only want to sell the card.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 min-w-0 flex items-center rounded-card border border-ringo-border bg-ringo-bg px-3.5 py-2.5">
          <p className="text-sm text-ringo-text truncate font-mono">{link}</p>
        </div>
        <button
          onClick={copyLink}
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium hover:bg-ringo-indigo/90 transition-colors shrink-0"
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
