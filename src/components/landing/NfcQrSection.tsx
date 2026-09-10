"use client";

import { ArrowRight, CreditCard, Hand, User, Link2, QrCode as QrCodeIcon, Compass } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// The Ringo Connect Card is a physical NFC tag written with a profile's
// URL — the same destination a QR code or plain link already opens. No
// separate backend, no invented integration — just a different physical
// medium for the same real page. Icon is a literal card, not radio waves,
// to keep the branding as "a card," not a technology acronym.
export default function NfcQrSection() {
  const { t } = useLanguage();

  const nfcFlow = [
    { icon: CreditCard, label: t.landing.nfcFlowCard },
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
    <div className="flex items-center justify-center flex-wrap gap-2.5">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-2.5">
          <div className="flex flex-col items-center gap-2">
            <span className="w-12 h-12 rounded-full bg-ringo-surface border border-ringo-border flex items-center justify-center text-ringo-indigo shadow-[0_4px_16px_-6px_rgba(15,23,42,0.15)]">
              <s.icon size={18} />
            </span>
            <span className="text-xs font-medium text-ringo-text">{s.label}</span>
          </div>
          {i < steps.length - 1 && <ArrowRight size={14} className="text-ringo-border shrink-0 -mt-5" />}
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-14">
      <div className="text-center">
        {/* A small stylized card visual — makes "Ringo Connect Card" a
            concrete object, not just a phrase. */}
        <div
          className="w-20 h-12 mx-auto mb-6 rounded-lg flex items-center justify-center shadow-[0_12px_28px_-8px_rgba(79,70,229,0.5)]"
          style={{ background: "linear-gradient(135deg, #4F46E5, #171009)" }}
        >
          <span className="text-white font-display font-bold text-[10px] tracking-wide">RINGO</span>
        </div>
        <h3 className="font-display text-2xl font-medium tracking-[-0.01em] text-ringo-text mb-3">{t.landing.nfcTitle}</h3>
        <p className="text-ringo-muted max-w-lg mx-auto mb-8">{t.landing.nfcSubtitle}</p>
        <Flow steps={nfcFlow} />
      </div>
      <div className="text-center pt-12 border-t border-ringo-border/70">
        <h3 className="font-display text-2xl font-medium tracking-[-0.01em] text-ringo-text mb-3">{t.landing.qrTitle}</h3>
        <p className="text-ringo-muted max-w-lg mx-auto mb-8">{t.landing.qrSubtitle}</p>
        <Flow steps={qrFlow} />
      </div>
    </div>
  );
}
