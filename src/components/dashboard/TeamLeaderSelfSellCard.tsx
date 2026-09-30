"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, UserPlus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import AmbassadorCodeEditor from "@/components/dashboard/AmbassadorCodeEditor";

// Team Leader dashboard. A Team Leader normally sends clients to their
// Ambassadors. To register clients themselves — and earn both the Ambassador
// and the Team Leader commission on them — they add their own account as an
// Ambassador (POST /api/ambassador/enable-self; the server derives everything
// from their session). Once active, this shows their own Ambassador code (which
// they can edit, like an affiliate code) and client link (which opens in a new
// tab so it can be tested), distinct from the team's Ambassadors' codes.
export default function TeamLeaderSelfSellCard({ siteUrl, salesCode, profileStatus }: { siteUrl: string; salesCode: string | null; profileStatus: string | null }) {
  const { t } = useLanguage();
  const c = t.ambassadorRequests.selfSell;
  const errors = c.errors as Record<string, string>;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const active = !!salesCode && profileStatus === "active";
  const link = salesCode ? `${siteUrl.replace(/\/$/, "")}/get-started-cards?amb=${salesCode}` : "";

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ambassador/enable-self", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) router.refresh();
      else setError(errors[json.code] || errors.unavailable);
    } catch {
      setError(errors.network);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The link stays visible and clickable.
    }
  }

  return (
    <section className="max-w-5xl mx-auto px-4 pb-6">
      <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface p-4 flex flex-col gap-3">
        {active ? (
          <>
            <div>
              <h2 className="text-sm font-semibold text-ringo-text">{c.activeTitle}</h2>
              <p className="text-xs text-ringo-muted mt-0.5">{c.activeBody}</p>
            </div>
            <AmbassadorCodeEditor code={salesCode as string} />
            <div className="flex flex-col gap-1">
              <p className="text-xs text-ringo-muted">{c.linkLabel}</p>
              <div className="flex items-center gap-2">
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t.ambassadorCode.openLink}
                  className="flex-1 min-w-0 truncate rounded-lg bg-ringo-bg border border-ringo-border/60 px-3 py-2 text-xs text-ringo-indigo hover:underline"
                >
                  {link}
                </a>
                <button type="button" onClick={copyLink} className="shrink-0 text-xs font-medium px-2.5 py-2 rounded-lg border border-ringo-border/60 text-ringo-text flex items-center gap-1">
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? c.copied : c.copy}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <h2 className="text-sm font-semibold text-ringo-text flex items-center gap-2">
                <UserPlus size={15} className="text-ringo-indigo" /> {c.title}
              </h2>
              <p className="text-xs text-ringo-muted mt-0.5">{c.body}</p>
            </div>
            {profileStatus && profileStatus !== "active" ? (
              <p className="text-sm text-red-500">{errors.profile_inactive}</p>
            ) : (
              <button type="button" onClick={enable} disabled={busy} className="self-start text-sm font-medium px-3 py-2 rounded-lg bg-ringo-indigo text-white disabled:opacity-60">
                {busy ? c.working : c.cta}
              </button>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
          </>
        )}
      </div>
    </section>
  );
}
