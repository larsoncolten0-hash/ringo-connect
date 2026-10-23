"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookOpenCheck } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { churchErrorText } from "../../lifecycle/errorText";
import { BTN_PRIMARY, BTN_SECONDARY, EmptyState, ErrorLine, ListSkeleton, churchApi } from "../../people/shared";

interface Journey {
  program: { id: string; title_en: string | null; title_fr: string | null };
  church: { username: string | null; name: string | null };
  joined_at: string;
  total: number;
  done: number;
}

// The visitor's own Bible programmes and how far along they are. Signed out, it only asks them to sign in. Everything is read from /api/customer/bible, which knows the visitor from their cookie.
export default function JourneyList({ signedIn }: { signedIn: boolean }) {
  const { t, locale } = useLanguage();
  const lang = locale === "fr" ? "fr" : "en";
  const c = t.churchBible.journey;
  const [items, setItems] = useState<Journey[] | null>(null);
  const [loading, setLoading] = useState(signedIn);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!signedIn) return;
    setLoading(true);
    setError("");
    const r = await churchApi<{ journeys: Journey[] }>("/api/customer/bible");
    setLoading(false);
    if (r.ok) setItems(r.body.journeys);
    else setError(churchErrorText(t, r.code));
  }, [signedIn, t]);
  useEffect(() => {
    load();
  }, [load]);

  if (!signedIn) {
    return (
      <div className="rounded-3xl border border-ringo-border bg-ringo-surface p-5">
        <h2 className="font-display text-base font-semibold">{c.signInTitle}</h2>
        <p className="mt-1 text-sm leading-relaxed text-ringo-muted">{c.signInBody}</p>
        <Link href="/my-ringo/signin" className={`${BTN_PRIMARY} mt-4`}>
          {c.signIn}
        </Link>
      </div>
    );
  }
  if (loading && !items) return <ListSkeleton rows={3} />;
  if (error) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
        <ErrorLine message={`${c.loadError} ${error}`} />
        <button type="button" className={BTN_SECONDARY} onClick={load}>
          {c.retry}
        </button>
      </div>
    );
  }
  if (!items || items.length === 0) return <EmptyState icon={<BookOpenCheck size={22} />} title={c.listEmptyTitle} body={c.listEmptyBody} />;
  return (
    <div>
      <h2 className="mb-3 font-display text-base font-semibold">{c.listTitle}</h2>
      <ul className="flex flex-col gap-2">
        {items.map((j) => {
          const title = (lang === "fr" ? j.program.title_fr || j.program.title_en : j.program.title_en || j.program.title_fr) || "";
          const percent = j.total > 0 ? Math.round((j.done / j.total) * 100) : 0;
          return (
            <li key={j.program.id}>
              <Link
                href={`/my-ringo/journey/${j.program.id}`}
                aria-label={c.open(title)}
                className="ringo-tactile flex min-h-[72px] flex-col gap-2 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-4 py-3 hover:border-ringo-indigo/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">{title}</span>
                  {j.church.name && <span className="text-xs text-ringo-muted">{c.by(j.church.name)}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ringo-muted/20" aria-hidden="true">
                    <span className="block h-full rounded-full bg-ringo-indigo" style={{ width: `${percent}%` }} />
                  </span>
                  <span className="shrink-0 text-xs text-ringo-muted">{c.progress(j.done, j.total)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
