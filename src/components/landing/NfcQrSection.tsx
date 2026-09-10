"use client";

import { ArrowRight, Radio, Hand, User, Link2, QrCode as QrCodeIcon, Compass } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// NFC here means exactly what NFC actually is: a physical tag written
// with a URL — the same profile URL a QR code already points to. No
// separate backend, no invented integration — just a different physical
// medium for the same real destination.
export default function NfcQrSection() {
  const { t } = useLanguage();

  const nfcFlow = [
    { icon: Radio, label: t.landing.nfcFlowCard },
    { icon: Hand, label: t.landing.nfcFlowTap },
    { icon: User, label: t.landing.nfcFlowProfile },
    { icon: Link2, label: t.landing.nfcFlowConnect },
  ];
  const qrFlow = [
    { icon: QrCodeIcon, label: t.landing.qrFlowScan },
    { icon: User, label: t.landing.qrFlowProfile },
    { icon: Compass, label: t.landing.qrFlowDiscover },
    { icon: Link2, label: t.landing.qrFlowConnect },
  ];

  const Flow = ({ steps }: { steps: { icon: any; label: string }[] }) => (
    <div className="flex items-center justify-center flex-wrap gap-2">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-1.5">
            <span className="w-11 h-11 rounded-full bg-ringo-indigo/10 text-ringo-indigo flex items-center justify-center">
              <s.icon size={17} />
            </span>
            <span className="text-xs font-medium text-ringo-text">{s.label}</span>
          </div>
          {i < steps.length - 1 && <ArrowRight size={14} className="text-ringo-muted shrink-0 -mt-4" />}
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-10">
      <div className="text-center">
        <h3 className="font-display text-xl font-medium text-ringo-text mb-2">{t.landing.nfcTitle}</h3>
        <p className="text-ringo-muted max-w-lg mx-auto mb-6">{t.landing.nfcSubtitle}</p>
        <Flow steps={nfcFlow} />
      </div>
      <div className="text-center pt-8 border-t border-ringo-border/70">
        <h3 className="font-display text-xl font-medium text-ringo-text mb-2">{t.landing.qrTitle}</h3>
        <p className="text-ringo-muted max-w-lg mx-auto mb-6">{t.landing.qrSubtitle}</p>
        <Flow steps={qrFlow} />
      </div>
    </div>
  );
}
