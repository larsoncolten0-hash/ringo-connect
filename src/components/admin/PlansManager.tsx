"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

export default function PlansManager({ plans }: { plans: any[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(plans);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const updateField = (id: string, field: string, value: any) => {
    setRows((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  // Coerces a possibly-null/possibly-empty-string field to a real number
  // or null, correctly — the previous version only checked for "",
  // which meant an untouched null field (Pro/Business's "unlimited")
  // fell through to Number(null) === 0, silently corrupting unlimited
  // access into zero access on every save that touched ANY other field.
  const toNullableNumber = (v: any) => (v === "" || v === null || v === undefined ? null : Number(v));

  const save = async (plan: any) => {
    setSavingId(plan.id);
    const res = await fetch(`/api/admin/plans/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: plan.display_name,
        max_links: toNullableNumber(plan.max_links),
        max_products: toNullableNumber(plan.max_products),
        pixels_enabled: plan.pixels_enabled,
        custom_theme_enabled: plan.custom_theme_enabled,
        full_analytics_enabled: plan.full_analytics_enabled,
        badge_removed: plan.badge_removed,
        price_usd: Number(plan.price_usd),
        price_xaf: Number(plan.price_xaf),
        price_usd_yearly: Number(plan.price_usd_yearly),
        price_xaf_yearly: Number(plan.price_xaf_yearly),
        features_en: (plan.features_en_text ?? (plan.features_en || []).join("\n"))
          .split("\n")
          .map((f: string) => f.trim())
          .filter(Boolean),
        features_fr: (plan.features_fr_text ?? (plan.features_fr || []).join("\n"))
          .split("\n")
          .map((f: string) => f.trim())
          .filter(Boolean),
      }),
    });
    setSavingId(null);
    if (res.ok) {
      setSavedId(plan.id);
      router.refresh();
      setTimeout(() => setSavedId(null), 1600);
    }
  };

  return (
    <div className="max-w-4xl flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text tracking-[-0.01em]">Plans</h1>
        <p className="text-sm text-ringo-muted mt-1">
          Editing here changes what every creator on this plan sees immediately — including price display. The
          name shown here is editable and purely cosmetic; the code in parentheses (
          <code className="text-xs">free</code>/<code className="text-xs">pro</code>/
          <code className="text-xs">business</code>) is the internal identifier checkout, renewals, and
          translations rely on, and can't be changed here. Note: for Stripe subscribers, changing{" "}
          <code className="text-xs">price_usd</code>/<code className="text-xs">price_usd_yearly</code> here only
          updates the displayed price; the actual amount charged is set by the Stripe Price objects themselves
          (both monthly and yearly Price IDs, in Settings).
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {rows.map((plan) => (
          <div key={plan.id} className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 min-w-0">
                <input
                  value={plan.display_name ?? ""}
                  onChange={(e) => updateField(plan.id, "display_name", e.target.value)}
                  className="text-sm font-medium text-ringo-text bg-transparent border-b border-transparent hover:border-ringo-border focus:border-ringo-indigo focus:outline-none px-0.5 py-0.5 min-w-0"
                  placeholder="Display name"
                />
                <span className="text-xs text-ringo-muted/60 font-mono shrink-0">({plan.name})</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {savedId === plan.id && (
                  <span className="flex items-center gap-1 text-xs text-ringo-teal">
                    <Check size={13} /> Saved
                  </span>
                )}
                <button
                  onClick={() => save(plan)}
                  disabled={savingId === plan.id}
                  className="text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white disabled:opacity-50"
                >
                  {savingId === plan.id ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 mb-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ringo-muted">Max links (blank = unlimited)</span>
                <input
                  value={plan.max_links ?? ""}
                  onChange={(e) => updateField(plan.id, "max_links", e.target.value)}
                  className="border border-ringo-border rounded-card px-2.5 py-1.5 text-sm bg-ringo-bg text-ringo-text"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ringo-muted">Max products (0 = locked)</span>
                <input
                  value={plan.max_products ?? ""}
                  onChange={(e) => updateField(plan.id, "max_products", e.target.value)}
                  className="border border-ringo-border rounded-card px-2.5 py-1.5 text-sm bg-ringo-bg text-ringo-text"
                />
              </label>
            </div>

            <p className="text-xs text-ringo-muted mb-1.5">Monthly pricing</p>
            <div className="grid sm:grid-cols-2 gap-3 mb-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ringo-muted">Price (USD/mo)</span>
                <input
                  value={plan.price_usd}
                  onChange={(e) => updateField(plan.id, "price_usd", e.target.value)}
                  className="border border-ringo-border rounded-card px-2.5 py-1.5 text-sm bg-ringo-bg text-ringo-text"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ringo-muted">Price (XAF/mo)</span>
                <input
                  value={plan.price_xaf}
                  onChange={(e) => updateField(plan.id, "price_xaf", e.target.value)}
                  className="border border-ringo-border rounded-card px-2.5 py-1.5 text-sm bg-ringo-bg text-ringo-text"
                />
              </label>
            </div>

            <p className="text-xs text-ringo-muted mb-1.5">Yearly pricing</p>
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ringo-muted">Price (USD/yr)</span>
                <input
                  value={plan.price_usd_yearly}
                  onChange={(e) => updateField(plan.id, "price_usd_yearly", e.target.value)}
                  className="border border-ringo-border rounded-card px-2.5 py-1.5 text-sm bg-ringo-bg text-ringo-text"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ringo-muted">Price (XAF/yr)</span>
                <input
                  value={plan.price_xaf_yearly}
                  onChange={(e) => updateField(plan.id, "price_xaf_yearly", e.target.value)}
                  className="border border-ringo-border rounded-card px-2.5 py-1.5 text-sm bg-ringo-bg text-ringo-text"
                />
              </label>
            </div>

            <p className="text-xs text-ringo-muted mb-1.5">
              Feature list shown on the creator subscription page — one per line, in each language.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 mb-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ringo-muted">Features (English)</span>
                <textarea
                  value={plan.features_en_text ?? (plan.features_en || []).join("\n")}
                  onChange={(e) => updateField(plan.id, "features_en_text", e.target.value)}
                  rows={5}
                  className="border border-ringo-border rounded-card px-2.5 py-1.5 text-sm bg-ringo-bg text-ringo-text resize-y font-mono"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ringo-muted">Features (Français)</span>
                <textarea
                  value={plan.features_fr_text ?? (plan.features_fr || []).join("\n")}
                  onChange={(e) => updateField(plan.id, "features_fr_text", e.target.value)}
                  rows={5}
                  className="border border-ringo-border rounded-card px-2.5 py-1.5 text-sm bg-ringo-bg text-ringo-text resize-y font-mono"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-4">
              {[
                { key: "pixels_enabled", label: "Tracking pixels" },
                { key: "custom_theme_enabled", label: "Custom theme" },
                { key: "full_analytics_enabled", label: "Full analytics" },
                { key: "badge_removed", label: "Remove badge" },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-sm text-ringo-text">
                  <input
                    type="checkbox"
                    checked={!!plan[key]}
                    onChange={(e) => updateField(plan.id, key, e.target.checked)}
                    className="accent-ringo-indigo"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}