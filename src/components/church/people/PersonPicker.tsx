"use client";

import { useEffect, useId, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { INPUT, churchApi, errorText, useDebounced } from "./shared";

export interface PickedPerson {
  id: string;
  full_name: string;
  age_group?: string;
}

// Search-as-you-type picker for a person of THIS church (the server decides who the caller may see; a person the caller cannot see simply never appears).
// `ageGroup` narrows the search on the server (e.g. only adults for a guardian or a leadership title); only active people are offered.
export default function PersonPicker({
  label,
  placeholder,
  noneText,
  clearLabel,
  value,
  onChange,
  ageGroup,
  disabled,
  describedBy,
}: {
  label: string;
  placeholder: string;
  noneText: string;
  clearLabel: string;
  value: PickedPerson | null;
  onChange: (p: PickedPerson | null) => void;
  ageGroup?: "adult";
  disabled?: boolean;
  describedBy?: string;
}) {
  const { t } = useLanguage();
  const id = useId();
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 250);
  const [results, setResults] = useState<PickedPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (value || q.length < 1) {
      setResults([]);
      return;
    }
    let live = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ q, status: "active" });
    if (ageGroup) params.set("age_group", ageGroup);
    churchApi<{ members: PickedPerson[] }>(`/api/church/members?${params.toString()}`).then((r) => {
      if (!live) return;
      setLoading(false);
      if (r.ok) setResults(r.body.members.map((m) => ({ id: m.id, full_name: m.full_name, age_group: m.age_group })));
      else setError(errorText(t.churchPeople.errors, r.code));
    });
    return () => {
      live = false;
    };
  }, [q, value, ageGroup, t]);

  if (value) {
    return (
      <div className="flex min-h-[44px] items-center justify-between gap-2 rounded-card border border-ringo-border bg-ringo-bg px-3 py-2">
        <span className="truncate text-sm font-medium text-ringo-text">{value.full_name}</span>
        {!disabled && (
          <button type="button" onClick={() => { onChange(null); setText(""); }} aria-label={`${clearLabel}: ${value.full_name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        id={id}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        aria-describedby={describedBy}
        autoComplete="off"
        disabled={disabled}
        className={INPUT}
      />
      <div aria-live="polite" className="min-h-0">
        {loading && (
          <p className="flex items-center gap-2 px-1 text-xs text-ringo-muted">
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            {t.churchPeople.common.loading}
          </p>
        )}
        {error && <p role="alert" className="px-1 text-xs text-ringo-coral">{error}</p>}
        {!loading && !error && q.length >= 1 && results.length === 0 && <p className="px-1 text-xs text-ringo-muted">{noneText}</p>}
      </div>
      {results.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-card border border-ringo-border bg-ringo-surface" aria-label={label}>
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { onChange(p); setResults([]); }} className="flex min-h-[44px] w-full items-center px-3 py-2 text-left text-sm text-ringo-text hover:bg-ringo-indigo/[0.06] focus-visible:bg-ringo-indigo/[0.06] focus-visible:outline-none">
                {p.full_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
