"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import Reveal from "./Reveal";
import RestaurantShowcase from "./RestaurantShowcase";
import { Section, SectionHeading, secondaryButton } from "./Section";

// The restaurant story, kept as its own beat because the nav, the footer and the industries list all link to #restaurant: the
// warmest of the category experiences (menu, hours, dine-in / takeaway / delivery, a QR on every table). The menu mock is the real
// product's own look (its green theme is the Restaurant category's recommended theme); everything around it is Ringo's.
export default function RestaurantSection() {
  const { t } = useLanguage();
  const l = t.landing;
  const points = [l.restaurantPointMenu, l.restaurantPointHours, l.restaurantPointOrder, l.restaurantPointQr];

  return (
    <Section id="restaurant" tone="quiet">
      <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
        <Reveal>
          <SectionHeading title={l.restaurantTitle} lead={l.restaurantSubtitle} />
          <ul className="mt-8 flex flex-col gap-3.5">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-3 text-sm leading-relaxed text-ringo-text">
                <Check size={16} className="mt-0.5 shrink-0 text-ringo-gold-text" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
          <Link href="/get-started" className={`${secondaryButton} mt-9`}>
            {l.restaurantCta}
            <ArrowRight size={14} />
          </Link>
        </Reveal>
        <Reveal delay={0.15}>
          <RestaurantShowcase />
        </Reveal>
      </div>
    </Section>
  );
}
