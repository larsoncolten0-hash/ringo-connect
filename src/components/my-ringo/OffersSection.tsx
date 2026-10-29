"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { api, fmtDate, fmtMoney } from "@/components/loyalty/format";

// Offers for the signed-in customer. The server lists only offers from profiles where the customer's EFFECTIVE marketing consent is on (email or push) and whose audience matches them: a customer
// who has not agreed sees nothing here. `refreshKey` reloads the list after the customer changes a consent switch.
type Offer = {
  profile_id: string;
  profile_name: string;
  promotion: { id: string; title: string; description: string | null; kind: "percent" | "amount"; value: number; currency: string | null; code: string; ends_at: string | null };
};

export default function OffersSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t, locale } = useLanguage();
  const o = t.myRingo.connections.offers;
  const [items, setItems] = useState<Offer[] | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ items?: Offer[] }>("/api/customer/offers").then((r) => {
      if (alive) setItems(r.status === 200 && Array.isArray(r.data?.items) ? r.data!.items! : []);
    });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (items === null) return null;
  return (
    <section className="mt-8 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4" aria-labelledby="offers-title">
      <h2 id="offers-title" className="text-sm font-semibold text-ringo-text">{o.title}</h2>
      <p className="mt-1 text-xs text-ringo-muted">{o.intro}</p>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-ringo-muted">{o.empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {items.map((i) => (
            <li key={i.promotion.id} className="rounded-xl border border-ringo-border/60 p-3">
              <p className="text-xs font-medium text-ringo-muted">{i.profile_name}</p>
              <p className="text-sm font-semibold text-ringo-text">
                {i.promotion.title} · {i.promotion.kind === "percent" ? o.percentOff(i.promotion.value) : o.amountOff(fmtMoney(i.promotion.value, i.promotion.currency || "XAF", locale))}
              </p>
              {i.promotion.description && <p className="mt-1 text-sm text-ringo-text">{i.promotion.description}</p>}
              <p className="mt-2 text-sm text-ringo-text">{o.code}: <span className="font-mono font-semibold">{i.promotion.code}</span></p>
              <p className="text-xs text-ringo-muted">{o.show}{i.promotion.ends_at ? ` ${o.validUntil(fmtDate(i.promotion.ends_at, locale))}` : ""}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
