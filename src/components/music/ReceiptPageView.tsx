"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin, Clock, Download, Loader2, CheckCircle2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { drawQrCodeWithLogo } from "@/lib/qrCode";
import type { MusicReceiptData } from "@/lib/musicReceipt";

// The premium fan-facing receipt (PART 7/34 of the ticket receipt spec) —
// see src/app/m/[username]/receipt/[id]/page.tsx for how a fan gets here.
// Deliberately NOT a copy of the business-facing accounting receipts
// (ReceiptView.tsx/MusicReceiptView.tsx, shown on the artist's own
// dashboard) — same underlying order, different audience and different
// job: this one has to say "I paid, here's my ticket" at a glance on a
// phone screen, not itemize a transaction for bookkeeping.
export default function ReceiptPageView({ data }: { data: MusicReceiptData }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrStatus, setQrStatus] = useState<"idle" | "ready" | "error">("idle");
  const [downloading, setDownloading] = useState(false);

  const paid = data.paymentStatus === "paid";
  // A single VALID ticket gets its QR embedded directly on the receipt,
  // matching the spec's "your event ticket" section — the common case
  // (one fan, one ticket type, quantity 1). Two or more tickets each need
  // their own independently-scannable QR (see PART 24 — one admission per
  // code), so rendering N QR canvases into one receipt gets cluttered
  // fast; those link out to their own already-built ticket-pass page
  // instead (see the "Your tickets" section below), which is exactly the
  // same full-size QR experience, just one tap away rather than
  // duplicated here. A cancelled/refunded ticket never gets the
  // "scan this" treatment either way (see PART 26) — it still shows up in
  // the list below, linking to its own pass page, which already renders
  // its real (non-scannable) status instead of a QR.
  const singleTicket = data.tickets.length === 1 && data.tickets[0].status === "valid" ? data.tickets[0] : null;

  useEffect(() => {
    if (paid) return;
    const interval = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(interval);
  }, [paid, router]);

  useEffect(() => {
    if (!paid || !singleTicket) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = `${window.location.origin}/m/${data.artistUsername}/ticket-pass/${singleTicket.code}`;
    drawQrCodeWithLogo(canvas, url, 260)
      .then(() => setQrStatus("ready"))
      .catch(() => setQrStatus("error"));
  }, [paid, singleTicket, data.artistUsername]);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/music/orders/${data.orderId}/receipt-pdf`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.receiptNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setDownloading(false);
    }
  };

  const dateLabel = new Date(data.createdAt).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-white pb-16 flex flex-col items-center" style={{ color: "#14202B" }}>
      <div className="w-full max-w-sm px-4 py-6 flex flex-col gap-4">
        <p className="text-center text-xs font-semibold uppercase tracking-wider" style={{ opacity: 0.5 }}>
          Ringo Connect
        </p>

        <div className="rounded-3xl overflow-hidden" style={{ border: "1px solid #E5E7EB" }}>
          {/* Header — receipt identity, strongest element after "I paid" itself. */}
          <div className="px-5 pt-5 pb-4 text-center" style={{ background: `linear-gradient(135deg, ${data.accent}14, transparent)` }}>
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: data.accent }}>
              {t.music.receiptPageTitle}
            </p>
            <p className="font-display text-lg font-bold mt-1">{data.artistName}</p>
            <p className="text-xs mt-2 flex items-center justify-center gap-2 flex-wrap" style={{ opacity: 0.55 }}>
              <span>
                {t.music.receiptNumberLabel} {data.receiptNumber}
              </span>
              <span aria-hidden>·</span>
              <span>
                {t.restaurant.orderNumberLabel} {data.orderNumber}
              </span>
              <span aria-hidden>·</span>
              <span>{dateLabel}</span>
            </p>
          </div>

          <div className="px-5 flex flex-col gap-4 pb-5">
            {/* Customer */}
            <Section label={t.music.receiptCustomerSection}>
              <p className="font-semibold text-sm">{data.customerName}</p>
              {data.customerEmail && (
                <p className="text-xs" style={{ opacity: 0.6 }}>
                  {data.customerEmail}
                </p>
              )}
            </Section>

            {/* Event — only when every ticket line shares one event */}
            {data.event && (
              <Section label={t.music.receiptEventSection}>
                <p className="font-semibold text-sm">{data.event.title}</p>
                {(data.event.date || data.event.time) && (
                  <p className="text-xs flex items-center gap-1.5 mt-0.5" style={{ opacity: 0.65 }}>
                    <Clock size={12} />
                    {[data.event.date, data.event.time].filter(Boolean).join(" · ")}
                  </p>
                )}
                {data.event.location && (
                  <p className="text-xs flex items-center gap-1.5 mt-0.5" style={{ opacity: 0.65 }}>
                    <MapPin size={12} />
                    {data.event.location}
                  </p>
                )}
              </Section>
            )}

            {/* Purchase details */}
            <Section label={t.music.receiptPurchaseSection}>
              <div className="flex flex-col gap-1.5">
                {data.items.map((line, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span>
                      {line.name}
                      {line.quantity > 1 && <span style={{ opacity: 0.6 }}> — {line.quantity} × {formatPrice(line.unitPrice, data.currency, locale)}</span>}
                    </span>
                    <span className="font-medium shrink-0 pl-2" suppressHydrationWarning>
                      {formatPrice(line.lineTotal, data.currency, locale)}
                    </span>
                  </div>
                ))}
              </div>
            </Section>

            {/* Total + status — the second-strongest element on the page. */}
            <div className="rounded-2xl p-4 flex flex-col items-center gap-1.5" style={{ backgroundColor: "#F9FAFB" }}>
              <p className="text-[10px] uppercase tracking-wide" style={{ opacity: 0.5 }}>
                {t.music.receiptTotalPaidLabel}
              </p>
              <p className="font-display text-2xl font-bold" suppressHydrationWarning>
                {formatPrice(data.total, data.currency, locale)}
              </p>
              <span
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full mt-1"
                style={paid ? { backgroundColor: "#16A34A1a", color: "#16A34A" } : { backgroundColor: "#F59E0B1a", color: "#B45309" }}
              >
                {paid ? <CheckCircle2 size={12} /> : <Loader2 size={12} className="animate-spin" />}
                {paid ? t.music.receiptStatusPaid : t.music.receiptStatusPending}
              </span>
              {!paid && (
                <p className="text-[11px] text-center mt-1 max-w-[240px]" style={{ opacity: 0.55 }}>
                  {t.music.receiptPendingNote}
                </p>
              )}
            </div>

            {/* Ticket credential(s) — the whole reason a printed/emailed
                receipt still needs to be a live page. */}
            {paid && singleTicket && (
              <Section label={t.music.receiptYourTicketSection}>
                <div className="flex flex-col items-center gap-2 py-1">
                  <div
                    className="rounded-2xl border flex items-center justify-center"
                    style={{ width: 220, height: 220, borderColor: "#E5E7EB" }}
                  >
                    {qrStatus === "error" ? (
                      <p className="text-xs text-center px-4" style={{ color: "#991B1B" }}>
                        {t.profilePage.qrCodeError}
                      </p>
                    ) : (
                      <canvas ref={canvasRef} className={qrStatus === "ready" ? "" : "hidden"} />
                    )}
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ opacity: 0.55 }}>
                    {t.music.receiptScanNote}
                  </span>
                  <Link
                    href={`/m/${data.artistUsername}/ticket-pass/${singleTicket.code}`}
                    className="text-xs font-medium mt-0.5"
                    style={{ color: data.accent }}
                  >
                    {t.music.receiptViewFullTicket}
                  </Link>
                </div>
              </Section>
            )}

            {paid && !singleTicket && data.tickets.length > 0 && (
              <Section label={t.music.receiptYourTicketsSection}>
                <div className="flex flex-col gap-1.5">
                  {data.tickets.map((ticket, i) => (
                    <Link
                      key={ticket.code}
                      href={`/m/${data.artistUsername}/ticket-pass/${ticket.code}`}
                      className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm"
                      style={{ border: "1px solid #E5E7EB" }}
                    >
                      <span className="truncate">
                        {ticket.ticketTypeName}
                        {data.tickets.length > 1 ? ` #${i + 1}` : ""}
                        {ticket.status !== "valid" && (
                          <span className="ml-1.5" style={{ opacity: 0.5 }}>
                            · {(t.music as any)[`ticketStatus${ticket.status[0].toUpperCase()}${ticket.status.slice(1)}`] || ticket.status}
                          </span>
                        )}
                      </span>
                      <span className="text-xs font-medium shrink-0 pl-2" style={{ color: data.accent }}>
                        {t.music.receiptViewTicketAction}
                      </span>
                    </Link>
                  ))}
                </div>
              </Section>
            )}

            {data.artistContact && (
              <Section label={t.music.receiptOrganizerContact}>
                <p className="text-sm">{data.artistContact}</p>
              </Section>
            )}

            <button
              onClick={downloadPdf}
              disabled={downloading}
              className="flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white disabled:opacity-60 mt-1"
              style={{ backgroundColor: data.accent }}
            >
              {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {downloading ? t.music.receiptDownloadingPdf : t.music.receiptDownloadPdf}
            </button>
          </div>
        </div>

        <p className="text-center text-xs" style={{ opacity: 0.4 }}>
          {t.music.receiptThankYou} {t.music.receiptPoweredBy}.
        </p>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ opacity: 0.5 }}>
        {label}
      </p>
      {children}
    </div>
  );
}
