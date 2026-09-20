"use client";

import { useEffect, useState } from "react";
import { Manrope } from "next/font/google";
import { getReferralCode } from "@/lib/referral";
import { useLanguage } from "@/components/LanguageProvider";
import { ASSOCIATION_PUBLIC } from "@/lib/association/publicVisibility";

// See AboutSection.tsx's comment on why Manrope is loaded here (scoped,
// self-hosted via next/font) rather than site-wide or via a <link> tag.
const manrope = Manrope({ subsets: ["latin"], weight: ["500", "700", "800"] });

const CREAM2 = "#F1EADA";
const INK = "#14142B";
const MUTED = "#6B6455";
const AMBER = "#F2A93B";
const AMBER_INK = "#2B1A00";
const VIOLET = "#6A5AE0";

// Locale-independent shape only (icon + href + accent) — title/body/CTA
// all come from translations.ts now (see the component body below). All
// four cards were previously hardcoded English with no bilingual support
// at all; caught while adding the fourth (Association Program) and fixed
// for all four in the same pass rather than leaving three of them broken.
const CARD_SHAPES = [
  {
    tone: "amber" as const,
    href: "/card-funnel.html",
    svg: (
      <>
        <rect x="14" y="30" width="46" height="46" rx="9" />
        <circle cx="37" cy="53" r="7" />
        <path d="M68 34c7 6 11 13 11 19s-4 13-11 19" opacity={0.85} />
        <path d="M78 26c11 9 17 18 17 27s-6 18-17 27" opacity={0.5} />
      </>
    ),
  },
  {
    tone: "violet" as const,
    href: "/subscription-funnel.html",
    svg: (
      <>
        <rect x="18" y="14" width="64" height="72" rx="12" />
        <circle cx="50" cy="34" r="10" />
        <path d="M32 56h36M32 66h36M32 76h24" />
      </>
    ),
  },
  {
    tone: "amber" as const,
    href: "/business-funnel.html",
    svg: (
      <>
        <rect x="24" y="18" width="52" height="64" rx="4" />
        <path d="M34 30h8M50 30h8M34 44h8M50 44h8M34 58h8M50 58h8" />
        <path d="M42 82V66h16v16" />
      </>
    ),
  },
  {
    tone: "amber" as const,
    href: "/get-started-association",
    svg: (
      <>
        <circle cx="50" cy="34" r="16" />
        <path d="M50 18l4 10 11 1-8 8 2 11-9-6-9 6 2-11-8-8 11-1z" />
      </>
    ),
  },
];

// The first three destinations are plain static files outside the Next.js
// app (public/*-funnel.html — see the card/subscription/business funnel
// tasks), so a captured ?ref= can't be forwarded server-side the way a
// normal Next.js Link would; it has to be read from wherever
// ReferralCapture persisted it (localStorage, first-touch — see
// src/lib/referral.ts) and appended to each href client-side. The fourth
// (/get-started-association) is a normal Next.js page — ReferralCapture,
// mounted globally in the root layout, already covers it without this —
// but it's forwarded the same way regardless, for consistency with its
// siblings. Read once on mount; getReferralCode() itself is a no-op on
// the server, so this starts at null and fills in after hydration if a
// code is actually stored — the same "best-effort, never blocks
// rendering" pattern getReferralCode()'s own callers use elsewhere (e.g.
// GetStartedFlow.tsx).
export default function PathPickerSection() {
  const { t } = useLanguage();
  const [ref, setRef] = useState<string | null>(null);

  useEffect(() => {
    setRef(getReferralCode());
  }, []);

  const withRef = (href: string) => (ref ? `${href}?ref=${encodeURIComponent(ref)}` : href);

  const cards = [
    { ...CARD_SHAPES[0], title: t.landing.pathPickerCardTitle, body: t.landing.pathPickerCardBody },
    { ...CARD_SHAPES[1], title: t.landing.pathPickerPageTitle, body: t.landing.pathPickerPageBody },
    { ...CARD_SHAPES[2], title: t.landing.pathPickerBusinessTitle, body: t.landing.pathPickerBusinessBody },
    ...(ASSOCIATION_PUBLIC
      ? [{ ...CARD_SHAPES[3], title: t.landing.pathPickerAssociationTitle, body: t.landing.pathPickerAssociationBody }]
      : []),
  ];

  return (
    <section className={`${manrope.className} relative`} style={{ background: CREAM2, padding: "76px 0" }}>
      <div className="max-w-6xl mx-auto px-5">
        <div className="text-center max-w-[520px] mx-auto mb-11">
          <h2 className="font-display font-bold text-[32px] tracking-[-0.01em] mb-3" style={{ color: INK }}>
            {t.landing.pathPickerHeading}
          </h2>
          <p className="text-base font-medium" style={{ color: MUTED }}>
            {t.landing.pathPickerSubheading}
          </p>
        </div>

        <div className={`grid gap-5 sm:max-w-[400px] sm:mx-auto md:max-w-none md:mx-0 md:grid-cols-2 ${cards.length > 3 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
          {cards.map((card) => (
            <div key={card.href} className="rounded-[22px] flex flex-col p-6 pt-7 pb-6" style={{ background: INK }}>
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4.5"
                style={{
                  background: card.tone === "amber" ? "rgba(242,169,59,0.16)" : "rgba(140,124,247,0.16)",
                }}
              >
                <svg
                  viewBox="0 0 100 100"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={4.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-7 h-7"
                  style={{ color: card.tone === "amber" ? AMBER : VIOLET }}
                >
                  {card.svg}
                </svg>
              </div>
              <h3 className="font-display font-bold text-xl mb-2.5" style={{ color: "#F7F2E7" }}>
                {card.title}
              </h3>
              <p className="text-[14.5px] leading-relaxed font-medium mb-5 flex-1" style={{ color: "#B9AF98" }}>
                {card.body}
              </p>
              <a
                href={withRef(card.href)}
                className="flex items-center justify-center gap-1.5 rounded-xl py-3.5 px-4 text-[14.5px] font-extrabold no-underline"
                style={{ background: AMBER, color: AMBER_INK }}
              >
                {t.landing.pathPickerCardCta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
