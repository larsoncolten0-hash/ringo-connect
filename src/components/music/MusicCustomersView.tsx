"use client";

import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import type { Translations } from "@/lib/i18n/translations";

type Row = { name: string; phone: string; amount: number; count: number; lastAt: string };

function Section({
  title,
  rows,
  countLabel,
  lastLabel,
  emptyLabel,
  currency,
  t,
  locale,
}: {
  title: string;
  rows: Row[];
  countLabel: string;
  lastLabel: string;
  emptyLabel: string;
  currency: string;
  t: Translations;
  locale: "en" | "fr";
}) {
  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5">
      <h2 className="text-sm font-medium text-ringo-text mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ringo-muted">{emptyLabel}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead>
              <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                <th className="py-2 font-normal">{t.restaurant.nameLabel}</th>
                <th className="font-normal">{t.restaurant.phoneLabel}</th>
                <th className="font-normal">{countLabel}</th>
                <th className="font-normal">{t.music.spentLabel}</th>
                <th className="font-normal">{lastLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.phone}-${i}`} className="border-b border-ringo-border/40 last:border-0">
                  <td className="py-2 text-ringo-text">{r.name || "—"}</td>
                  <td className="text-ringo-text">{r.phone}</td>
                  <td className="text-ringo-text">{r.count}</td>
                  <td className="text-ringo-text" suppressHydrationWarning>
                    {formatPrice(r.amount, currency, locale)}
                  </td>
                  <td className="text-ringo-muted">{new Date(r.lastAt).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MusicCustomersView({
  topFans,
  topSupporters,
  currency,
}: {
  topFans: Row[];
  topSupporters: Row[];
  currency: string;
}) {
  const { t, locale } = useLanguage();

  return (
    <div className="flex flex-col gap-5">
      <Section
        title={t.music.topFansTitle}
        rows={topFans}
        countLabel={t.music.purchasesLabel}
        lastLabel={t.music.lastPurchaseLabel}
        emptyLabel={t.music.noFansYet}
        currency={currency}
        t={t}
        locale={locale}
      />
      <Section
        title={t.music.topSupportersTitle}
        rows={topSupporters}
        countLabel={t.music.supportsLabel}
        lastLabel={t.music.lastSupportLabel}
        emptyLabel={t.music.noSupportersYet}
        currency={currency}
        t={t}
        locale={locale}
      />
    </div>
  );
}
