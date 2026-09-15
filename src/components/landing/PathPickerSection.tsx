"use client";

import { useEffect, useState } from "react";
import { Manrope } from "next/font/google";
import { getReferralCode } from "@/lib/referral";

// See AboutSection.tsx's comment on why Manrope is loaded here (scoped,
// self-hosted via next/font) rather than site-wide or via a <link> tag.
const manrope = Manrope({ subsets: ["latin"], weight: ["500", "700", "800"] });

const CREAM2 = "#F1EADA";
const INK = "#14142B";
const MUTED = "#6B6455";
const AMBER = "#F2A93B";
const AMBER_INK = "#2B1A00";
const VIOLET = "#6A5AE0";

const CARDS = [
  {
    tone: "amber" as const,
    title: "I want a Ringo Card",
    body: "A physical tap card + your first month included — 3,500 FCFA, everything explained in 2 minutes.",
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
    title: "I just want my own page",
    body: "Links, catalog, bookings — start free, upgrade whenever you're ready.",
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
    title: "I'm running a business or team",
    body: "Invite staff, assign roles, manage everything together — built for real teams.",
    href: "/business-funnel.html",
    svg: (
      <>
        <rect x="24" y="18" width="52" height="64" rx="4" />
        <path d="M34 30h8M50 30h8M34 44h8M50 44h8M34 58h8M50 58h8" />
        <path d="M42 82V66h16v16" />
      </>
    ),
  },
];

// The three funnel pages are plain static files outside the Next.js app
// (public/*-funnel.html — see the card/subscription/business funnel
// tasks), so a captured ?ref= can't be forwarded server-side the way a
// normal Next.js Link would; it has to be read from wherever
// ReferralCapture persisted it (localStorage, first-touch — see
// src/lib/referral.ts) and appended to each href client-side. Read once on
// mount; getReferralCode() itself is a no-op on the server, so this starts
// at null and fills in after hydration if a code is actually stored — the
// same "best-effort, never blocks rendering" pattern getReferralCode()'s
// own callers use elsewhere (e.g. GetStartedFlow.tsx).
export default function PathPickerSection() {
  const [ref, setRef] = useState<string | null>(null);

  useEffect(() => {
    setRef(getReferralCode());
  }, []);

  const withRef = (href: string) => (ref ? `${href}?ref=${encodeURIComponent(ref)}` : href);

  return (
    <section className={`${manrope.className} relative`} style={{ background: CREAM2, padding: "76px 0" }}>
      <div className="max-w-6xl mx-auto px-5">
        <div className="text-center max-w-[520px] mx-auto mb-11">
          <h2 className="font-display font-bold text-[32px] tracking-[-0.01em] mb-3" style={{ color: INK }}>
            Not sure where to start?
          </h2>
          <p className="text-base font-medium" style={{ color: MUTED }}>
            Pick whichever sounds like you — takes two minutes either way.
          </p>
        </div>

        <div className="grid gap-5 sm:max-w-[400px] sm:mx-auto md:max-w-none md:mx-0 md:grid-cols-3">
          {CARDS.map((card) => (
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
                See how it works
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
