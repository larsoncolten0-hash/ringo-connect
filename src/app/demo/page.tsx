"use client";

import { useState } from "react";
import AuthShell from "@/components/auth/AuthShell";
import FormBanner from "@/components/auth/FormBanner";
import SubmitButton from "@/components/auth/SubmitButton";
import CategoryPicker from "@/components/CategoryPicker";
import { useLanguage } from "@/components/LanguageProvider";
import type { CategoryId } from "@/lib/categories";

// "Try the dashboard" — a single public link that drops a visitor straight
// into a real, fully working Business Pro dashboard with zero signup
// friction. See src/app/api/demo/create/route.ts for what actually happens
// on submit (a fresh anonymous auth account, flagged is_demo, expiring in
// 7 days). The only choice a visitor makes here is which category best
// fits what they want to explore — "Restaurant & Food" is pre-selected
// (the most fully-built category) so clicking straight through works too.
export default function DemoPage() {
  const { t, locale } = useLanguage();
  const [category, setCategory] = useState<CategoryId>("restaurant_food");
  const [extraCategories, setExtraCategories] = useState<CategoryId[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<"rate_limited" | "generic" | "">("");

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/demo/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, locale }),
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
    </AuthShell>
  );
}
