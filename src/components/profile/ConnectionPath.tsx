"use client";

import { Compass, Link2, MapPin, MessageCircle } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { hexToRgba } from "@/lib/color";
import ConnectionSeal from "./ConnectionSeal";

// The close of a public profile, as the Ringo journey: a page is discovered, a connection is made, the conversation happens, and two people
// meet. The same journey the Smart Card and the QR code start in the real world (a tap or a scan opens this very page), so the card is not
// a separate product here, it is where this page begins. Purely presentational: it holds no data, calls nothing and has no controls (the
// real actions, Connect, WhatsApp, Call, Save contact and the share menu's QR code, are the ones above and in the corner). Every colour is
// the page's own: the creator's accent, and the page's text colour through currentColor.
const COPY = {
  en: {
    label: "Connection journey",
    title: "From a tap or a scan to a real conversation",
    note: "Every Ringo page opens from a QR code or a Smart Card tap.",
    steps: ["Discover", "Connect", "Reach out", "Meet"],
  },
  fr: {
    label: "Parcours de connexion",
    title: "D'un geste ou d'un scan à une vraie conversation",
    note: "Chaque page Ringo s'ouvre avec un code QR ou un geste de la Smart Card.",
    steps: ["Découvrir", "Se connecter", "Échanger", "Rencontrer"],
  },
} as const;
const ICONS = [Compass, Link2, MessageCircle, MapPin];

export default function ConnectionPath({ accent, line, className = "" }: { accent: string; line: string; className?: string }) {
  const { locale } = useLanguage();
  const c = COPY[locale === "fr" ? "fr" : "en"];
  return (
    <section aria-label={c.label} className={`mx-auto w-full max-w-sm ${className}`}>
      <ConnectionSeal accent={accent} line={line} className="mb-4" />
      <div
        className="rounded-ringo-lg border px-4 py-5 text-center"
        style={{
          borderColor: line,
          backgroundColor: hexToRgba(accent, 0.06),
          backgroundImage: `radial-gradient(120% 90% at 50% 0%, ${hexToRgba(accent, 0.12)}, transparent 62%)`,
        }}
      >
        <h2 className="font-display text-base font-bold leading-snug tracking-tight text-balance">{c.title}</h2>
        <ol className="relative mt-5 grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4 sm:gap-x-1">
          {/* the path: a hairline through the four nodes (wide layout only; on a phone the nodes sit in two rows) */}
          <span aria-hidden="true" className="absolute left-[12.5%] right-[12.5%] top-[18px] hidden h-px sm:block" style={{ backgroundColor: line }} />
          {c.steps.map((label, i) => {
            const Icon = ICONS[i];
            return (
              <li key={label} className="relative flex flex-col items-center gap-1.5 text-xs font-medium">
                <span className="flex h-9 w-9 items-center justify-center rounded-full border" style={{ borderColor: hexToRgba(accent, 0.55), backgroundColor: hexToRgba(accent, 0.14) }}>
                  <Icon size={16} style={{ color: accent }} aria-hidden="true" />
                </span>
                <span>
                  <span className="sr-only">{i + 1}. </span>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 text-xs leading-relaxed [overflow-wrap:anywhere]" style={{ opacity: 0.75 }}>
          {c.note}
        </p>
      </div>
    </section>
  );
}
