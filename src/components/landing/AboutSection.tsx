"use client";

import { Manrope } from "next/font/google";

// Scoped to just this section (and PathPickerSection, which loads its own
// instance) — Space Grotesk is already loaded site-wide as --font-display
// (see src/app/layout.tsx), reused below via the existing `font-display`
// Tailwind utility, but Manrope isn't loaded anywhere else in this app
// (the rest of the landing page uses Inter as its body font). next/font
// self-hosts and scopes this to wherever `manrope.className` is applied,
// so it never becomes a second site-wide body font or an extra
// render-blocking <link> the way loading it via a Google Fonts <link> tag
// (as the standalone funnel pages do) would.
const manrope = Manrope({ subsets: ["latin"], weight: ["500", "700", "800"] });

// Deliberately its own one-off palette (cream bg, dark cards, amber/violet
// accents) matching the three static funnel pages (public/*-funnel.html)
// byte-for-byte in color values — the point is that landing → this
// section → a funnel page → signup reads as one continuous experience,
// not a jarring handoff into a differently-designed page. Scoped entirely
// to inline styles/Tailwind utilities on this component's own elements
// (same one-off-color convention LandingView.tsx already uses for its
// per-section Kicker colors) — nothing here touches a global theme
// variable, so every other section on the page is unaffected.
const CREAM = "#F7F2E7";
const INK = "#14142B";
const MUTED = "#6B6455";
const AMBER = "#F2A93B";
const AMBER_INK = "#2B1A00";

export default function AboutSection() {
  return (
    <section className={`${manrope.className} relative`} style={{ background: CREAM, padding: "80px 0 70px" }}>
      <div className="max-w-6xl mx-auto px-5">
        <div className="text-[14px] font-bold mb-3.5" style={{ color: MUTED }}>
          About Ringo Connect
        </div>

        <h2
          className="font-display font-bold leading-[1.15] tracking-[-0.01em] max-w-[16ch] mb-5"
          style={{ fontSize: 40, color: INK }}
        >
          One link that actually <span style={{ color: AMBER }}>runs</span> your business.
        </h2>

        <p className="text-lg leading-relaxed max-w-[56ch] mb-10 font-medium" style={{ color: MUTED }}>
          Ringo Connect replaces a website, a POS system, and a ticket box office with one page — built for how
          businesses in Cameroon actually work, and paid for the way you already pay: MTN and Orange Mobile Money.
        </p>

        <div className="flex flex-wrap gap-2.5 mb-10">
          {[
            {
              label: "Restaurants",
              svg: (
                <>
                  <path d="M18 32l6-16h44l6 16" />
                  <path d="M18 32v10a9 9 0 0018 0 9 9 0 0018 0 9 9 0 0018 0v-10" />
                  <path d="M24 42v34h44V42" />
                  <path d="M40 76V56h12v20" />
                </>
              ),
            },
            {
              label: "Musicians",
              svg: (
                <>
                  <path d="M30 78V30l40-8v48" />
                  <circle cx="24" cy="78" r="10" />
                  <circle cx="64" cy="70" r="10" />
                </>
              ),
            },
            {
              label: "Shops",
              svg: (
                <>
                  <rect x="16" y="24" width="52" height="38" rx="8" />
                  <path d="M16 40h52" />
                  <circle cx="72" cy="66" r="18" fill={CREAM} />
                  <path d="M64 66l6 6 12-13" />
                </>
              ),
            },
            {
              label: "Freelancers",
              svg: (
                <>
                  <rect x="18" y="18" width="64" height="64" rx="14" />
                  <circle cx="50" cy="42" r="12" />
                  <path d="M28 70c4-12 14-18 22-18s18 6 22 18" />
                </>
              ),
            },
            {
              label: "Businesses & Institutions",
              svg: (
                <>
                  <rect x="24" y="18" width="52" height="64" rx="4" />
                  <path d="M34 30h8M50 30h8M34 44h8M50 44h8M34 58h8M50 58h8" />
                  <path d="M42 82V66h16v16" />
                </>
              ),
            },
          ].map((chip) => (
            <div
              key={chip.label}
              className="flex items-center gap-2 rounded-full px-4 py-2.5 pl-3 text-sm font-bold"
              style={{ background: "rgba(20,20,43,0.05)", border: "1.5px solid rgba(20,20,43,0.1)", color: INK }}
            >
              <svg
                viewBox="0 0 100 100"
                fill="none"
                stroke="currentColor"
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-[18px] h-[18px] shrink-0"
                style={{ color: AMBER }}
              >
                {chip.svg}
              </svg>
              {chip.label}
            </div>
          ))}
        </div>

        <div
          className="inline-flex items-center gap-3 rounded-2xl px-5 py-3.5 text-[14.5px] font-bold"
          style={{ background: INK, color: "#FBE7C6" }}
        >
          <svg
            viewBox="0 0 100 100"
            fill="none"
            stroke="currentColor"
            strokeWidth={4.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-[22px] h-[22px] shrink-0"
            style={{ color: AMBER }}
          >
            <rect x="30" y="12" width="36" height="62" rx="9" />
            <path d="M30 58h36" />
            <circle cx="48" cy="36" r="13" />
            <path d="M42 36l4 4 8-9" />
          </svg>
          Real payments straight to your MTN or Orange Mobile Money — no bank account needed.
        </div>
      </div>
    </section>
  );
}
