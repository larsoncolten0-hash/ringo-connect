"use client";

import Link from "next/link";
import { ArrowRight, Music, UtensilsCrossed, Store, Building2, Bus, Briefcase } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { hexToRgba } from "@/lib/color";

export default function IndustriesGrid() {
  const { t } = useLanguage();

  const industries = [
    { icon: Music, color: "#F2B705", title: t.landing.industryArtistsTitle, body: t.landing.industryArtistsBody, cta: t.landing.industryArtistsCta },
    { icon: UtensilsCrossed, color: "#1F9D55", title: t.landing.industryRestaurantsTitle, body: t.landing.industryRestaurantsBody, cta: t.landing.industryRestaurantsCta, href: "#restaurant" },
    { icon: Store, color: "#FF6B4A", title: t.landing.industryBusinessTitle, body: t.landing.industryBusinessBody, cta: t.landing.industryBusinessCta },
    { icon: Building2, color: "#0EA5E9", title: t.landing.industryRealEstateTitle, body: t.landing.industryRealEstateBody, cta: t.landing.industryRealEstateCta },
    { icon: Bus, color: "#7C3AED", title: t.landing.industryTransportTitle, body: t.landing.industryTransportBody, cta: t.landing.industryTransportCta },
    { icon: Briefcase, color: "#E11D48", title: t.landing.industryProfessionalsTitle, body: t.landing.industryProfessionalsBody, cta: t.landing.industryProfessionalsCta },
  ];

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {industries.map((ind) => (
        <div
          key={ind.title}
          className="group relative rounded-[22px] overflow-hidden bg-ringo-surface shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition-all hover:-translate-y-1.5 hover:shadow-[0_20px_40px_-14px_rgba(15,23,42,0.3)]"
        >
          {/* Colorful header zone — the icon lives on real color, not a
              tiny tinted circle on white. */}
          <div
            className="relative h-24 flex items-center justify-center overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${ind.color}, ${hexToRgba(ind.color, 0.65)})` }}
          >
            <div className="absolute -right-4 -top-6 w-24 h-24 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.14)" }} />
            <div className="absolute -left-6 bottom-0 w-16 h-16 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.1)" }} />
            <span className="relative w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white shadow-[0_8px_20px_-6px_rgba(0,0,0,0.3)]">
              <ind.icon size={26} />
            </span>
          </div>

          <div className="p-5 flex flex-col gap-3">
            <div>
              <h3 className="font-display font-medium text-ringo-text mb-1">{ind.title}</h3>
              <p className="text-sm text-ringo-muted leading-relaxed">{ind.body}</p>
            </div>
            <Link
              href={ind.href || "/auth/signup"}
              className="text-sm font-semibold flex items-center gap-1 mt-1 transition-transform group-hover:gap-2"
              style={{ color: ind.color }}
            >
              {ind.cta}
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
