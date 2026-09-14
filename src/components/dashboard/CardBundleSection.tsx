"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import BundlePurchaseModal from "./BundlePurchaseModal";

export interface CardBundleAddon {
  id: string;
  name: string;
  price_xaf: number;
  grants_plan_duration_days: number;
}

// Purchase entry point for the two Card + Subscription bundles, on the
// existing-user side (/dashboard/ringo-card) — the get-started side offers
// the same two rows automatically via the existing addon checkbox list,
// since they're just active addons now (see the migration's own comment).
// A separate component from RingoCardWriter.tsx on purpose: the writer
// flow is existing, working NFC functionality this task must not risk —
// this only ever adds a purchase entry point above/below it.
export default function CardBundleSection({ bundles, isCameroon }: { bundles: CardBundleAddon[]; isCameroon: boolean }) {
  const { locale } = useLanguage();
  const [buying, setBuying] = useState<CardBundleAddon | null>(null);

  if (bundles.length === 0 || !isCameroon) {
    // Fapshi is Cameroon Mobile Money only — same "no card/Stripe path for
    // this" reasoning BundlePurchaseModal's own comment gives. Outside
    // Cameroon there's nothing purchasable here yet.
    return null;
  }

  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles size={15} className="text-ringo-indigo" />
        <h2 className="text-sm font-semibold text-ringo-text">Card + Subscription bundles</h2>
      </div>
      <p className="text-xs text-ringo-muted mb-4">Get a Ringo Card and unlock Basic-tier access at the same time — never downgrades an existing higher plan, only adds to it.</p>

      <div className="grid sm:grid-cols-2 gap-3">
        {bundles.map((bundle) => (
          <div key={bundle.id} className="rounded-2xl border border-ringo-border p-4 flex flex-col gap-2">
            <p className="text-sm font-medium text-ringo-text">{bundle.name}</p>
            <p className="text-lg font-display font-semibold text-ringo-indigo" suppressHydrationWarning>
              {formatPrice(bundle.price_xaf, "XAF", locale)}
            </p>
            <p className="text-xs text-ringo-muted">
              1 Ringo Card + {bundle.grants_plan_duration_days >= 300 ? "1 year" : "1 month"} of Basic
            </p>
            <button
              onClick={() => setBuying(bundle)}
              className="mt-1 text-sm font-medium py-2 rounded-card bg-ringo-indigo text-white hover:brightness-110 transition"
            >
              Buy via Mobile Money
            </button>
          </div>
        ))}
      </div>

      {buying && (
        <BundlePurchaseModal
          addonId={buying.id}
          name={buying.name}
          priceXaf={buying.price_xaf}
          onClose={() => setBuying(null)}
          onSuccess={() => {
            setBuying(null);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
