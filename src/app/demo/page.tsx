"use client";

import { useState } from "react";
import { Building2, Award } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import FormBanner from "@/components/auth/FormBanner";
import SubmitButton from "@/components/auth/SubmitButton";
import CategoryPicker from "@/components/CategoryPicker";
import { useLanguage } from "@/components/LanguageProvider";
import type { CategoryId } from "@/lib/categories";

type Track = "business" | "association" | null;

// "Try the dashboard" — a single public link that drops a visitor straight
// into a real, fully working demo account with zero signup friction. See
// src/app/api/demo/create/route.ts for what actually happens on submit (a
// fresh anonymous auth account, flagged is_demo, expiring in 7 days).
//
// Two tracks now, chosen first: the original Business dashboard (category
// picker, unchanged) or the Association Program (plan-gated, no category
// needed — pre-seeded with sample Partners/Members/activity so it's
// immediately meaningful, see src/lib/association/demoSeed.ts).
export default function DemoPage() {
  const { t, locale } = useLanguage();
  const [track, setTrack] = useState<Track>(null);
  const [category, setCategory] = useState<CategoryId>("restaurant_food");
  const [extraCategories, setExtraCategories] = useState<CategoryId[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<"rate_limited" | "generic" | "">("");

  const startDemo = async (chosenTrack: "business" | "association") => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/demo/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track: chosenTrack, category: chosenTrack === "business" ? category : undefined, locale }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.code === "rate_limited" ? "rate_limited" : "generic");
        setLoading(false);
        return;
      }
      // Full navigation, not router.push — the dashboard layout is a
      // Server Component that reads the session from cookies on first
      // render, and this is the simplest way to guarantee the just-set
      // anonymous session cookie is present for that request.
      window.location.href = "/dashboard";
    } catch {
      setError("generic");
      setLoading(false);
    }
  };

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    startDemo("business");
  };

  if (track === null) {
    return (
      <AuthShell eyebrow={t.demo.continueButton} title={t.demo.trackPickerTitle} subtitle={t.demo.trackPickerSubtitle}>
        {error && <FormBanner type="error">{error === "rate_limited" ? t.demo.rateLimited : t.demo.genericError}</FormBanner>}
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setTrack("business")}
            className="text-left rounded-card border border-ringo-border bg-ringo-surface p-5 transition hover:border-ringo-indigo active:scale-[0.98] flex items-start gap-3.5"
          >
            <span className="w-10 h-10 rounded-full bg-ringo-indigo/10 flex items-center justify-center shrink-0">
              <Building2 size={18} className="text-ringo-indigo" />
            </span>
            <span>
              <span className="block font-display text-base font-bold mb-1">{t.demo.trackBusinessLabel}</span>
              <span className="block text-sm text-ringo-muted">{t.demo.trackBusinessDesc}</span>
            </span>
          </button>

          <button
            onClick={() => setTrack("association")}
            className="text-left rounded-card border border-ringo-border bg-ringo-surface p-5 transition hover:border-ringo-indigo active:scale-[0.98] flex items-start gap-3.5"
          >
            <span className="w-10 h-10 rounded-full bg-ringo-indigo/10 flex items-center justify-center shrink-0">
              <Award size={18} className="text-ringo-indigo" />
            </span>
            <span>
              <span className="block font-display text-base font-bold mb-1">{t.demo.trackAssociationLabel}</span>
              <span className="block text-sm text-ringo-muted">{t.demo.trackAssociationDesc}</span>
            </span>
          </button>
        </div>
      </AuthShell>
    );
  }

  if (track === "association") {
    return (
      <AuthShell eyebrow={t.demo.continueButton} title={t.demo.trackAssociationLabel} subtitle={t.demo.associationReadySubtitle}>
        {error && <FormBanner type="error">{error === "rate_limited" ? t.demo.rateLimited : t.demo.genericError}</FormBanner>}
        <button
          onClick={() => startDemo("association")}
          disabled={loading}
          className="w-full flex items-center justify-center rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5 disabled:opacity-60"
        >
          {loading ? t.demo.startingMessage : t.demo.continueButton}
        </button>
        <button onClick={() => setTrack(null)} className="w-full text-center text-xs text-ringo-muted hover:text-ringo-text transition mt-3">
          {t.demo.backToTrackPicker}
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell eyebrow={t.demo.continueButton} title={t.demo.pickerTitle} subtitle={t.demo.pickerSubtitle}>
      {error && <FormBanner type="error">{error === "rate_limited" ? t.demo.rateLimited : t.demo.genericError}</FormBanner>}

      <CategoryPicker
        locale={locale}
        primary={category}
        onSelectPrimary={setCategory}
        extra={extraCategories}
        onToggleExtra={(id) =>
          setExtraCategories((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
        }
        strings={{ morePrompt: t.demo.pickerMorePrompt, moreHint: t.demo.pickerMoreHint }}
      />

      <form onSubmit={handleContinue} className="mt-6">
        <SubmitButton loading={loading} loadingText={t.demo.startingMessage}>
          {t.demo.continueButton}
        </SubmitButton>
      </form>
      <button onClick={() => setTrack(null)} className="w-full text-center text-xs text-ringo-muted hover:text-ringo-text transition mt-3">
        {t.demo.backToTrackPicker}
      </button>
    </AuthShell>
  );
}
