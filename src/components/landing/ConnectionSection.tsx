"use client";

import { ArrowDown, Smartphone, Wallet, Users, ShoppingBag } from "lucide-react";
import { QrCode as QrCodeIcon } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { useLanguage } from "@/components/LanguageProvider";
import Ring from "@/components/brand/Ring";
import Reveal from "./Reveal";
import { Section, SectionHeading } from "./Section";

// Beat 3, made for real connection. The Africa-first argument is made through product behavior, not imagery or decoration: a visitor
// on a Ringo profile taps WhatsApp (the product page's own "Hi, I'm interested in ..." message), a real conversation starts, and a
// customer is made. Next to it, the five true statements about how Ringo is built (the phone in your customer's hand, WhatsApp, QR and
// the card, Mobile Money where enabled, local business). This is the dark section that follows the quiet idea section.
//
// The thread is one illustration, not a second phone: three short steps joined by arrows, in the Ringo system. It shows no payment and
// claims nothing beyond what a profile, its WhatsApp action and the customer connection already do. It is sample content (a made-up
// holder and product), so it is hidden from assistive technology; the five statements carry the content.
function ConnectionThread() {
  const { t } = useLanguage();
  const l = t.landing;
  const label = "text-xs font-medium text-ringo-stone-300";

  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-[380px] rounded-ringo-lg border border-ringo-paper/10 bg-ringo-ink-2 p-5 shadow-ringo-3"
    >
      {/* 1. a product on a Ringo profile, with its WhatsApp action */}
      <p className={label}>{l.nfcFlowProfile}</p>
      <div className="mt-2.5 rounded-ringo-md border border-ringo-paper/10 p-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ringo-sm bg-ringo-gold/15 text-ringo-gold">
            <ShoppingBag size={18} />
          </span>
          <span className="min-w-0">
            <span className="ringo-display block text-sm font-semibold leading-snug">{l.commerceDemoProduct}</span>
            <span className="block text-xs tabular-nums text-ringo-stone-300">{l.commerceDemoPrice}</span>
          </span>
        </div>
        <div className="mt-3 flex h-11 items-center justify-center gap-2 rounded-full border border-ringo-gold/60 text-sm font-semibold text-ringo-gold">
          <FaWhatsapp size={16} />
          {l.chipWhatsapp}
        </div>
      </div>

      <ArrowDown size={16} className="mx-auto my-3.5 text-ringo-gold/60" />

      {/* 2. the conversation that starts from it */}
      <p className={label}>{l.chipWhatsapp}</p>
      <div className="mt-2.5 flex flex-col gap-2">
        <p className="ml-auto max-w-[88%] rounded-ringo-md rounded-br-sm border border-ringo-gold/30 bg-ringo-gold/15 px-3.5 py-2.5 text-sm leading-snug text-ringo-paper">
          {l.connectionDemoAsk}
        </p>
        <p className="max-w-[88%] rounded-ringo-md rounded-bl-sm bg-ringo-paper/10 px-3.5 py-2.5 text-sm leading-snug text-ringo-paper">
          {l.connectionDemoReply}
        </p>
      </div>

      <ArrowDown size={16} className="mx-auto my-3.5 text-ringo-gold/60" />

      {/* 3. the connection */}
      <div className="flex items-center gap-3">
        <Ring size={36} state="connected" />
        <span className="ringo-display text-base font-semibold">{l.connectionFlowCustomer}</span>
      </div>
    </div>
  );
}

export default function ConnectionSection() {
  const { t } = useLanguage();
  const l = t.landing;

  const points = [
    { icon: Smartphone, text: l.africaPointMobile },
    { icon: FaWhatsapp, text: l.africaPointWhatsapp },
    { icon: QrCodeIcon, text: l.africaPointQrNfc },
    { icon: Wallet, text: l.africaPointMoney },
    { icon: Users, text: l.africaPointLocal },
  ];

  return (
    <Section tone="ink">
      {/* the one lamp in this viewport */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-[520px] w-[520px] -translate-x-1/3 -translate-y-1/3"
        style={{ background: "radial-gradient(closest-side, rgb(var(--rc-gold) / 0.16), transparent)" }}
      />
      <div className="relative grid gap-x-20 gap-y-12 lg:grid-cols-2 lg:items-start">
        <Reveal>
          <SectionHeading title={l.africaTitle} lead={l.africaSubtitle} tone="dark" />
        </Reveal>

        <Reveal delay={0.1} className="lg:row-span-2 lg:self-center">
          <ConnectionThread />
        </Reveal>

        <Reveal>
          <ol className="relative max-w-xl">
            {points.map((p, i) => (
              <li key={i} className="relative flex items-start gap-4 pb-8 last:pb-0">
                {i < points.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute left-[21px] top-11 bottom-0 w-px"
                    style={{ background: "linear-gradient(to bottom, rgb(var(--rc-gold) / 0.5), rgb(var(--rc-gold) / 0.12))" }}
                  />
                )}
                <span className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ringo-gold/50 bg-ringo-ink text-ringo-gold">
                  <p.icon size={18} />
                </span>
                <p className="pt-2.5 text-base leading-relaxed text-ringo-paper/90">{p.text}</p>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </Section>
  );
}
