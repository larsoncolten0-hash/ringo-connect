"use client";

import { ShoppingBag } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import Ring from "@/components/brand/Ring";
import Reveal from "./Reveal";
import { Section, SectionHeading } from "./Section";

// Beat 6, commerce: Ringo is more than a link page. Presence, Product, Customer, Sale, told as four short true beats and one
// tactile picture: a lit product stage with a price and an order button, and the receipt that follows (the Ring closed, "Paid",
// Mobile Money). It is an illustration of what a customer sees, so it is hidden from assistive technology; it implies no payment
// method beyond Mobile Money "where enabled", the same wording as the Africa-first section, and it touches no payment logic.
const ZIGZAG = "conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) 50% / 16px 100%";

function CommerceVisual() {
  const { t } = useLanguage();
  const l = t.landing;
  return (
    <div aria-hidden="true" className="relative mx-auto flex w-full max-w-[420px] flex-col items-center gap-4 lg:block lg:h-[440px] lg:max-w-none">
      <div className="w-full max-w-[300px] overflow-hidden rounded-ringo-lg border border-ringo-line-warm bg-ringo-surface shadow-ringo-3 lg:absolute lg:left-0 lg:top-0">
        <div
          className="ringo-lamp flex h-44 items-center justify-center bg-ringo-ink"
          style={{ ["--lamp-x" as string]: "50%", ["--lamp-y" as string]: "55%", ["--lamp-size" as string]: "280px", ["--lamp-strength" as string]: "0.3" }}
        >
          <ShoppingBag size={48} strokeWidth={1.25} className="text-ringo-gold" />
        </div>
        <div className="p-5">
          <p className="ringo-display text-lg font-semibold leading-snug">{l.commerceDemoProduct}</p>
          <p className="mt-1 text-sm tabular-nums text-ringo-muted">{l.commerceDemoPrice}</p>
          <div className="mt-4 flex h-11 items-center justify-center rounded-full bg-ringo-indigo text-sm font-semibold text-white">{l.commerceDemoOrder}</div>
        </div>
      </div>

      <div
        className="w-full max-w-[240px] bg-white px-5 pb-9 pt-5 text-ringo-ink shadow-ringo-3 lg:absolute lg:bottom-0 lg:right-0"
        style={{ WebkitMask: ZIGZAG, mask: ZIGZAG }}
      >
        <div className="flex items-center gap-2.5">
          <Ring size={28} state="connected" />
          <span className="ringo-display text-lg font-semibold">{l.commerceDemoPaid}</span>
        </div>
        <div className="mt-4 border-t border-dashed border-ringo-ink/20 pt-3 text-xs leading-relaxed text-ringo-stone-600">
          <p>{l.commerceDemoProduct}</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-ringo-ink">{l.commerceDemoPrice}</p>
          <p className="mt-2">{l.commerceDemoMethod}</p>
        </div>
      </div>
    </div>
  );
}

export default function CommerceStory() {
  const { t } = useLanguage();
  const l = t.landing;

  const beats = [
    { title: l.commerceStepPresenceTitle, body: l.commerceStepPresenceBody },
    { title: l.commerceStepProductTitle, body: l.commerceStepProductBody },
    { title: l.commerceStepCustomerTitle, body: l.commerceStepCustomerBody },
    { title: l.commerceStepSaleTitle, body: l.commerceStepSaleBody },
  ];

  return (
    <Section>
      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-x-20 gap-y-12 items-center">
        <Reveal>
          <SectionHeading title={l.commerceTitle} lead={l.commerceSubtitle} />
          <ol className="mt-10 max-w-lg">
            {beats.map((b, i) => (
              <li key={b.title} className="grid grid-cols-[2rem_1fr] gap-x-3 border-t border-ringo-line-warm py-4">
                <span className="ringo-display pt-0.5 text-sm font-semibold tabular-nums text-ringo-gold-text">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="ringo-display text-base font-semibold">{b.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ringo-muted">{b.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Reveal>
        <Reveal delay={0.1}>
          <CommerceVisual />
        </Reveal>
      </div>
    </Section>
  );
}
