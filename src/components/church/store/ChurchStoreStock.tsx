"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchStock } from "@/lib/church/store/stock";
import { BTN_SECONDARY } from "../people/shared";

// The stock card of the Church Store: three counts and the products that need attention, from the existing Inventory. Presentation only; the figures arrive from the server already reduced.
export default function ChurchStoreStock({ stock }: { stock: ChurchStock }) {
  const { t } = useLanguage();
  const s = t.churchStore.stock;
  return (
    <section aria-labelledby="church-store-stock" className="mt-6 rounded-3xl border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5">
      <h2 id="church-store-stock" className="font-display text-base font-semibold text-ringo-text">
        {s.title}
      </h2>
      <p className="mb-4 mt-1 text-sm leading-relaxed text-ringo-muted">{s.intro}</p>
      {stock.state === "unavailable" ? (
        <p className="rounded-2xl border border-dashed border-ringo-border bg-ringo-surface/60 px-4 py-3 text-sm leading-relaxed text-ringo-muted">{s.unavailable}</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2">
            <Count label={s.tracked} value={stock.tracked} />
            <Count label={s.low} value={stock.low} warn={stock.low > 0} />
            <Count label={s.out} value={stock.out} warn={stock.out > 0} />
          </dl>
          {stock.tracked === 0 ? (
            <p className="mt-3 text-sm text-ringo-muted">{s.none}</p>
          ) : stock.attention.length === 0 ? (
            <p className="mt-3 text-sm text-ringo-muted">{s.allGood}</p>
          ) : (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-ringo-text">{s.attention}</h3>
              <ul className="flex flex-col gap-1.5">
                {stock.attention.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-2xl bg-ringo-bg px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-ringo-text">{p.name}</span>
                    <span className={`shrink-0 text-xs font-semibold ${p.state === "out" ? "text-ringo-coral" : "text-ringo-muted"}`}>{p.state === "out" ? s.outLabel : s.left(p.count ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4">
            <Link href="/dashboard/inventory" className={BTN_SECONDARY}>
              {s.open}
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

function Count({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-2xl bg-ringo-bg px-3 py-2.5">
      <dt className="text-xs text-ringo-muted">{label}</dt>
      <dd className={`font-display text-lg font-semibold ${warn ? "text-ringo-coral" : "text-ringo-text"}`}>{value}</dd>
    </div>
  );
}
