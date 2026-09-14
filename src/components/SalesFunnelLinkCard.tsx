"use client";

import { useState } from "react";
import { Copy, Check, Share2 } from "lucide-react";

// Shareable "sales link" — same ?ref= attribution as the plain referral
// link (reuses the existing referral-capture mechanism unchanged, see
// src/lib/referral.ts), but opens on /get-started?intent=sales_funnel
// instead of the landing page: a real conversational Yes/No question
// ("Do you want a Ringo physical card?") rather than a forced deep-link
// or a plain landing on the normal first screen — see GetStartedFlow.tsx's
// cardQuestion/bundlePicker steps. Meant to be pasted into a WhatsApp
// conversation by hand — not a WhatsApp bot or API integration.
//
// Used on both the regular dashboard (AffiliateView.tsx, for any creator
// with their own affiliate code) and the admin dashboard (so the platform
// owner can copy their own link without leaving /admin) — every `users`
// row gets an affiliate_code via a DB trigger at creation, admins
// included, so this works identically in both places. Kept plain English
// (no useLanguage()) since the admin surface it also renders on is
// English-only by this app's own convention; AffiliateView.tsx's own
// surrounding UI stays bilingual, only this one card's copy doesn't.
export default function SalesFunnelLinkCard({ siteUrl, affiliateCode }: { siteUrl: string; affiliateCode: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${siteUrl.replace(/\/$/, "")}/get-started?intent=sales_funnel&ref=${affiliateCode}`;

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

  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ url: link, title: "Ringo Connect" });
      } catch {
        // User cancelled the share sheet — not an error.
      }
    } else {
      copyLink();
    }
  };

  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="text-sm font-medium text-ringo-text mb-1">Get my sales link</p>
      <p className="text-xs text-ringo-muted mb-3">
        Asks "Do you want a Ringo Card?" first, with your referral code already attached — paste it into a WhatsApp chat.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 min-w-0 flex items-center rounded-card border border-ringo-border bg-ringo-bg px-3.5 py-2.5">
          <p className="text-sm text-ringo-text truncate font-mono">{link}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={copyLink}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium hover:bg-ringo-indigo/90 transition-colors"
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={shareLink}
            aria-label="Share"
            className="flex items-center justify-center w-10 h-10 shrink-0 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors"
          >
            <Share2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
