"use client";

import { useLanguage } from "@/components/LanguageProvider";
import Reveal from "./Reveal";
import EcosystemDiagram from "./EcosystemDiagram";
import { Section, SectionHeading } from "./Section";

// Beat 2, the idea: a link page shows people where to click; Ringo brings identity, business, commerce and customers together.
// One statement, one diagram (the Ring with everything Ringo does around it), and the eight things a Ringo becomes as a quiet
// two-column definition list. Not eight cards: the hierarchy is the statement first, the evidence second, the detail third.
export default function IdeaSection() {
  const { t } = useLanguage();
  const l = t.landing;

  const identities = [
    { label: l.moreCardCard, desc: l.moreCardCardDesc },
    { label: l.moreCardHub, desc: l.moreCardHubDesc },
    { label: l.moreCardStore, desc: l.moreCardStoreDesc },
    { label: l.moreCardMenu, desc: l.moreCardMenuDesc },
    { label: l.moreCardShowcase, desc: l.moreCardShowcaseDesc },
    { label: l.moreCardConnection, desc: l.moreCardConnectionDesc },
    { label: l.moreCardBookings, desc: l.moreCardBookingsDesc },
    { label: l.moreCardCommunity, desc: l.moreCardCommunityDesc },
  ];

  return (
    <Section id="features" tone="quiet">
      <div className="grid lg:grid-cols-2 gap-x-16 gap-y-12 items-start">
        <Reveal>
          <SectionHeading title={l.ecosystemTitle} lead={l.whySubtitle} />
        </Reveal>

        <Reveal delay={0.1} className="lg:row-span-2 lg:self-center">
          <EcosystemDiagram />
        </Reveal>

        <Reveal>
          <h3 className="ringo-display text-xl font-semibold tracking-[-0.01em]">{l.moreTitle}</h3>
          <p className="mt-2 text-ringo-muted max-w-md">{l.moreSubtitle}</p>
          <dl className="mt-6 grid sm:grid-cols-2 gap-x-8">
            {identities.map((item) => (
              <div key={item.label} className="py-4 border-t border-ringo-line-warm">
                <dt className="text-sm font-semibold text-ringo-text">{item.label}</dt>
                <dd className="mt-1 text-sm text-ringo-muted leading-relaxed">{item.desc}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </Section>
  );
}
