"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { churchErrorText } from "../lifecycle/errorText";
import { BTN_PRIMARY, BTN_SECONDARY, ErrorLine, ListSkeleton, NoticeBar, churchApi, useNotice } from "../people/shared";

interface Row {
  bible_year: boolean;
  counselling: boolean;
  giving: boolean;
  updated_at: string | null;
}

// The church's feature switches. Only the church owner reaches this screen (the server checks again). Everything is off until switched on. Giving is NOT switched here any more: its row only links to the Giving menu,
// where the owner turns it on or off beside the funds. One Save button saves all the switches together, naming the version they were based on.
export default function FeaturesView() {
  const { t } = useLanguage();
  const c = t.churchExpansion.features;
  const [row, setRow] = useState<Row | null>(null);
  const [saved, setSaved] = useState<Row | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    setLoadError("");
    const r = await churchApi<{ item: Row; giving_available: boolean }>("/api/church/features");
    if (!r.ok) return setLoadError(churchErrorText(t, r.code));
    setRow(r.body.item);
    setSaved(r.body.item);
  }, [t]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!row) return;
    setSaving(true);
    setError("");
    const body: Record<string, unknown> = { bible_year: row.bible_year, counselling: row.counselling };
    if (saved?.updated_at) body.expected_updated_at = saved.updated_at;
    const r = await churchApi<{ item: Row }>("/api/church/features", { method: "PUT", body });
    setSaving(false);
    if (!r.ok) {
      if (r.code === "stale") await load();
      return setError(churchErrorText(t, r.code));
    }
    setRow(r.body.item);
    setSaved(r.body.item);
    show(c.saved);
  };

  const dirty = !!row && !!saved && (row.bible_year !== saved.bible_year || row.counselling !== saved.counselling);
  const toggle = (id: "bible_year" | "counselling", label: string, help: string, locked?: string) => (
    <li key={id} className="flex items-start gap-3 rounded-card border border-ringo-border bg-ringo-surface p-4">
      <input
        id={`feature-${id}`}
        type="checkbox"
        className="mt-1 h-5 w-5 shrink-0 rounded border-ringo-border accent-ringo-indigo"
        checked={row?.[id] === true}
        disabled={!!locked || !row}
        onChange={(e) => setRow((r) => (r ? { ...r, [id]: e.target.checked } : r))}
        aria-describedby={`feature-${id}-help`}
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={`feature-${id}`} className="text-sm font-semibold text-ringo-text">
          {label}
        </label>
        <p id={`feature-${id}-help`} className="mt-1 text-xs leading-relaxed text-ringo-muted">
          {locked ?? help}
        </p>
      </div>
      <span className="shrink-0 text-xs font-semibold text-ringo-muted">{row?.[id] === true ? c.on : c.off}</span>
    </li>
  );

  return (
    <section aria-labelledby="church-features-title" className="flex flex-col gap-5">
      <header>
        <h1 id="church-features-title" className="font-display text-xl font-semibold text-ringo-text">
          {c.title}
        </h1>
        <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-ringo-muted">{c.intro}</p>
      </header>
      <NoticeBar message={notice} />
      {loadError ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorLine message={loadError} />
          <button type="button" onClick={load} className={BTN_SECONDARY}>
            {c.retry}
          </button>
        </div>
      ) : !row ? (
        <ListSkeleton rows={3} />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {toggle("bible_year", c.bibleYear.label, c.bibleYear.help)}
            {toggle("counselling", c.counselling.label, c.counselling.help)}
            <li key="giving" className="flex items-start gap-3 rounded-card border border-ringo-border bg-ringo-surface p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ringo-text">{c.giving.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-ringo-muted">{t.churchExpansion.gifts.activation.featuresLink}</p>
              </div>
              <a href="/dashboard/church/giving" className="inline-flex min-h-[44px] shrink-0 items-center rounded-full px-3 text-sm font-semibold text-ringo-indigo hover:bg-ringo-indigo/[0.06]">
                {t.churchExpansion.gifts.activation.featuresOpen}
              </a>
            </li>
          </ul>
          <ErrorLine message={error} />
          <div>
            <button type="button" onClick={save} disabled={saving || !dirty} className={BTN_PRIMARY}>
              {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
              {saving ? c.saving : c.save}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
