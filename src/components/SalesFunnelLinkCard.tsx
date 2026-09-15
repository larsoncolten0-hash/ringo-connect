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

  // Second, unrelated link this same card also offers a copy affordance
  // for: the standalone story-style FAQ funnel page (a plain static file,
  // not part of the Next.js route tree — see public/card-funnel.html),
  // meant for pasting into WhatsApp BEFORE someone ever reaches
  // /get-started. Carries the same affiliate_code as ?ref= so its own
  // "I have a question" button reaches this person's WhatsApp number
  // (looked up server-side by GET /api/public/card-funnel-referrer),
  // instead of a generic line.
  const [faqCopied, setFaqCopied] = useState(false);
  const faqLink = `${siteUrl.replace(/\/$/, "")}/card-funnel.html?ref=${affiliateCode}`;

  // Third link: the same story-style FAQ format, but for people who just
  // want the Ringo Connect platform/subscription — no physical card. Ends
  // on the plain /get-started flow (no ?card=1) — see
  // public/subscription-funnel.html.
  const [subCopied, setSubCopied] = useState(false);
  const subLink = `${siteUrl.replace(/\/$/, "")}/subscription-funnel.html?ref=${affiliateCode}`;

  // Fourth link: same FAQ format, for business owners/institutions
  // considering the Business plans. Ends on /get-started?business=1,
  // which skips straight to the Business plan picker — see
  // public/business-funnel.html and GetStartedFlow.tsx's initialIntent.
  const [bizCopied, setBizCopied] = useState(false);
  const bizLink = `${siteUrl.replace(/\/$/, "")}/business-funnel.html?ref=${affiliateCode}`;

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

  const copyFaqLink = async () => {
    try {
      await navigator.clipboard.writeText(faqLink);
    } catch {
      // Clipboard API can be unavailable — the link is still visible and
      // selectable by hand.
    }
    setFaqCopied(true);
    setTimeout(() => setFaqCopied(false), 2000);
  };

  const copySubLink = async () => {
    try {
      await navigator.clipboard.writeText(subLink);
    } catch {
      // Clipboard API can be unavailable — the link is still visible and
      // selectable by hand.
    }
    setSubCopied(true);
    setTimeout(() => setSubCopied(false), 2000);
  };

  const copyBizLink = async () => {
    try {
      await navigator.clipboard.writeText(bizLink);
    } catch {
      // Clipboard API can be unavailable — the link is still visible and
      // selectable by hand.
    }
    setBizCopied(true);
    setTimeout(() => setBizCopied(false), 2000);
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

      <div className="mt-4 pt-4 border-t border-ringo-border/70">
        <p className="text-sm font-medium text-ringo-text mb-1">Get my FAQ funnel link</p>
        <p className="text-xs text-ringo-muted mb-3">
          A story-style FAQ walkthrough about the Ringo Card — share this on WhatsApp before someone even reaches
          the sign-up form.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 min-w-0 flex items-center rounded-card border border-ringo-border bg-ringo-bg px-3.5 py-2.5">
            <p className="text-sm text-ringo-text truncate font-mono">{faqLink}</p>
          </div>
          <button
            onClick={copyFaqLink}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium hover:bg-ringo-indigo/90 transition-colors shrink-0"
          >
            {faqCopied ? <Check size={15} /> : <Copy size={15} />}
            {faqCopied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-ringo-border/70">
        <p className="text-sm font-medium text-ringo-text mb-1">Get my subscription funnel link</p>
        <p className="text-xs text-ringo-muted mb-3">
          Same FAQ walkthrough, but for the Ringo Connect platform itself — no physical card, just Personal/Business
          and Free or a paid plan.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 min-w-0 flex items-center rounded-card border border-ringo-border bg-ringo-bg px-3.5 py-2.5">
            <p className="text-sm text-ringo-text truncate font-mono">{subLink}</p>
          </div>
          <button
            onClick={copySubLink}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium hover:bg-ringo-indigo/90 transition-colors shrink-0"
          >
            {subCopied ? <Check size={15} /> : <Copy size={15} />}
            {subCopied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-ringo-border/70">
        <p className="text-sm font-medium text-ringo-text mb-1">Get my business funnel link</p>
        <p className="text-xs text-ringo-muted mb-3">
          Same FAQ walkthrough, for business owners and institutions — skips straight to the Business Basic/Business
          Pro plan picker.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 min-w-0 flex items-center rounded-card border border-ringo-border bg-ringo-bg px-3.5 py-2.5">
            <p className="text-sm text-ringo-text truncate font-mono">{bizLink}</p>
          </div>
          <button
            onClick={copyBizLink}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium hover:bg-ringo-indigo/90 transition-colors shrink-0"
          >
            {bizCopied ? <Check size={15} /> : <Copy size={15} />}
            {bizCopied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
