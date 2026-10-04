"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { getReferralCode } from "@/lib/referral";
import { useLanguage } from "@/components/LanguageProvider";
import { ASSOCIATION_PUBLIC } from "@/lib/association/publicVisibility";
import Reveal from "./Reveal";
import { Section, SectionHeading } from "./Section";

// "Not sure where to start?": the bridge to the live funnels. Restyled into the Ringo system (a quiet list on the page, no longer a
// separate cream / violet / amber world loaded with its own font), with the destinations and the referral forwarding exactly as before.
// Locale-independent shape only (the destination): title / body / CTA come from translations.ts.
const DESTINATIONS = [
  "/card-funnel.html", // I want a Ringo Card
  "/subscription-funnel.html", // I just want my own page
  "/business-funnel.html", // I'm running a business or team
  "/get-started-association", // I run an association or loyalty program
] as const;

// The first three destinations are plain static files outside the Next.js app (public/*-funnel.html), so a captured ?ref= cannot be
// forwarded server-side the way a normal Next.js Link would; it has to be read from wherever ReferralCapture persisted it
// (localStorage, first-touch, see src/lib/referral.ts) and appended to each href client-side. The fourth (/get-started-association)
// is a normal Next.js page, but it is forwarded the same way for consistency. Read once on mount; getReferralCode() is a no-op on
// the server, so this starts at null and fills in after hydration if a code is actually stored: best-effort, never blocks rendering.
export default function PathPickerSection() {
  const { t } = useLanguage();
  const [ref, setRef] = useState<string | null>(null);

  useEffect(() => {
    setRef(getReferralCode());
  }, []);

  const withRef = (href: string) => (ref ? `${href}?ref=${encodeURIComponent(ref)}` : href);

  const cards = [
    { href: DESTINATIONS[0], title: t.landing.pathPickerCardTitle, body: t.landing.pathPickerCardBody },
    { href: DESTINATIONS[1], title: t.landing.pathPickerPageTitle, body: t.landing.pathPickerPageBody },
    { href: DESTINATIONS[2], title: t.landing.pathPickerBusinessTitle, body: t.landing.pathPickerBusinessBody },
    ...(ASSOCIATION_PUBLIC ? [{ href: DESTINATIONS[3], title: t.landing.pathPickerAssociationTitle, body: t.landing.pathPickerAssociationBody }] : []),
  ];

  return (
    <Section tone="quiet">
      <div className="grid lg:grid-cols-[1fr_1.2fr] gap-x-20 gap-y-10 items-start">
        <Reveal>
          <SectionHeading title={t.landing.pathPickerHeading} lead={t.landing.pathPickerSubheading} />
        </Reveal>
        <Reveal delay={0.1}>
          <ul>
            {cards.map((card) => (
              <li key={card.href} className="border-t border-ringo-line-warm first:border-t-0 lg:first:border-t">
                <a
                  href={withRef(card.href)}
                  className="group block py-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-text"
                >
                  <span className="ringo-display block text-lg font-semibold tracking-[-0.01em]">{card.title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-ringo-muted">{card.body}</span>
                  <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-ringo-gold-text transition-[gap] duration-ringo-fast ease-ringo group-hover:gap-2">
                    {t.landing.pathPickerCardCta}
                    <ArrowRight size={14} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </Section>
  );
}
