"use client";

import { Link2, Music, ShoppingBag, UtensilsCrossed, Ticket, Users, BarChart3 } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { QrCode as QrCodeIcon, Radio } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Every chip here maps to a real, shipped Ringo capability (links,
// catalog, tracks, restaurant menu/ordering, events/tickets, WhatsApp,
// QR, click analytics) plus NFC (a tag encoded with the same profile URL
// a QR code already points to — no separate backend needed). Nothing
// invented — see LandingView.tsx's own comment on this.
export default function EcosystemDiagram() {
  const { t } = useLanguage();

  const chips: { icon: any; label: string; color: string }[] = [
    { icon: Link2, label: t.landing.chipLinks, color: "#4F46E5" },
    { icon: Music, label: t.landing.chipMusic, color: "#F2B705" },
    { icon: ShoppingBag, label: t.landing.chipCatalog, color: "#FF6B4A" },
    { icon: UtensilsCrossed, label: t.landing.chipMenu, color: "#1F9D55" },
    { icon: Ticket, label: t.landing.chipTickets, color: "#14B8A6" },
    { icon: FaWhatsapp, label: t.landing.chipWhatsapp, color: "#25D366" },
    { icon: QrCodeIcon, label: t.landing.chipQr, color: "#0F172A" },
    { icon: Radio, label: t.landing.chipNfc, color: "#7C3AED" },
    { icon: Users, label: t.landing.chipCustomers, color: "#E11D48" },
    { icon: BarChart3, label: t.landing.chipAnalytics, color: "#0EA5E9" },
  ];

  return (
    <div className="relative rounded-[28px] border border-ringo-border/70 bg-ringo-surface p-6 sm:p-10">
      <div className="flex flex-col items-center gap-6">
        <div className="w-20 h-20 rounded-full bg-ringo-indigo flex items-center justify-center shadow-[0_12px_32px_-8px_rgba(79,70,229,0.5)]">
          <span className="text-white font-display font-bold text-sm">Ringo</span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5 sm:gap-3 w-full">
          {chips.map((chip) => (
            <div
              key={chip.label}
              className="flex flex-col items-center gap-1.5 text-center rounded-card border border-ringo-border/60 bg-ringo-bg p-3 transition hover:-translate-y-0.5"
            >
              <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${chip.color}1a`, color: chip.color }}>
                <chip.icon size={14} />
              </span>
              <span className="text-[11px] font-medium text-ringo-text leading-tight">{chip.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
