"use client";

import Link from "next/link";
import { ArrowRight, Music, UtensilsCrossed, Store, Building2, Bus, Briefcase } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import Reveal from "./Reveal";
import IndustryShowcase from "./IndustryShowcase";
import { Section, SectionHeading } from "./Section";

// Beat 4, the category experience: Ringo changes with the person or business. The one piece of evidence is the real product, a
// single phone that switches between the Artist, Restaurant and Business profiles (their own recommended themes, exactly as a
// profile renders them: dark and cinematic for music, warm for food, structured for business). The frame around it is Ringo's, so
// the categories read as one product wearing different themes, not as separate brands. The six industries are a quiet list
// (same destinations as before), not six colored cards.
export default function IndustriesSection() {
  const { t } = useLanguage();
  const l = t.landing;

  const industries = [
    { icon: Music, title: l.industryArtistsTitle, body: l.industryArtistsBody, cta: l.industryArtistsCta, href: "/get-started" },
    { icon: UtensilsCrossed, title: l.industryRestaurantsTitle, body: l.industryRestaurantsBody, cta: l.industryRestaurantsCta, href: "#restaurant" },
    { icon: Store, title: l.industryBusinessTitle, body: l.industryBusinessBody, cta: l.industryBusinessCta, href: "/get-started" },
    { icon: Building2, title: l.industryRealEstateTitle, body: l.industryRealEstateBody, cta: l.industryRealEstateCta, href: "/get-started" },
    { icon: Bus, title: l.industryTransportTitle, body: l.industryTransportBody, cta: l.industryTransportCta, href: "/get-started" },
    { icon: Briefcase, title: l.industryProfessionalsTitle, body: l.industryProfessionalsBody, cta: l.industryProfessionalsCta, href: "/get-started" },
  ];

  return (
    <Section id="industries">
      <div className="grid lg:grid-cols-[1fr_auto] gap-x-20 gap-y-12 items-start">
        <Reveal>
          <SectionHeading title={l.industriesTitle} lead={l.industriesSubtitle} />
        </Reveal>

        <Reveal delay={0.1} className="lg:row-span-2 lg:self-center">
          <IndustryShowcase />
        </Reveal>

        <Reveal>
          <ul className="max-w-xl">
            {industries.map((ind) => (
              <li key={ind.title} className="border-t border-ringo-line-warm first:border-t-0 lg:first:border-t">
                <Link
                  href={ind.href}
                  className="group flex items-start gap-4 py-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-text"
                >
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-ringo-sm bg-ringo-gold/15 text-ringo-gold-text">
                    <ind.icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="ringo-display block text-lg font-semibold tracking-[-0.01em]">{ind.title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-ringo-muted">{ind.body}</span>
                    <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-ringo-gold-text transition-[gap] duration-ringo-fast ease-ringo group-hover:gap-2">
                      {ind.cta}
                      <ArrowRight size={14} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </Section>
  );
}
