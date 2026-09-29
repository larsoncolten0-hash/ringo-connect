"use client";

import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Shown on the Ambassador and Team Leader dashboards. Approving a client's new
// account is granted per person by an admin (the same switch as super creators);
// this card only reflects that state and links to the existing review screen,
// where the SERVER enforces every rule (own clients only, online payment
// confirmed, the plan the client paid for, no cash option, no delete/reject).
export default function ClientRequestsCard({ granted, pendingCount }: { granted: boolean; pendingCount: number }) {
  const { t } = useLanguage();
  const c = t.ambassadorRequests;
  return (
    <section className="max-w-5xl mx-auto px-4 pb-6">
      <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface p-4 flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ringo-text flex items-center gap-2">
          <ClipboardCheck size={15} className="text-ringo-indigo" /> {c.cardTitle}
        </h2>
        {granted ? (
          <>
            <p className="text-xs text-ringo-muted">{c.cardBody}</p>
            <p className="text-sm text-ringo-text">{pendingCount > 0 ? c.pending(pendingCount) : c.nonePending}</p>
            <Link href="/dashboard/requests" className="self-start text-sm font-medium px-3 py-2 rounded-lg bg-ringo-indigo text-white">
              {c.open}
            </Link>
          </>
        ) : (
          <p className="text-sm text-ringo-muted">{c.notGranted}</p>
        )}
      </div>
    </section>
  );
}
