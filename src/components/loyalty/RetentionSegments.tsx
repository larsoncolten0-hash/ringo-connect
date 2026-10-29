"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { api, fmtNumber } from "@/components/loyalty/format";

// The four customer segments as COUNTS. A business is never given names by segment.
type Counts = { new: number; returning: number; vip: number; inactive: number; total: number };
const KEYS = ["new", "returning", "vip", "inactive"] as const;

export default function RetentionSegments({ isChurch }: { isChurch: boolean }) {
  const { t, locale } = useLanguage();
  const s = t.loyalty.retention.segments;
  const [counts, setCounts] = useState<Counts | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ counts?: Counts }>("/api/loyalty/segments").then((r) => {
      if (!alive) return;
      if (r.status === 200 && r.data?.counts) setCounts(r.data.counts);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
      <h2 className="text-base font-semibold text-ringo-text">{s.title}</h2>
      <p className="mt-1 text-sm text-ringo-muted">{s.intro}</p>
      {failed ? (
        <p className="mt-3 text-sm text-red-500">{s.unavailable}</p>
      ) : counts === null ? (
        <p className="mt-3 text-sm text-ringo-muted">{s.loading}</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-ringo-text">
            {s.total}: <span className="font-semibold">{fmtNumber(counts.total, locale)}</span>
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {KEYS.map((k) => (
              <div key={k} className="rounded-xl border border-ringo-border/60 p-3">
                <p className="text-xs font-medium text-ringo-muted">{s[k]}</p>
                <p className="mt-1 text-2xl font-semibold text-ringo-text">{fmtNumber(counts[k], locale)}</p>
                <p className="mt-1 text-xs text-ringo-muted">{s[`${k}Help` as const]}</p>
              </div>
            ))}
          </div>
        </>
      )}
      {isChurch && <p className="mt-3 text-xs text-ringo-muted">{s.churchNote}</p>}
    </section>
  );
}
