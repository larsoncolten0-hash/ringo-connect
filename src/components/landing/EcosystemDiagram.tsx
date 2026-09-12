"use client";

import { Link2, Music, ShoppingBag, UtensilsCrossed, Ticket, Users, BarChart3, CalendarCheck, Megaphone } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { QrCode as QrCodeIcon, CreditCard } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Every chip maps to a real, shipped Ringo capability — see LandingView's
// top comment. Laid out as an actual hub-and-spoke (a glowing center node,
// real SVG connector lines, color-coded chips around it), not a plain
// grid — this is the "feels like a real product ecosystem" version.
export default function EcosystemDiagram() {
  const { t } = useLanguage();

  const chips: { icon: any; label: string; color: string }[] = [
    { icon: Link2, label: t.landing.chipLinks, color: "#4F46E5" },
    { icon: Music, label: t.landing.chipMusic, color: "#F2B705" },
    { icon: ShoppingBag, label: t.landing.chipCatalog, color: "#FF6B4A" },
    { icon: UtensilsCrossed, label: t.landing.chipMenu, color: "#1F9D55" },
    { icon: Ticket, label: t.landing.chipTickets, color: "#14B8A6" },
    { icon: FaWhatsapp, label: t.landing.chipWhatsapp, color: "#25D366" },
    { icon: QrCodeIcon, label: t.landing.chipQr, color: "#E11D48" },
    { icon: CreditCard, label: t.landing.chipNfc, color: "#7C3AED" },
    { icon: Users, label: t.landing.chipCustomers, color: "#0EA5E9" },
    { icon: BarChart3, label: t.landing.chipAnalytics, color: "#D97706" },
    { icon: CalendarCheck, label: t.landing.chipBookings, color: "#DB2777" },
    { icon: Megaphone, label: t.landing.chipCommunity, color: "#65A30D" },
  ];

  const R = 40; // radius, as a % of the square container — keeps the SVG (viewBox 0 0 100 100) and the absolutely-positioned chips in exact agreement regardless of screen size
  const positions = chips.map((_, i) => {
    const angle = (i / chips.length) * 2 * Math.PI - Math.PI / 2;
    return { x: 50 + R * Math.cos(angle), y: 50 + R * Math.sin(angle) };
  });

  return (
    <div className="relative mx-auto w-full max-w-xl aspect-square">
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {positions.map((p, i) => (
          <line key={i} x1="50" y1="50" x2={p.x} y2={p.y} stroke={chips[i].color} strokeOpacity="0.35" strokeWidth="0.5" />
        ))}
      </svg>

      {/* Center hub */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-ringo-indigo flex items-center justify-center z-10"
        style={{ boxShadow: "0 0 0 8px rgba(79,70,229,0.12), 0 0 0 16px rgba(79,70,229,0.06), 0 16px 40px -10px rgba(79,70,229,0.6)" }}
      >
        <span className="text-white font-display font-bold text-xs sm:text-sm">Ringo</span>
      </div>

      {chips.map((chip, i) => (
        <div
          key={chip.label}
          className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 w-16 sm:w-20 text-center"
          style={{ left: `${positions[i].x}%`, top: `${positions[i].y}%` }}
        >
          <span
            className="w-9 h-9 sm:w-11 sm:h-11 rounded-full flex items-center justify-center shrink-0 shadow-[0_6px_16px_-4px_rgba(15,23,42,0.25)]"
            style={{ backgroundColor: chip.color, color: "#fff" }}
          >
            <chip.icon size={16} />
          </span>
          <span className="text-[10px] sm:text-[11px] font-medium text-ringo-text leading-tight">{chip.label}</span>
        </div>
      ))}
    </div>
  );
}
