"use client";

import { useEffect, useRef, useState } from "react";
import { CreditCard, Hand, User, Link2, QrCode as QrCodeIcon, Compass } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import RingoCard3D from "@/components/brand/RingoCard3D";
import Ring from "@/components/brand/Ring";
import { nextConnectState, type ConnectState } from "@/lib/design/tapToConnect";
import Reveal from "./Reveal";
import { Section, SectionHeading } from "./Section";

// Beat 5, the physical to digital story and the page's second-strongest moment (after the hero). The Ringo Connect Card is a real
// NFC tag written with a profile's URL, the same page a QR code or plain link opens: no separate backend, no invented integration.
// Two true flows: Card, Tap, Profile, Connect; and QR, Scan, Profile, Connect. The object is the foundation's RingoCard3D (the same
// one as the hero, not a second card renderer): when it scrolls into view it plays the one tap-to-connect beat, once.
// The sample holder is the hero's, so the two cards are visibly the same object; the card is decorative and hidden from assistive tech.
const TAP_DELAY_MS = 500;
const CONNECT_DELAY_MS = 1700;

function CardStoryObject() {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ConnectState>("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        timers.push(setTimeout(() => setState((s) => nextConnectState(s, "tap")), TAP_DELAY_MS));
        timers.push(setTimeout(() => setState((s) => nextConnectState(s, "confirm")), CONNECT_DELAY_MS));
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div ref={ref} aria-hidden="true" className="relative mx-auto w-full max-w-[340px] sm:max-w-[420px] lg:max-w-[460px]">
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[560px] w-[560px] max-w-[140vw] -translate-x-1/2 -translate-y-1/2"
        style={{ background: "radial-gradient(closest-side, rgb(var(--rc-gold) / 0.14), transparent)" }}
      />
      <RingoCard3D name="Amina Kouam" ringoId="0042" state={state} restTilt={{ x: 3, y: 9 }} emblem className="relative max-w-none" />
    </div>
  );
}

function Flow({ steps }: { steps: { icon: any; label: string }[] }) {
  return (
    <ol className="grid grid-cols-4 gap-2">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={s.label} className="relative flex flex-col items-center gap-2.5 text-center">
            {!last && <span aria-hidden="true" className="absolute left-[calc(50%+26px)] top-[22px] h-px w-[calc(100%-44px)] bg-ringo-gold/40" />}
            {last ? (
              <Ring size={44} state="connected" />
            ) : (
              <span className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border border-ringo-gold/50 bg-ringo-ink text-ringo-gold">
                <s.icon size={18} />
              </span>
            )}
            <span className="text-xs font-medium leading-snug text-ringo-paper/90 sm:text-sm">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function CardStorySection() {
  const { t } = useLanguage();
  const l = t.landing;

  const nfcFlow = [
    { icon: CreditCard, label: l.nfcFlowCard },
    { icon: Hand, label: l.nfcFlowTap },
    { icon: User, label: l.nfcFlowProfile },
    { icon: Link2, label: l.nfcFlowConnect },
  ];
  const qrFlow = [
    { icon: QrCodeIcon, label: l.qrFlowScan },
    { icon: User, label: l.qrFlowProfile },
    { icon: Compass, label: l.qrFlowDiscover },
    { icon: Link2, label: l.qrFlowConnect },
  ];

  return (
    <Section id="nfc" tone="ink">
      <div className="grid lg:grid-cols-2 gap-x-20 gap-y-12 items-start">
        <Reveal>
          <SectionHeading title={l.nfcTitle} lead={l.nfcSubtitle} tone="dark" />
          <div className="mt-10 max-w-lg">
            <Flow steps={nfcFlow} />
          </div>
        </Reveal>

        <Reveal delay={0.1} className="lg:row-span-2 lg:self-center">
          <CardStoryObject />
        </Reveal>

        <Reveal>
          <div className="max-w-lg border-t border-ringo-paper/10 pt-10">
            <h3 className="ringo-display text-2xl font-semibold tracking-[-0.015em]">{l.qrTitle}</h3>
            <p className="mt-3 leading-relaxed text-ringo-stone-300">{l.qrSubtitle}</p>
            <div className="mt-8">
              <Flow steps={qrFlow} />
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
