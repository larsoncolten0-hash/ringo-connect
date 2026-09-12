"use client";

import Link from "next/link";
import { Inbox, Clock, CheckCircle2, ListChecks, ChevronLeft, ChevronRight } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import StatCard from "@/components/analytics/StatCard";
import EmptyState from "@/components/editor/EmptyState";
import { BOOKING_STATUS_COLOR } from "@/lib/bookingStatus";

export default function BookingsList({
  bookings,
  bookingsEnabled,
  page,
  pageSize,
  totalCount,
  pendingCount,
  confirmedCount,
  completedCount,
}: {
  bookings: any[];
  bookingsEnabled: boolean;
  page: number;
  pageSize: number;
  totalCount: number;
  pendingCount: number;
  confirmedCount: number;
  completedCount: number;
}) {
  const { t, locale } = useLanguage();
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const statusLabel = (s: string) => (t.bookings as any)[`status${s[0].toUpperCase()}${s.slice(1)}`] || s;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label={t.bookings.pendingLabel} value={pendingCount} icon={Clock} accent="indigo" />
        <StatCard label={t.bookings.confirmedLabel} value={confirmedCount} icon={CheckCircle2} accent="teal" />
        <StatCard label={t.bookings.completedLabel} value={completedCount} icon={ListChecks} accent="teal" />
        <StatCard label={t.bookings.totalLabel} value={totalCount} icon={Inbox} accent="slate" />
      </div>

      {!bookingsEnabled && (
        <div className="rounded-card border border-dashed border-ringo-border p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-ringo-muted">{t.bookings.disabledHint}</p>
          <Link href="/dashboard/bookings/settings" className="text-xs font-medium text-ringo-indigo whitespace-nowrap">
            {t.bookings.goToSettings}
          </Link>
        </div>
      )}

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        {bookings.length === 0 ? (
          <div className="py-10">
            <EmptyState icon={Inbox} title={t.bookings.noBookingsYet} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                  <th className="py-3 px-4 font-normal">{t.bookings.columnCustomer}</th>
                  <th className="font-normal">{t.bookings.columnDate}</th>
                  <th className="font-normal">{t.bookings.columnService}</th>
                  <th className="font-normal">{t.bookings.columnStatus}</th>
                  <th className="font-normal px-4"></th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-b border-ringo-border/40 last:border-0 hover:bg-ringo-muted/5 transition-colors">
                    <td className="py-3 px-4">
                      <p className="text-ringo-text font-medium truncate max-w-[160px]">{b.customer_name}</p>
                      <p className="text-xs text-ringo-muted truncate max-w-[160px]">{b.customer_phone}</p>
                    </td>
                    <td className="text-ringo-muted whitespace-nowrap">
                      {b.booking_date ? new Date(b.booking_date + "T00:00:00").toLocaleDateString(locale) : "—"}
                      {b.booking_time ? ` · ${b.booking_time}` : ""}
                    </td>
                    <td className="text-ringo-text truncate max-w-[160px]">{b.service_name_snapshot || "—"}</td>
                    <td>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${BOOKING_STATUS_COLOR[b.status] || ""}`}>
                        {statusLabel(b.status)}
                      </span>
                    </td>
                    <td className="px-4 text-right">
                      <Link
                        href={`/dashboard/bookings/${b.id}`}
                        className="text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors"
                      >
                        {t.bookings.view}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-ringo-border/70 text-sm">
            <span className="text-ringo-muted">{t.bookings.page(page, totalPages)}</span>
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Link
                  href={`/dashboard/bookings?page=${page - 1}`}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors"
                >
                  <ChevronLeft size={13} />
                  {t.bookings.previous}
                </Link>
              ) : (
                <span className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-card border border-ringo-border/50 text-ringo-muted/50">
                  <ChevronLeft size={13} />
                  {t.bookings.previous}
                </span>
              )}
              {page < totalPages ? (
                <Link
                  href={`/dashboard/bookings?page=${page + 1}`}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors"
                >
                  {t.bookings.next}
                  <ChevronRight size={13} />
                </Link>
              ) : (
                <span className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-card border border-ringo-border/50 text-ringo-muted/50">
                  {t.bookings.next}
                  <ChevronRight size={13} />
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
