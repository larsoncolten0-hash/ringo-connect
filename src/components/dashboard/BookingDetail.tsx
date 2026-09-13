"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Phone, Mail, Check, X, Loader2 } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { useLanguage } from "@/components/LanguageProvider";
import { createClient } from "@/lib/supabase/client";
import { BOOKING_STATUS_COLOR, availableActions, type BookingStatus } from "@/lib/bookingStatus";

// Owner-side status changes go straight through the authenticated browser
// client + a booking_status_history insert — no API route needed, RLS
// ("bookings owner all") already scopes correctness. Exactly the same
// pattern RestaurantOrdersView.tsx already uses for order status changes.
export default function BookingDetail({ booking, whatsappNumber }: { booking: any; whatsappNumber?: string | null }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const supabase = createClient();
  const [updating, setUpdating] = useState<BookingStatus | null>(null);

  const statusLabel = (s: string) => (t.bookings as any)[`status${s[0].toUpperCase()}${s.slice(1)}`] || s;

  const changeStatus = async (next: BookingStatus) => {
    setUpdating(next);
    if (next === "confirmed") {
      // Goes through an API route instead of the direct update below —
      // this is also the moment a confirmation email fires, and sendEmail
      // is server-only. See that route for the RLS ownership check.
      await fetch(`/api/bookings/${booking.id}/confirm`, { method: "POST" });
    } else {
      await supabase.from("bookings").update({ status: next, updated_at: new Date().toISOString() }).eq("id", booking.id);
      await supabase.from("booking_status_history").insert({ booking_id: booking.id, status: next });
    }
    setUpdating(null);
    router.refresh();
  };

  const details = booking.details || {};
  const history = [...(booking.booking_status_history || [])].sort(
    (a: any, b: any) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime()
  );

  const infoRows: { label: string; value: string | null }[] = [
    { label: t.bookings.email, value: booking.customer_email },
    { label: t.bookings.phone, value: booking.customer_phone },
    { label: t.bookings.date, value: booking.booking_date ? new Date(booking.booking_date + "T00:00:00").toLocaleDateString(locale) : null },
    { label: t.bookings.time, value: booking.booking_time },
    { label: t.bookings.service, value: booking.service_name_snapshot },
    { label: t.bookings.partySize, value: booking.party_size ? String(booking.party_size) : null },
    { label: t.bookings.location, value: booking.location },
    { label: t.bookings.budget, value: booking.budget },
    { label: t.bookings.eventType, value: details.event_type || null },
    { label: t.bookings.meetingType, value: details.meeting_type || null },
  ].filter((r) => r.value);

  return (
    <div className="max-w-2xl flex flex-col gap-4">
      <Link href="/dashboard/bookings" className="flex items-center gap-1.5 text-sm text-ringo-muted hover:text-ringo-text w-fit">
        <ArrowLeft size={15} />
        {t.bookings.backToBookings}
      </Link>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 flex flex-col gap-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-lg font-medium text-ringo-text">{booking.customer_name}</h1>
            <p className="text-xs text-ringo-muted mt-0.5">
              {t.bookings.submittedOn} {new Date(booking.created_at).toLocaleString(locale)}
            </p>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap ${BOOKING_STATUS_COLOR[booking.status] || ""}`}>
            {statusLabel(booking.status)}
          </span>
        </div>

        {(booking.consent_email_updates || booking.consent_whatsapp_updates) && (
          <div className="flex flex-wrap gap-2">
            {booking.consent_email_updates && (
              <span className="text-[11px] px-2 py-1 rounded-full bg-ringo-teal/10 text-ringo-teal">{t.bookings.consentEmailBadge}</span>
            )}
            {booking.consent_whatsapp_updates && (
              <span className="text-[11px] px-2 py-1 rounded-full bg-ringo-teal/10 text-ringo-teal">{t.bookings.consentWhatsappBadge}</span>
            )}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {infoRows.map((row) => (
            <div key={row.label}>
              <p className="text-xs text-ringo-muted">{row.label}</p>
              <p className="text-ringo-text">{row.value}</p>
            </div>
          ))}
        </div>

        {booking.notes && (
          <div>
            <p className="text-xs text-ringo-muted mb-1">{t.bookings.notes}</p>
            <p className="text-sm text-ringo-text whitespace-pre-wrap">{booking.notes}</p>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-ringo-border/70">
          {availableActions(booking.status as BookingStatus).map(({ action, primary }) => (
            <button
              key={action}
              onClick={() => changeStatus(action)}
              disabled={!!updating}
              className={`flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-card transition disabled:opacity-50 ${
                primary ? "bg-ringo-indigo text-white hover:brightness-110" : "border border-ringo-border text-ringo-text hover:border-red-500 hover:text-red-500"
              }`}
            >
              {updating === action ? <Loader2 size={14} className="animate-spin" /> : primary ? <Check size={14} /> : <X size={14} />}
              {action === "confirmed"
                ? t.bookings.confirmAction
                : action === "declined"
                ? t.bookings.declineAction
                : action === "completed"
                ? t.bookings.completeAction
                : t.bookings.cancelAction}
            </button>
          ))}

          <a
            href={`tel:${booking.customer_phone}`}
            className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition"
          >
            <Phone size={14} />
            {t.bookings.contactCustomer}
          </a>
          {booking.customer_email && (
            <a
              href={`mailto:${booking.customer_email}`}
              aria-label={t.bookings.email}
              className="flex items-center justify-center w-9 h-9 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition"
            >
              <Mail size={14} />
            </a>
          )}
          {whatsappNumber && (
            <a
              href={`https://wa.me/${booking.customer_phone.replace(/[^0-9]/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp"
              className="flex items-center justify-center w-9 h-9 rounded-card border border-ringo-border hover:border-ringo-indigo transition"
            >
              <FaWhatsapp size={14} className="text-[#25D366]" />
            </a>
          )}
        </div>
      </div>

      {history.length > 0 && (
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5">
          <p className="text-sm font-medium text-ringo-text mb-3">{t.bookings.statusHistory}</p>
          <div className="flex flex-col gap-2">
            {history.map((h: any) => (
              <div key={h.id} className="flex items-center justify-between text-sm">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${BOOKING_STATUS_COLOR[h.status] || ""}`}>
                  {statusLabel(h.status)}
                </span>
                <span className="text-xs text-ringo-muted">{new Date(h.changed_at).toLocaleString(locale)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
