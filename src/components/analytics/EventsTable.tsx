"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, MousePointerClick, ShoppingBag, MessageCircle, Inbox, type LucideIcon } from "lucide-react";
import { getReferrerSource } from "@/lib/geo";
import Pagination from "./Pagination";

type ClickEvent = {
  target_type: "page" | "link" | "product" | "whatsapp";
  target_id: string | null;
  referrer: string | null;
  country: string | null;
  created_at: string;
};

const TYPE_ICON: Record<ClickEvent["target_type"], LucideIcon> = {
  page: Eye,
  link: MousePointerClick,
  product: ShoppingBag,
  whatsapp: MessageCircle,
};

const PAGE_SIZE = 15;

export default function EventsTable({
  events,
  links,
  products,
  regionNames,
  labels,
}: {
  events: ClickEvent[];
  links: { id: string; title: string }[];
  products: { id: string; name: string }[];
  regionNames: Record<string, string>;
  labels: {
    type: string;
    target: string;
    source: string;
    location: string;
    time: string;
    typeLabels: Record<ClickEvent["target_type"], string>;
    direct: string;
    unknown: string;
    empty: string;
    of: string;
    itemLabel: string;
  };
}) {
  const [page, setPage] = useState(1);

  // Newest first, capped to a page at a time — the underlying `events`
  // array is already the full filtered range (up to 20k rows), so this
  // is a pure client-side slice, not a new query per page.
  const sorted = useMemo(
    () => [...events].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [events]
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  useEffect(() => setPage(1), [events]);
  const safePage = Math.min(page, totalPages);

  const pageItems = useMemo(
    () => sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sorted, safePage]
  );

  const targetName = (e: ClickEvent) => {
    if (e.target_type === "link") return links.find((l) => l.id === e.target_id)?.title || "—";
    if (e.target_type === "product") return products.find((p) => p.id === e.target_id)?.name || "—";
    return "—";
  };

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center text-center gap-2 py-16">
        <span className="w-9 h-9 rounded-full bg-ringo-muted/10 flex items-center justify-center">
          <Inbox size={15} className="text-ringo-muted" />
        </span>
        <p className="text-sm text-ringo-muted max-w-[220px]">{labels.empty}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
              <th className="py-2.5 font-normal">{labels.type}</th>
              <th className="font-normal">{labels.target}</th>
              <th className="font-normal">{labels.source}</th>
              <th className="font-normal">{labels.location}</th>
              <th className="font-normal text-right">{labels.time}</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((e, i) => {
              const Icon = TYPE_ICON[e.target_type];
              return (
                <tr
                  key={`${e.created_at}-${i}`}
                  className="border-b border-ringo-border/40 last:border-0 hover:bg-ringo-muted/5 transition-colors"
                >
                  <td className="py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-ringo-text">
                      <Icon size={13} className="text-ringo-muted shrink-0" />
                      {labels.typeLabels[e.target_type]}
                    </span>
                  </td>
                  <td className="text-ringo-text truncate max-w-[160px]">{targetName(e)}</td>
                  <td className="text-ringo-muted">{getReferrerSource(e.referrer, labels.direct)}</td>
                  <td className="text-ringo-muted">
                    {e.country ? regionNames[e.country] || e.country : labels.unknown}
                  </td>
                  <td className="text-ringo-muted text-right tabular-nums whitespace-nowrap" suppressHydrationWarning>
                    {/* Server and client can render a different hour/day
                        here (server-side ICU locale, and more likely the
                        server's own timezone vs. the visitor's) — same
                        class of mismatch AnalyticsView.tsx flags for
                        region names, mitigated the same way ProfileView.tsx
                        handles formatPrice: suppress rather than gate
                        behind a mount effect for a table that can run to
                        hundreds of rows. */}
                    {new Date(e.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        page={safePage}
        totalPages={totalPages}
        onPageChange={setPage}
        totalItems={sorted.length}
        pageSize={PAGE_SIZE}
        itemLabel={labels.itemLabel}
        ofLabel={labels.of}
      />
    </div>
  );
}
