"use client";

import { AlertTriangle } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { AiDenyReason } from "@/lib/ai/codes";

export default function ContentCalendarUnavailable({ reason }: { reason: AiDenyReason }) {
  const { t } = useLanguage();
  return (
    <div className="max-w-lg mx-auto mt-16 flex flex-col items-center gap-3 text-center px-4">
      <span className="w-12 h-12 rounded-2xl bg-ringo-coral/10 text-ringo-coral flex items-center justify-center">
        <AlertTriangle size={20} />
      </span>
      <p className="text-sm text-ringo-muted">{t.ringoAi.errors[reason] ?? t.ringoAi.errors.internal}</p>
    </div>
  );
}
