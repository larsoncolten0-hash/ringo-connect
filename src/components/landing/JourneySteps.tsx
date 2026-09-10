"use client";

import { useLanguage } from "@/components/LanguageProvider";

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
    <div className="grid sm:grid-cols-5 gap-4">
      {steps.map((step, i) => (
        <div key={step.n} className="relative flex flex-col gap-2">
          {i < steps.length - 1 && (
            <div className="hidden sm:block absolute top-4 left-[calc(50%+22px)] w-[calc(100%-22px)] h-px bg-ringo-border" aria-hidden="true" />
          )}
          <span className="relative z-10 w-9 h-9 rounded-full bg-ringo-indigo/10 text-ringo-indigo font-display font-bold text-xs flex items-center justify-center">
            {step.n}
          </span>
          <h3 className="text-sm font-semibold text-ringo-text">{step.title}</h3>
          <p className="text-sm text-ringo-muted leading-relaxed">{step.body}</p>
        </div>
      ))}
    </div>
  );
}
