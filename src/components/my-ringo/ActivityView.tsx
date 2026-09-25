"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarCheck, ChevronRight, Gift, History, Link2, Music, Package, RotateCcw, ShoppingBag, TrendingUp, Unlink, Utensils } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import type { ActivityItem } from "@/lib/customer/activity";
import EmptyState from "./EmptyState";
import { isLoyaltyKind, loyaltyKindLabel, loyaltyLine } from "./loyalty/activityText";

// The customer's history, grouped by day. Every row is a real record the
// server resolved as belonging to THIS customer (see listActivity) — nothing
// is invented. Tapping a row with a receipt/order page opens that existing
// page; rows without one (connections, bookings) are informational.

const ICONS: Record<ActivityItem["kind"], LucideIcon> = {
  connected: Link2,
  disconnected: Unlink,
  music_order: Music,
  restaurant_order: Utensils,
  booking: CalendarCheck,
  shop_order: ShoppingBag,
  // Ringo Loyalty events (same feed, same row layout)
  loyalty_progress: TrendingUp,
  loyalty_correction: RotateCcw,
  reward_unlocked: Gift,
  reward_redeemed: Gift,
  package_activated: Package,
  package_used: Package,
};

const STATUS_TONE: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-600",
  served: "bg-emerald-500/10 text-emerald-600",
  confirmed: "bg-emerald-500/10 text-emerald-600",
  paid: "bg-emerald-500/10 text-emerald-600",
  fulfilled: "bg-emerald-500/10 text-emerald-600",
  pending: "bg-amber-500/10 text-amber-600",
  unpaid: "bg-amber-500/10 text-amber-600",
  awaiting_payment: "bg-amber-500/10 text-amber-600",
  payment_review: "bg-amber-500/10 text-amber-600",
  accepted: "bg-sky-500/10 text-sky-600",
  preparing: "bg-sky-500/10 text-sky-600",
  ready: "bg-sky-500/10 text-sky-600",
  cancelled: "bg-red-500/10 text-red-600",
  declined: "bg-red-500/10 text-red-600",
  refunded: "bg-ringo-muted/15 text-ringo-muted",
  expired: "bg-ringo-muted/15 text-ringo-muted",
  failed: "bg-red-500/10 text-red-600",
};

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[tone] || "bg-ringo-muted/15 text-ringo-muted"}`}>{children}</span>;
}

export default function ActivityView({ items }: { items: ActivityItem[] }) {
  const { t, locale } = useLanguage();
  const a = t.myRingo.activity;

  // Arriving from Home's Recent Activity (#activity-<id>): scroll to that entry
  // and highlight it briefly. Plain DOM APIs, same approach as HighlightOnArrival.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash.startsWith("activity-")) return;
    const el = document.getElementById(hash);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightId(hash);
    const timer = setTimeout(() => setHighlightId(null), 2500);
    return () => clearTimeout(timer);
  }, []);
  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";
  const dayKey = (iso: string) => new Date(iso).toDateString();

  const groups: { key: string; label: string; items: ActivityItem[] }[] = [];
  for (const item of items) {
    const key = dayKey(item.at);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = {
        key,
        label: new Date(item.at).toLocaleDateString(dateLocale, { day: "numeric", month: "long", year: "numeric" }),
        items: [],
      };
      groups.push(group);
    }
    group.items.push(item);
  }

  const kindLabel = (item: ActivityItem) =>
    isLoyaltyKind(item.kind)
      ? loyaltyKindLabel(t, item.kind)
      : {
          connected: a.connected,
          disconnected: a.disconnected,
          music_order: a.musicPurchase,
          restaurant_order: a.restaurantOrder,
          booking: a.booking,
          shop_order: a.shopOrder,
        }[item.kind];

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ringo-text">{a.title}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{a.subtitle}</p>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={History} title={a.emptyTitle} body={a.emptyBody} />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ringo-muted" suppressHydrationWarning>
                {group.label}
              </h2>
              <ul className="overflow-hidden rounded-2xl border border-ringo-border/70 bg-ringo-surface">
                {group.items.map((item) => {
                  const Icon = ICONS[item.kind];
                  const isOrder = item.kind === "music_order" || item.kind === "restaurant_order" || item.kind === "shop_order";
                  const summaryText = item.summary ?? loyaltyLine(t, locale, item);
                  const body = (
                    <div className="flex items-start gap-3 px-4 py-3.5">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ringo-indigo/10 text-ringo-indigo">
                        <Icon size={17} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ringo-text">{kindLabel(item)}</p>
                            {item.profile && <p className="truncate text-xs text-ringo-muted">{item.profile.name}</p>}
                          </div>
                          {isOrder && item.amount != null && item.currency && (
                            <p className="shrink-0 text-sm font-semibold text-ringo-text">
                              {formatPrice(item.amount, item.currency, locale)}
                            </p>
                          )}
                        </div>
                        {(summaryText || item.orderNumber != null) && (
                          <p className="mt-1 truncate text-xs text-ringo-muted">
                            {item.orderNumber != null && `${a.orderNumber(item.orderNumber)}${summaryText ? " · " : ""}`}
                            {summaryText}
                          </p>
                        )}
                        {(item.status || item.paymentStatus) && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {item.status && <Chip tone={item.status}>{a.status[item.status] ?? item.status}</Chip>}
                            {isOrder && item.paymentStatus && (
                              <Chip tone={item.paymentStatus}>
                                {a.payment}: {item.paymentStatus === "paid" ? a.paid : a.unpaid}
                              </Chip>
                            )}
                          </div>
                        )}
                        {item.href && (
                          <p className="mt-2 text-xs font-medium text-ringo-indigo">
                            {item.kind === "music_order" ? a.viewReceipt : a.viewOrder}
                          </p>
                        )}
                      </div>
                      {item.href && <ChevronRight size={16} className="mt-2 shrink-0 text-ringo-muted" />}
                    </div>
                  );
                  return (
                    <li
                      key={item.id}
                      id={`activity-${item.id}`}
                      className={`scroll-mt-20 border-b border-ringo-border/60 transition-colors duration-700 last:border-0 ${
                        highlightId === `activity-${item.id}` ? "bg-ringo-indigo/10" : ""
                      }`}
                    >
                      {item.href ? (
                        <Link href={item.href} className="block transition hover:bg-ringo-muted/[0.05]">
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
