"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { referralPromoDismissKey } from "@/lib/referralPromo";

// Compact, dismissible referral prompt for the dashboard home. It points at the EXISTING Affiliate
// dashboard (every account already has an affiliate code); dismissal is remembered per account in
// this browser, the same lightweight approach as the profile's add-to-home-screen card.
export default function ReferralPromoBanner({ userId, ratePct }: { userId: string; ratePct: string }) {
  const { t } = useLanguage();
  const c = t.referralPromo;
  const [dismissed, setDismissed] = useState(true); // hidden until the mount effect confirms it wasn't dismissed
  const key = referralPromoDismissKey(userId);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(key) === "1");
    } catch {
      setDismissed(false);
    }
  }, [key]);

  if (dismissed) return null;

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-ringo-indigo/20 bg-ringo-indigo/5 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ringo-text">{c.title.replace("{rate}", ratePct)}</p>
        <p className="mt-0.5 text-xs text-ringo-muted">{c.body}</p>
        <Link
          href="/dashboard/affiliate"
          className="mt-2 inline-flex min-h-[36px] items-center rounded-lg bg-ringo-indigo px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-indigo"
        >
          {c.cta}
        </Link>
      </div>
      <button
        type="button"
        aria-label={c.dismiss}
        onClick={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem(key, "1");
          } catch {
            // storage unavailable — it simply returns next visit
          }
        }}
        className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ringo-muted hover:bg-ringo-indigo/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ringo-indigo"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
