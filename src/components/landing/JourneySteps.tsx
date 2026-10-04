"use client";

import { useLanguage } from "@/components/LanguageProvider";
import Ring from "@/components/brand/Ring";

// How it works: Create, Share, Connect, Engage, Grow. One line with five nodes; the last node is the Ring, closed, because
// that is where the journey ends: connected. Horizontal from sm up, a vertical rail on phones. The numerals carry the order.
export default function JourneySteps() {
  const { t } = useLanguage();

  const steps = [
    { n: "01", title: t.landing.journeyCreateTitle, body: t.landing.journeyCreateBody },
    { n: "02", title: t.landing.journeyShareTitle, body: t.landing.journeyShareBody },
    { n: "03", title: t.landing.journeyConnectTitle, body: t.landing.journeyConnectBody },
    { n: "04", title: t.landing.journeyEngageTitle, body: t.landing.journeyEngageBody },
    { n: "05", title: t.landing.journeyGrowTitle, body: t.landing.journeyGrowBody },
  ];

  return (
    <ol className="grid gap-x-5 gap-y-8 sm:grid-cols-5">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={step.n} className="relative grid grid-cols-[2.5rem_1fr] gap-x-4 sm:block">
            {!last && (
              <>
                <span aria-hidden="true" className="absolute left-5 top-12 -bottom-8 w-px bg-ringo-gold/40 sm:hidden" />
                <span aria-hidden="true" className="absolute left-14 top-5 hidden h-px w-[calc(100%-2rem)] bg-ringo-gold/40 sm:block" />
              </>
            )}
            {last ? (
              <Ring size={40} state="connected" />
            ) : (
              <span className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border border-ringo-gold-text/40 bg-ringo-surface ringo-display text-sm font-semibold tabular-nums text-ringo-gold-text">
                {step.n}
              </span>
            )}
            <div className="sm:mt-4">
              <h3 className="ringo-display text-base font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ringo-muted">{step.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
