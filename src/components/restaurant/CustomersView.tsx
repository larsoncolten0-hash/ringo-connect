"use client";

import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";

// Owner/admin-only (RLS on restaurant_customers) — a restaurant only ever
// sees its own customers, scoped by profile_id like everything else here.
// marketing_opt_in is read from customer_marketing_consent, a separate
// table on purpose (see the migration) — never assumed from order history.
export default function CustomersView({ customers, currency }: { customers: any[]; currency: string }) {
  const { t, locale } = useLanguage();

  if (customers.length === 0) {
    return <p className="text-sm text-ringo-muted">{t.restaurant.noCustomersYet}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[600px]">
        <thead>
          <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
            <th className="py-2 font-normal">{t.restaurant.nameLabel}</th>
            <th className="font-normal">{t.restaurant.phoneLabel}</th>
            <th className="font-normal">{t.restaurant.totalOrdersLabel}</th>
            <th className="font-normal">{t.restaurant.totalSpentLabel}</th>
            <th className="font-normal">{t.restaurant.lastOrderLabel}</th>
            <th className="font-normal">{t.restaurant.marketingColumnLabel}</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id} className="border-b border-ringo-border/40 last:border-0">
              <td className="py-2 text-ringo-text">{c.name || "—"}</td>
              <td className="text-ringo-text">{c.phone}</td>
              <td className="text-ringo-text">{c.total_orders}</td>
              <td className="text-ringo-text" suppressHydrationWarning>
                {formatPrice(c.total_spent, currency, locale)}
              </td>
              <td className="text-ringo-muted">{c.last_order_at ? new Date(c.last_order_at).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US") : "—"}</td>
              <td>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    c.customer_marketing_consent?.[0]?.opted_in
                      ? "bg-ringo-teal/10 text-ringo-teal"
                      : "bg-ringo-muted/10 text-ringo-muted"
                  }`}
                >
                  {c.customer_marketing_consent?.[0]?.opted_in ? t.restaurant.marketingOptedIn : t.restaurant.marketingOptedOut}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
