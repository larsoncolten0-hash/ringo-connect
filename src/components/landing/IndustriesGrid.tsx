"use client";

import Link from "next/link";
import { ArrowRight, Music, UtensilsCrossed, Store, Building2, Bus, Briefcase } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

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
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {industries.map((ind) => (
        <div
          key={ind.title}
          className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 flex flex-col gap-3 transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_rgba(15,23,42,0.12)]"
        >
          <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${ind.color}1a`, color: ind.color }}>
            <ind.icon size={18} />
          </span>
          <div>
            <h3 className="font-display font-medium text-ringo-text mb-1">{ind.title}</h3>
            <p className="text-sm text-ringo-muted leading-relaxed">{ind.body}</p>
          </div>
          <Link
            href={ind.href || "/auth/signup"}
            className="text-sm font-medium flex items-center gap-1 mt-auto"
            style={{ color: ind.color }}
          >
            {ind.cta}
            <ArrowRight size={13} />
          </Link>
        </div>
      ))}
    </div>
  );
}
