"use client";

import { useState, type CSSProperties } from "react";
import { Heart } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import type { Translations } from "@/lib/i18n/translations";

const PRESET_AMOUNTS = [500, 1000, 2500, 5000];

// Not a payment integration — tapping an amount opens WhatsApp with a
// ready-made message, the exact same hand-off every "Buy" button on Ringo
// Connect already uses instead of an in-app checkout. There's no wallet or
// disbursement wired up for tips yet, so this deliberately doesn't
// pretend otherwise; wiring it to real Mobile Money collection later only
// means swapping what this button does, not how the section looks.
export default function SupportArtistSection({
  t,
  locale,
  whatsappNumber,
  accent,
  textColor,
  buttonStyle,
  radiusClass,
  borderTint,
}: {
  t: Translations;
  locale: "en" | "fr";
  whatsappNumber: string;
  accent: string;
  textColor: string;
  buttonStyle: CSSProperties;
  radiusClass: string;
  borderTint: string;
}) {
  const [amount, setAmount] = useState<number | "custom">(1000);
  const [customAmount, setCustomAmount] = useState("");

  const finalAmount = amount === "custom" ? Number(customAmount) || 0 : amount;
  const canSend = finalAmount > 0;

  const cleanNumber = whatsappNumber.replace(/[^0-9]/g, "");
  const href = canSend
    ? `https://wa.me/${cleanNumber}?text=${encodeURIComponent(
        t.music.supportWhatsappMessage(formatPrice(finalAmount, "XAF", locale))
      )}`
    : undefined;

  return (
    <div
      id="support"
      className={`scroll-mt-6 p-4 flex flex-col gap-3 ${radiusClass}`}
      style={{ border: `1px solid ${borderTint}` }}
    >
      <div className="flex items-center gap-2">
        <Heart size={17} style={{ color: accent }} fill={accent} />
        <p className="text-base font-bold">{t.music.supportTitle}</p>
      </div>
      <p className="text-xs" style={{ opacity: 0.65 }}>
        {t.music.supportHint}
      </p>

      <div className="flex flex-wrap gap-2">
        {PRESET_AMOUNTS.map((preset) => (
          <button
            key={preset}
            onClick={() => setAmount(preset)}
            className="text-xs font-medium px-3 py-1.5 rounded-full transition"
            style={
              amount === preset
                ? { backgroundColor: accent, color: "#fff" }
                : { border: `1.5px solid ${borderTint}`, color: textColor }
            }
          >
            {formatPrice(preset, "XAF", locale)}
          </button>
        ))}
        <button
          onClick={() => setAmount("custom")}
          className="text-xs font-medium px-3 py-1.5 rounded-full transition"
          style={
            amount === "custom"
              ? { backgroundColor: accent, color: "#fff" }
              : { border: `1.5px solid ${borderTint}`, color: textColor }
          }
        >
          {t.music.customAmountLabel}
        </button>
      </div>

      {amount === "custom" && (
        <input
          value={customAmount}
          onChange={(e) => setCustomAmount(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder={t.music.customAmountPlaceholder}
          inputMode="numeric"
          className="text-sm px-3.5 py-2.5 rounded-card bg-transparent"
          style={{ border: `1.5px solid ${borderTint}`, color: textColor }}
        />
      )}

      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!canSend}
        onClick={(e) => {
          if (!canSend) e.preventDefault();
        }}
        className={`text-center text-sm font-medium py-2.5 rounded-full transition hover:brightness-95 active:scale-[0.98] ${
          !canSend ? "opacity-40 pointer-events-none" : ""
        }`}
        style={buttonStyle}
      >
        {t.music.sendSupportButton}
      </a>
    </div>
  );
}
