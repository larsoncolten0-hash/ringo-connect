"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Handshake, Music2, ShoppingBag, ShieldCheck, Check, AlertTriangle, Clock } from "lucide-react";
import type { AffiliateSettings } from "@/lib/affiliateSettings";
import type { MusicPayoutSettings } from "@/lib/musicPayoutSettings";
import type { ShopPayoutSettings } from "@/lib/shopPayoutSettings";
import type { ProtectionSettings } from "@/lib/protectionSettings";
import type { SubscriptionReminderSettings } from "@/lib/subscriptionReminderSettings";

// One category = one self-contained card, each saving to its own settings
// route independently — see the page file's comment for how a future
// category's card gets added here.
function CategoryCard({
  icon: Icon,
  title,
  subtitle,
  enabledToggle,
  fields,
  onSave,
}: {
  icon: any;
  title: string;
  subtitle: string;
  enabledToggle?: { checked: boolean; onChange: (v: boolean) => void; label: string };
  // `value`/`onChange` accept null so a field can mean "not configured yet" (shown as an empty
  // input) rather than being forced to a misleading 0 — used by Protection's fee rate, which must
  // never silently default to a guessed percentage.
  fields: { label: string; value: number | null; onChange: (v: number | null) => void; step?: number; suffix?: string; placeholder?: string }[];
  onSave: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    const result = await onSave();
    setSaving(false);
    if (!result.ok) {
      setError(result.error || "Could not save.");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-xl bg-ringo-indigo/10 flex items-center justify-center shrink-0">
          <Icon size={15} className="text-ringo-indigo" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-ringo-text">{title}</h2>
          <p className="text-xs text-ringo-muted mt-0.5">{subtitle}</p>
        </div>
      </div>

      {enabledToggle && (
        <label className="flex items-center justify-between">
          <p className="text-sm text-ringo-text">{enabledToggle.label}</p>
          <button
            onClick={() => enabledToggle.onChange(!enabledToggle.checked)}
            role="switch"
            aria-checked={enabledToggle.checked}
            className={`w-10 h-6 rounded-full relative border transition-colors ${
              enabledToggle.checked ? "bg-ringo-teal border-ringo-teal" : "bg-slate-700 border-slate-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                enabledToggle.checked ? "translate-x-[18px]" : ""
              }`}
            />
          </button>
        </label>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {fields.map((f) => (
          <label key={f.label} className="flex flex-col gap-1">
            <span className="text-xs text-ringo-muted">{f.label}</span>
            <div className="relative">
              <input
                type="number"
                min={0}
                step={f.step ?? 1}
                value={f.value ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => f.onChange(e.target.value === "" ? null : Number(e.target.value))}
                className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
              />
              {f.suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ringo-muted">{f.suffix}</span>}
            </div>
          </label>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-500 flex items-center gap-1.5">
          <AlertTriangle size={14} />
          {error}
        </p>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="self-start flex items-center gap-1.5 px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium disabled:opacity-50 hover:brightness-110 transition"
      >
        {saved && <Check size={14} />}
        {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
      </button>
    </div>
  );
}

export default function AdminPriceControlsView({
  initialAffiliateSettings,
  initialMusicSettings,
  initialShopSettings,
  initialProtectionSettings,
  initialSubscriptionReminderSettings,
}: {
  initialAffiliateSettings: AffiliateSettings;
  initialMusicSettings: MusicPayoutSettings;
  initialShopSettings: ShopPayoutSettings;
  initialProtectionSettings: ProtectionSettings;
  initialSubscriptionReminderSettings: SubscriptionReminderSettings;
}) {
  const router = useRouter();

  const [affiliate, setAffiliate] = useState({
    affiliateEnabled: initialAffiliateSettings.affiliateEnabled,
    affiliateCommissionRatePct: Math.round(initialAffiliateSettings.affiliateCommissionRate * 10000) / 100,
    affiliateHoldDays: initialAffiliateSettings.affiliateHoldDays,
    affiliateMinPayoutXaf: initialAffiliateSettings.affiliateMinPayoutXaf,
    affiliateMinPayoutUsd: initialAffiliateSettings.affiliateMinPayoutUsd,
  });

  const [music, setMusic] = useState({
    musicCommissionRatePct: Math.round(initialMusicSettings.musicCommissionRate * 10000) / 100,
    musicPayoutHoldDays: initialMusicSettings.musicPayoutHoldDays,
    musicMinPayoutXaf: initialMusicSettings.musicMinPayoutXaf,
  });

  const saveAffiliate = async () => {
    const res = await fetch("/api/admin/affiliate/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(affiliate),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) router.refresh();
    return { ok: res.ok, error: data.error };
  };

  const saveMusic = async () => {
    const res = await fetch("/api/admin/music/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(music),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) router.refresh();
    return { ok: res.ok, error: data.error };
  };

  const [shop, setShop] = useState({
    commercePayoutHoldDays: initialShopSettings.commercePayoutHoldDays,
    commerceMinPayoutXaf: initialShopSettings.commerceMinPayoutXaf,
  });

  const saveShop = async () => {
    const res = await fetch("/api/admin/shop/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shop),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) router.refresh();
    return { ok: res.ok, error: data.error };
  };

  const [protection, setProtection] = useState({
    protectionEnabled: initialProtectionSettings.protectionEnabled,
    protectionFeeRatePct:
      initialProtectionSettings.protectionFeeRate != null ? Math.round(initialProtectionSettings.protectionFeeRate * 10000) / 100 : null,
    protectionAutoReleaseHours: initialProtectionSettings.protectionAutoReleaseHours,
  });

  const saveProtection = async () => {
    const res = await fetch("/api/admin/protection/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(protection),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) router.refresh();
    return { ok: res.ok, error: data.error };
  };

  const [subscriptionReminders, setSubscriptionReminders] = useState({
    gracePeriodDays: initialSubscriptionReminderSettings.gracePeriodDays,
    expiringSoonReminderDays: initialSubscriptionReminderSettings.expiringSoonReminderDays,
    graceEndingReminderDays: initialSubscriptionReminderSettings.graceEndingReminderDays,
  });

  const saveSubscriptionReminders = async () => {
    const res = await fetch("/api/admin/subscription-reminders/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscriptionReminders),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) router.refresh();
    return { ok: res.ok, error: data.error };
  };

  return (
    <div className="max-w-3xl flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text tracking-[-0.01em]">Price Controls</h1>
        <p className="text-sm text-ringo-muted mt-1">
          Commission/fee rates, payout hold periods, and minimum payout amounts — one card per category. Referral and
          sale requests themselves are still processed on their own pages (Affiliates, Music payouts); this is only
          where the numbers behind them are set.
        </p>
      </div>

      <CategoryCard
        icon={Handshake}
        title="Affiliate Program"
        subtitle="Commission paid to affiliates for referred creators who subscribe."
        enabledToggle={{
          checked: affiliate.affiliateEnabled,
          onChange: (v) => setAffiliate((s) => ({ ...s, affiliateEnabled: v })),
          label: "Program enabled",
        }}
        fields={[
          {
            label: "Commission rate",
            value: affiliate.affiliateCommissionRatePct,
            onChange: (v) => setAffiliate((s) => ({ ...s, affiliateCommissionRatePct: v ?? 0 })),
            step: 0.5,
            suffix: "%",
          },
          {
            label: "Hold period before payable",
            value: affiliate.affiliateHoldDays,
            onChange: (v) => setAffiliate((s) => ({ ...s, affiliateHoldDays: v ?? 0 })),
            suffix: "days",
          },
          {
            label: "Minimum payout — XAF",
            value: affiliate.affiliateMinPayoutXaf,
            onChange: (v) => setAffiliate((s) => ({ ...s, affiliateMinPayoutXaf: v ?? 0 })),
          },
          {
            label: "Minimum payout — USD",
            value: affiliate.affiliateMinPayoutUsd,
            onChange: (v) => setAffiliate((s) => ({ ...s, affiliateMinPayoutUsd: v ?? 0 })),
          },
        ]}
        onSave={saveAffiliate}
      />

      <CategoryCard
        icon={Music2}
        title="Music Sales"
        subtitle="Ringo Connect's share of Mobile Money music sales it collects automatically. Cash/card sales the artist confirms themselves are never affected — Ringo never touches that money."
        fields={[
          {
            label: "Platform fee",
            value: music.musicCommissionRatePct,
            onChange: (v) => setMusic((s) => ({ ...s, musicCommissionRatePct: v ?? 0 })),
            step: 0.5,
            suffix: "%",
          },
          {
            label: "Hold period before payable",
            value: music.musicPayoutHoldDays,
            onChange: (v) => setMusic((s) => ({ ...s, musicPayoutHoldDays: v ?? 0 })),
            suffix: "days",
          },
          {
            label: "Minimum payout — XAF",
            value: music.musicMinPayoutXaf,
            onChange: (v) => setMusic((s) => ({ ...s, musicMinPayoutXaf: v ?? 0 })),
          },
        ]}
        onSave={saveMusic}
      />

      <CategoryCard
        icon={ShoppingBag}
        title="Shop Sales"
        subtitle="Payout hold period and minimum for Shop product order earnings. The commission rate itself is set on the Commerce / Shop section of Admin Settings, not here."
        fields={[
          {
            label: "Hold period before payable",
            value: shop.commercePayoutHoldDays,
            onChange: (v) => setShop((s) => ({ ...s, commercePayoutHoldDays: v ?? 0 })),
            suffix: "days",
          },
          {
            label: "Minimum payout — XAF",
            value: shop.commerceMinPayoutXaf,
            onChange: (v) => setShop((s) => ({ ...s, commerceMinPayoutXaf: v ?? 0 })),
          },
        ]}
        onSave={saveShop}
      />

      <CategoryCard
        icon={ShieldCheck}
        title="Ringo Protection"
        subtitle="Optional buyer-protection payment mode (foundation only — not yet enabled for checkout). This card only controls the configuration new protected transactions will snapshot once the feature is activated in a later increment."
        enabledToggle={{
          checked: protection.protectionEnabled,
          onChange: (v) => setProtection((s) => ({ ...s, protectionEnabled: v })),
          label: "Ringo Protection enabled",
        }}
        fields={[
          {
            label: "Protection fee",
            value: protection.protectionFeeRatePct,
            onChange: (v) => setProtection((s) => ({ ...s, protectionFeeRatePct: v })),
            step: 0.25,
            suffix: "%",
            placeholder: "Not set",
          },
          {
            label: "Auto-release period",
            value: protection.protectionAutoReleaseHours,
            onChange: (v) => setProtection((s) => ({ ...s, protectionAutoReleaseHours: v ?? 0 })),
            suffix: "hours",
          },
        ]}
        onSave={saveProtection}
      />

      <CategoryCard
        icon={Clock}
        title="Subscription Expiry Reminders"
        subtitle="Fapshi/manual (fixed-duration) accounts only — a Stripe subscription renews itself and never reaches this. Reminders fire push + email + in-app, exactly once per billing cycle."
        fields={[
          {
            label: '"Expiring soon" reminder',
            value: subscriptionReminders.expiringSoonReminderDays,
            onChange: (v) => setSubscriptionReminders((s) => ({ ...s, expiringSoonReminderDays: v ?? 0 })),
            suffix: "days before",
          },
          {
            label: "Grace period",
            value: subscriptionReminders.gracePeriodDays,
            onChange: (v) => setSubscriptionReminders((s) => ({ ...s, gracePeriodDays: v ?? 0 })),
            suffix: "days after expiry",
          },
          {
            label: '"Grace ending" reminder',
            value: subscriptionReminders.graceEndingReminderDays,
            onChange: (v) => setSubscriptionReminders((s) => ({ ...s, graceEndingReminderDays: v ?? 0 })),
            suffix: "days before grace ends",
          },
        ]}
        onSave={saveSubscriptionReminders}
      />
    </div>
  );
}
