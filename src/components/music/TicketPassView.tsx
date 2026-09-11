"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Clock, CheckCircle2, XCircle, Ban, RotateCcw, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { drawQrCodeWithLogo } from "@/lib/qrCode";

// The actual digital ticket — see the route file's own comment for how a
// fan gets here (their own order confirmation, or re-opening a saved/
// shared link). The QR only ever renders once the order is actually paid
// AND the ticket itself is still 'valid' — same "no access until paid"
// rule the rest of Music's protected purchases already follow (see
// PurchasedItem in MusicStorePage), so an unpaid cash/card order can't be
// waved at a door as if it were real.
export default function TicketPassView({
  ticket,
  order,
  event,
  ticketTypeName,
  price,
  artistName,
  accent,
  currency,
}: {
  ticket: { code: string; status: string; attendeeName: string; usedAt: string | null };
  order: { orderNumber: number; paymentStatus: string; createdAt: string };
  event: { title: string; location: string | null; date: string | null; time: string | null; coverImageUrl: string | null };
  ticketTypeName: string;
  price: number | null;
  artistName: string;
  accent: string;
  currency: string;
}) {
  const { t, locale } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrStatus, setQrStatus] = useState<"idle" | "ready" | "error">("idle");

  const paid = order.paymentStatus === "paid";
  const isValid = ticket.status === "valid";
  const showQr = paid && isValid;

  useEffect(() => {
    if (!showQr) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawQrCodeWithLogo(canvas, typeof window !== "undefined" ? window.location.href : "", 260)
      .then(() => setQrStatus("ready"))
      .catch(() => setQrStatus("error"));
  }, [showQr]);

  const statusMeta: Record<string, { label: string; color: string; Icon: any }> = {
    valid: { label: t.music.ticketStatusValid, color: "#16A34A", Icon: CheckCircle2 },
    used: { label: t.music.ticketStatusUsed, color: "#6B7280", Icon: CheckCircle2 },
    cancelled: { label: t.music.ticketStatusCancelled, color: "#DC2626", Icon: XCircle },
    refunded: { label: t.music.ticketStatusRefunded, color: "#DC2626", Icon: RotateCcw },
  };
  const meta = statusMeta[ticket.status] || statusMeta.valid;

  return (
    <div className="min-h-screen bg-white pb-16 flex flex-col items-center" style={{ color: "#14202B" }}>
      <div className="w-full max-w-sm px-4 py-6 flex flex-col gap-4">
        <p className="text-center text-xs font-semibold uppercase tracking-wider" style={{ opacity: 0.5 }}>
          Ringo Connect
        </p>

        <div className="rounded-3xl overflow-hidden" style={{ border: "1px solid #E5E7EB" }}>
          <div className="relative h-32 w-full">
            {event.coverImageUrl ? (
              <img src={event.coverImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${accent}, #171009)` }} />
            )}
            <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75), transparent 60%)" }} />
            <div className="absolute bottom-3 left-4 right-4 text-white">
              <p className="text-[11px] uppercase tracking-wide opacity-80">{artistName}</p>
              <p className="font-display text-lg font-bold truncate">{event.title}</p>
            </div>
          </div>

          <div className="p-4 flex flex-col gap-4">
            {!paid ? (
              <div className="rounded-2xl p-4 text-center" style={{ backgroundColor: "#F3F4F6" }}>
                <Loader2 size={18} className="animate-spin mx-auto mb-2" style={{ color: accent }} />
                <p className="text-sm font-semibold">{t.music.ticketPassPendingTitle}</p>
                <p className="text-xs mt-1" style={{ opacity: 0.6 }}>
                  {t.music.ticketPassPendingBody}
                </p>
              </div>
            ) : showQr ? (
              <div className="flex flex-col items-center gap-2 py-2">
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
                <span className="text-xs font-mono tracking-widest" style={{ opacity: 0.5 }}>
                  {ticket.code}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-4">
                <meta.Icon size={32} style={{ color: meta.color }} />
                <span className="text-sm font-semibold" style={{ color: meta.color }}>
                  {meta.label}
                </span>
                {ticket.status === "used" && ticket.usedAt && (
                  <span className="text-xs" style={{ opacity: 0.5 }}>
                    {new Date(ticket.usedAt).toLocaleString(locale === "fr" ? "fr-FR" : "en-US")}
                  </span>
                )}
              </div>
            )}

            {showQr && (
              <span
                className="self-center inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full"
                style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}
              >
                <meta.Icon size={12} />
                {meta.label}
              </span>
            )}

            <div className="h-px w-full" style={{ backgroundColor: "#E5E7EB" }} />

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-[10px] uppercase tracking-wide" style={{ opacity: 0.5 }}>
                  {t.music.ticketPassTicketType}
                </p>
                <p className="font-semibold truncate">{ticketTypeName || "—"}</p>
              </div>
              {price != null && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide" style={{ opacity: 0.5 }}>
                    {t.editor.price}
                  </p>
                  <p className="font-semibold" suppressHydrationWarning>
                    {formatPrice(price, currency, locale)}
                  </p>
                </div>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-wide" style={{ opacity: 0.5 }}>
                  {t.music.ticketPassAttendee}
                </p>
                <p className="font-semibold truncate">{ticket.attendeeName}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide" style={{ opacity: 0.5 }}>
                  {t.restaurant.orderNumberLabel}
                </p>
                <p className="font-semibold">#{order.orderNumber}</p>
              </div>
            </div>

            {(event.location || event.date || event.time) && (
              <>
                <div className="h-px w-full" style={{ backgroundColor: "#E5E7EB" }} />
                <div className="flex flex-col gap-1.5 text-sm" style={{ opacity: 0.8 }}>
                  {event.location && (
                    <span className="flex items-center gap-1.5">
                      <MapPin size={13} /> {event.location}
                    </span>
                  )}
                  {(event.date || event.time) && (
                    <span className="flex items-center gap-1.5">
                      <Clock size={13} /> {[event.date, event.time].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <p className="text-center text-xs" style={{ opacity: 0.4 }}>
          {t.music.ticketPassFooter}
        </p>
      </div>
    </div>
  );
}
