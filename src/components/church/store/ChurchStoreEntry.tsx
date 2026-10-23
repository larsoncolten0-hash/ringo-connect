"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { BTN_PRIMARY } from "../people/shared";

// The Church Store is the church's existing Ringo Shop, shown on its public page under the name "Church Store" (see catalogLabel in lib/categories.ts). This screen adds no store of its own: it explains
// that and points the owner to the Shop. Products, orders, payments and earnings all stay exactly where they are.
export default function ChurchStoreEntry({ shopAvailable }: { shopAvailable: boolean }) {
  const { t } = useLanguage();
  const c = t.churchStore;
  return (
    <div>
      <p className="mb-4 text-sm leading-relaxed text-ringo-muted">{c.subtitle}</p>
      <ul className="mb-5 flex flex-col gap-2 text-sm leading-relaxed text-ringo-text">
        {c.points.map((point) => (
          <li key={point} className="flex items-start gap-2">
            <ShoppingBag size={16} className="mt-0.5 shrink-0 text-ringo-indigo" aria-hidden="true" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      {shopAvailable ? (
        <Link href="/dashboard/shop" className={BTN_PRIMARY}>
          {c.openShop}
        </Link>
      ) : (
        <p className="rounded-2xl border border-dashed border-ringo-border bg-ringo-surface/60 px-4 py-3 text-sm leading-relaxed text-ringo-muted">{c.unavailable}</p>
      )}
    </div>
  );
}
