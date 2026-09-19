"use client";

import Link from "next/link";
import { Gift, QrCode } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Two entry points into Ringo Loyalty from existing My Ringo pages (Home and Me). There is
// deliberately NO new bottom-navigation tab: the bar already has six.
export default function LoyaltyTiles({ rewardsReady = 0, showTitle = false }: { rewardsReady?: number; showTitle?: boolean }) {
  const { t } = useLanguage();
  const e = t.myRingo.loyalty.entry;

  return (
    <section>
      {showTitle && <h2 className="mb-3 text-sm font-semibold text-ringo-text">{e.sectionTitle}</h2>}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/my-ringo/qr"
          className="flex flex-col gap-2 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 transition hover:border-ringo-indigo/40"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ringo-indigo/10 text-ringo-indigo">
            <QrCode size={18} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-ringo-text">{e.qrTitle}</span>
            <span className="block text-xs text-ringo-muted">{e.qrBody}</span>
          </span>
        </Link>
        <Link
          href="/my-ringo/rewards"
          className="flex flex-col gap-2 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 transition hover:border-ringo-indigo/40"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ringo-indigo/10 text-ringo-indigo">
            <Gift size={18} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-ringo-text">{e.rewardsTitle}</span>
            {rewardsReady > 0 ? (
              <span className="mt-0.5 inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">{e.rewardsReady(rewardsReady)}</span>
            ) : (
              <span className="block text-xs text-ringo-muted">{e.rewardsBody}</span>
            )}
          </span>
        </Link>
      </div>
    </section>
  );
}
