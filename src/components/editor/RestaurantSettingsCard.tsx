"use client";

import { useState } from "react";
import { UtensilsCrossed, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { RESTAURANT_SUBCATEGORIES, getCategory, type RestaurantSubcategory } from "@/lib/categories";
import EditorCard from "./EditorCard";
import SavedPulse, { useSavedPulse } from "./SavedPulse";
import { useEditorPreview } from "./EditorPreviewContext";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Day = (typeof DAYS)[number];
type DayHours = { open: string; close: string; closed: boolean };
type OpeningHours = Partial<Record<Day, DayHours>>;

const DEFAULT_DAY: DayHours = { open: "08:00", close: "22:00", closed: false };

// Only ever rendered for a profile tagged Restaurant & Food (see
// Editor.tsx). Subcategory is purely cosmetic (retitles the category badge
// on the public page); everything else here — ordering toggle, order
// types, delivery fee, opening hours — is read by the public page and by
// /api/orders (order type validity, "currently closed").
export default function RestaurantSettingsCard({
  profileId,
  initialSubcategory,
  initialOrderingEnabled,
  initialDineIn,
  initialTakeaway,
  initialDelivery,
  initialDeliveryFee,
  initialOpeningHours,
}: {
  profileId: string;
  initialSubcategory: string | null;
  initialOrderingEnabled: boolean;
  initialDineIn: boolean;
  initialTakeaway: boolean;
  initialDelivery: boolean;
  initialDeliveryFee: number | null;
  initialOpeningHours: OpeningHours | null;
}) {
  const supabase = createClient();
  const { t, locale } = useLanguage();
  const [subcategory, setSubcategory] = useState<RestaurantSubcategory | null>(
    (initialSubcategory as RestaurantSubcategory) || null
  );
  const [orderingEnabled, setOrderingEnabled] = useState(initialOrderingEnabled);
  const [dineIn, setDineIn] = useState(initialDineIn);
  const [takeaway, setTakeaway] = useState(initialTakeaway);
  const [delivery, setDelivery] = useState(initialDelivery);
  const [deliveryFee, setDeliveryFee] = useState(String(initialDeliveryFee ?? 0));
  const [hours, setHours] = useState<OpeningHours>(initialOpeningHours || {});
  const [applyingTheme, setApplyingTheme] = useState(false);
  const pulse = useSavedPulse();
  const { updateDraft } = useEditorPreview();

  const persist = async (patch: Record<string, any>) => {
    updateDraft(patch);
    await supabase.from("profiles").update(patch).eq("id", profileId);
    pulse.show();
  };

  const applyRecommendedTheme = async () => {
    const theme = getCategory("restaurant_food")?.defaults.recommendedTheme;
    if (!theme) return;
    setApplyingTheme(true);
    const patch = {
      theme_color: theme.themeColor,
      background_style: theme.backgroundStyle,
      background_color: theme.backgroundColor,
      background_gradient_end: theme.backgroundGradientEnd,
      text_color: theme.textColor,
      button_style: theme.buttonStyle,
      button_radius: theme.buttonRadius,
    };
    await supabase.from("profiles").update(patch).eq("id", profileId);
    // Same reasoning as MusicSettingsCard's identical button: ThemeCard
    // seeds its own state once at mount, so a reload is what actually
    // makes its controls reflect what was just applied.
    updateDraft(patch);
    window.location.reload();
  };

  const dayLabel = (d: Day) =>
    ({ mon: t.restaurant.dayMon, tue: t.restaurant.dayTue, wed: t.restaurant.dayWed, thu: t.restaurant.dayThu, fri: t.restaurant.dayFri, sat: t.restaurant.daySat, sun: t.restaurant.daySun }[d]);

  const updateDay = (day: Day, patch: Partial<DayHours>) => {
    const next = { ...hours, [day]: { ...(hours[day] || DEFAULT_DAY), ...patch } };
    setHours(next);
    persist({ opening_hours: next });
  };

  return (
    <EditorCard
      icon={UtensilsCrossed}
      title={t.restaurant.settingsTitle}
      action={<SavedPulse visible={pulse.visible} label={t.editor.saved} />}
    >
      <p className="text-xs text-ringo-muted -mt-1 mb-4">{t.restaurant.settingsHint}</p>

      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium text-ringo-text mb-2">{t.restaurant.subcategoryLabel}</p>
          <div className="flex flex-wrap gap-1.5">
            {RESTAURANT_SUBCATEGORIES.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSubcategory(s.id);
                  persist({ restaurant_subcategory: s.id });
                }}
                className={`text-xs px-2.5 py-1.5 rounded-full border transition ${
                  subcategory === s.id
                    ? "border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo font-medium"
                    : "border-ringo-border text-ringo-muted"
                }`}
              >
                {s.emoji} {s.label[locale]}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-card border border-ringo-border p-3 cursor-pointer">
          <span>
            <span className="block text-sm font-medium text-ringo-text">{t.restaurant.orderingEnabledLabel}</span>
            <span className="block text-xs text-ringo-muted mt-0.5">{t.restaurant.orderingEnabledHint}</span>
          </span>
          <input
            type="checkbox"
            checked={orderingEnabled}
            onChange={(e) => {
              setOrderingEnabled(e.target.checked);
              persist({ ordering_enabled: e.target.checked });
            }}
            className="accent-ringo-indigo shrink-0"
          />
        </label>

        <div>
          <p className="text-xs font-medium text-ringo-text mb-2">{t.restaurant.orderTypesLabel}</p>
          <div className="flex flex-wrap gap-3">
            {[
              { key: "dine_in", checked: dineIn, set: setDineIn, label: t.restaurant.dineInLabel },
              { key: "takeaway", checked: takeaway, set: setTakeaway, label: t.restaurant.takeawayLabel },
              { key: "delivery", checked: delivery, set: setDelivery, label: t.restaurant.deliveryLabel },
            ].map((o) => (
              <label key={o.key} className="flex items-center gap-1.5 text-sm text-ringo-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={o.checked}
                  onChange={(e) => {
                    o.set(e.target.checked);
                    persist({ [`${o.key}_enabled`]: e.target.checked });
                  }}
                  className="accent-ringo-indigo"
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>

        {delivery && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ringo-text">{t.restaurant.deliveryFeeLabel}</span>
            <input
              value={deliveryFee}
              onChange={(e) => setDeliveryFee(e.target.value.replace(/[^0-9.]/g, ""))}
              onBlur={() => persist({ delivery_fee: Number(deliveryFee) || 0 })}
              inputMode="decimal"
              className="w-32 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
            />
          </label>
        )}

        <div>
          <p className="text-xs font-medium text-ringo-text mb-1 flex items-center gap-1.5">
            <Clock size={13} /> {t.restaurant.hoursTitle}
          </p>
          <p className="text-xs text-ringo-muted mb-2">{t.restaurant.hoursHint}</p>
          <div className="flex flex-col gap-2">
            {DAYS.map((day) => {
              const d = hours[day];
              // Unset (a brand-new restaurant that hasn't touched this day
              // yet) defaults to open with the standard hours, not closed
              // — most restaurants are open more days than not, so this
              // is less clicking for the common case.
              const closed = d?.closed ?? false;
              return (
                <div key={day} className="flex items-center gap-2 text-sm">
                  <span className="w-24 shrink-0 text-ringo-text">{dayLabel(day)}</span>
                  <label className="flex items-center gap-1.5 text-xs text-ringo-muted shrink-0">
                    <input
                      type="checkbox"
                      checked={!closed}
                      onChange={(e) => updateDay(day, { closed: !e.target.checked, open: d?.open || DEFAULT_DAY.open, close: d?.close || DEFAULT_DAY.close })}
                      className="accent-ringo-indigo"
                    />
                    {t.restaurant.closedToggle}
                  </label>
                  {!closed && (
                    <>
                      <input
                        type="time"
                        value={d?.open || DEFAULT_DAY.open}
                        onChange={(e) => updateDay(day, { open: e.target.value })}
                        className="border border-ringo-border rounded-card px-2 py-1 text-xs bg-ringo-surface text-ringo-text"
                      />
                      <span className="text-ringo-muted">–</span>
                      <input
                        type="time"
                        value={d?.close || DEFAULT_DAY.close}
                        onChange={(e) => updateDay(day, { close: e.target.value })}
                        className="border border-ringo-border rounded-card px-2 py-1 text-xs bg-ringo-surface text-ringo-text"
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-card border border-dashed border-ringo-border p-3.5">
          <p className="text-sm font-medium text-ringo-text">{t.restaurant.recommendedThemeNudge}</p>
          <p className="text-xs text-ringo-muted mt-1">{t.restaurant.applyThemeHint}</p>
          <button
            onClick={applyRecommendedTheme}
            disabled={applyingTheme}
            className="text-xs font-medium text-ringo-indigo mt-2.5 disabled:opacity-50"
          >
            {applyingTheme ? t.restaurant.applyingTheme : t.restaurant.applyTheme}
          </button>
        </div>
      </div>
    </EditorCard>
  );
}
