"use client";

import { Link2, Music, ShoppingBag, UtensilsCrossed, Ticket, Users, BarChart3, CalendarCheck, Megaphone } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { QrCode as QrCodeIcon, CreditCard } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import Ring from "@/components/brand/Ring";

// Every chip maps to a real, shipped Ringo capability (see LandingView's top comment). One idea: the Ring at the centre, with
// everything Ringo does arranged around it. All twelve chips share one treatment (no per-chip brand colors), so the diagram
// reads as one system rather than a rainbow. From sm up it is the radial hub; on phones it is a plain three-column grid, because
// twelve radial labels at 12px do not fit in 280px without overlapping.
export default function EcosystemDiagram() {
  const { t } = useLanguage();

  const chips: { icon: any; label: string }[] = [
    { icon: Link2, label: t.landing.chipLinks },
    { icon: Music, label: t.landing.chipMusic },
    { icon: ShoppingBag, label: t.landing.chipCatalog },
    { icon: UtensilsCrossed, label: t.landing.chipMenu },
    { icon: Ticket, label: t.landing.chipTickets },
    { icon: FaWhatsapp, label: t.landing.chipWhatsapp },
    { icon: QrCodeIcon, label: t.landing.chipQr },
    { icon: CreditCard, label: t.landing.chipNfc },
    { icon: Users, label: t.landing.chipCustomers },
    { icon: BarChart3, label: t.landing.chipAnalytics },
    { icon: CalendarCheck, label: t.landing.chipBookings },
    { icon: Megaphone, label: t.landing.chipCommunity },
  ];

  const R = 40; // radius, as a % of the square container: keeps the SVG (viewBox 0 0 100 100) and the absolutely-positioned chips in exact agreement at any size
  const positions = chips.map((_, i) => {
    const angle = (i / chips.length) * 2 * Math.PI - Math.PI / 2;
    // rounded: the server and the browser compute cos/sin to different last digits, which React reports as a hydration mismatch
    return { x: Math.round((50 + R * Math.cos(angle)) * 1000) / 1000, y: Math.round((50 + R * Math.sin(angle)) * 1000) / 1000 };
  });

  const chipCircle =
    "rounded-full flex items-center justify-center shrink-0 bg-ringo-surface border border-ringo-line-warm text-ringo-gold-text shadow-ringo-1";

  return (
    <>
      <div className="relative mx-auto w-full max-w-xl aspect-square hidden sm:block">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {positions.map((p, i) => (
            <line key={i} x1="50" y1="50" x2={p.x} y2={p.y} style={{ stroke: "rgb(var(--rc-gold) / 0.45)" }} strokeWidth="0.35" />
          ))}
        </svg>

        {/* The hub: Ink with a gilt edge, and the Ring */}
        <div className="ringo-gilt absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-28 h-28 rounded-full bg-ringo-ink flex items-center justify-center shadow-ringo-3">
          <Ring size={64} state="idle" />
        </div>

        {chips.map((chip, i) => (
          <div
            key={chip.label}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 w-24 text-center"
            style={{ left: `${positions[i].x}%`, top: `${positions[i].y}%` }}
          >
            <span className={`w-11 h-11 ${chipCircle}`}>
              <chip.icon size={17} />
            </span>
            <span className="text-xs font-medium text-ringo-text leading-tight">{chip.label}</span>
          </div>
        ))}
      </div>

      <div className="sm:hidden flex flex-col items-center gap-8">
        <div className="ringo-gilt w-20 h-20 rounded-full bg-ringo-ink flex items-center justify-center shadow-ringo-3">
          <Ring size={48} state="idle" />
        </div>
        <ul className="grid grid-cols-3 gap-x-3 gap-y-6 w-full">
          {chips.map((chip) => (
            <li key={chip.label} className="flex flex-col items-center gap-2 text-center">
              <span className={`w-11 h-11 ${chipCircle}`}>
                <chip.icon size={17} />
              </span>
              <span className="text-xs font-medium text-ringo-text leading-tight">{chip.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
