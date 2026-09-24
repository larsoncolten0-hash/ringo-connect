"use client";

import { useId, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import {
  CTA_LABEL_MAX_LENGTH,
  getRecommendedCta,
  isCtaPresetId,
  normalizeCtaLabel,
  resolveProductCta,
  type CtaPresetId,
} from "@/lib/cta";

// The "Customer action" row inside a catalogue item's editor. Shows the
// button as it appears today, and lets the creator explicitly switch to the
// recommended wording, another wording for the same kind of action, or their
// own text. It only ever edits wording (cta_preset / cta_label) — never what
// the button does. Nothing is chosen until the creator picks it.
export default function CustomerActionField({
  category,
  isMusic,
  hasLandingUrl,
  bookingEnabled,
  restaurantOrdering,
  preset,
  label,
  onChange,
}: {
  category: string | null | undefined;
  isMusic: boolean;
  hasLandingUrl: boolean;
  bookingEnabled: boolean;
  restaurantOrdering: boolean;
  preset: string | null | undefined;
  label: string | null | undefined;
  onChange: (patch: { cta_preset: string | null; cta_label: string | null }) => void;
}) {
  const { t } = useLanguage();
  const groupName = useId();
  const [open, setOpen] = useState(false);
  const [customMode, setCustomMode] = useState(!!normalizeCtaLabel(label));

  const { recommended, alternatives } = getRecommendedCta(category);
  const activePreset: CtaPresetId | null = !customMode && isCtaPresetId(preset) ? preset : null;
  // A saved preset from before the category changed stays selectable.
  const options = activePreset && !alternatives.includes(activePreset) ? [...alternatives, activePreset] : alternatives;

  const resolved = resolveProductCta({
    category,
    isMusic,
    hasLandingUrl,
    bookingEnabled,
    restaurantOrdering,
    ctaPreset: preset,
    ctaLabel: label,
  });
  const currentText =
    resolved.label?.kind === "custom"
      ? resolved.label.text
      : resolved.label?.kind === "preset"
      ? t.cta.labels[resolved.label.id]
      : t.cta.currentDefault;

  const pickDefault = () => {
    setCustomMode(false);
    onChange({ cta_preset: null, cta_label: null });
  };
  const pickPreset = (id: CtaPresetId) => {
    setCustomMode(false);
    onChange({ cta_preset: id, cta_label: null });
  };
  const pickCustom = () => {
    setCustomMode(true);
    onChange({ cta_preset: null, cta_label: label ?? "" });
  };

  const radio = "flex min-h-[44px] items-center gap-2 rounded-card px-2 py-1.5 text-sm text-ringo-text cursor-pointer";

  return (
    <div className="rounded-card border border-ringo-border bg-ringo-surface p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-ringo-muted">{t.cta.sectionTitle}</p>
          <p className="text-sm font-medium text-ringo-text break-words">{currentText}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 min-h-[36px] rounded-card border border-ringo-border px-3 text-xs font-medium text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors"
        >
          {open ? t.cta.done : t.cta.change}
        </button>
      </div>

      {open && (
        <div className="mt-2 flex flex-col">
          <label className={radio}>
            <input type="radio" name={groupName} checked={!customMode && !activePreset} onChange={pickDefault} className="accent-ringo-indigo" />
            <span className="min-w-0">
              <span className="block">{t.cta.keepDefaultTitle}</span>
              <span className="block text-xs text-ringo-muted">{t.cta.keepDefaultHint}</span>
            </span>
          </label>
          {options.map((id) => (
            <label key={id} className={radio}>
              <input type="radio" name={groupName} checked={activePreset === id} onChange={() => pickPreset(id)} className="accent-ringo-indigo" />
              <span className="min-w-0 flex-1 break-words">{t.cta.labels[id]}</span>
              {id === recommended && (
                <span className="shrink-0 rounded-full bg-ringo-indigo/10 px-2 py-0.5 text-[11px] font-medium text-ringo-indigo">
                  {t.cta.recommendedBadge}
                </span>
              )}
            </label>
          ))}
          <label className={radio}>
            <input type="radio" name={groupName} checked={customMode} onChange={pickCustom} className="accent-ringo-indigo" />
            <span>{t.cta.customOption}</span>
          </label>
          {customMode && (
            <div className="px-2 pb-1">
              <input
                value={label ?? ""}
                onChange={(e) => onChange({ cta_preset: null, cta_label: e.target.value.slice(0, CTA_LABEL_MAX_LENGTH) })}
                placeholder={t.cta.customPlaceholder}
                maxLength={CTA_LABEL_MAX_LENGTH}
                className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text"
              />
              <p className="mt-1 text-xs text-ringo-muted">{t.cta.customHint}</p>
            </div>
          )}
        </div>
      )}

      {resolved.label && resolved.destination === "none" && (
        <p className="mt-2 text-xs text-ringo-muted">{t.cta.noDestinationHint}</p>
      )}
    </div>
  );
}
