"use client";

import { Hourglass } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Shown INSTEAD of the Ambassador dashboard while the account is pending:
// no code, no link, no figures, no requests, no payouts — nothing is active
// until Ringo Management approves the account.
export default function PendingAmbassadorNotice() {
  const { t } = useLanguage();
  const c = t.ambassadorTeamMembers.pendingNotice;
  return (
    <section className="max-w-3xl mx-auto px-4 py-10">
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 flex flex-col gap-2">
        <h1 className="text-base font-semibold text-ringo-text flex items-center gap-2">
          <Hourglass size={16} className="text-amber-600" /> {c.title}
        </h1>
        <p className="text-sm text-ringo-muted">{c.body}</p>
      </div>
    </section>
  );
}
