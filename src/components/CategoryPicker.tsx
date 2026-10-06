"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { CATEGORIES, type CategoryId } from "@/lib/categories";

// Shared by /auth/signup, the get-started flow, and the dashboard's
// CategoryCard — a grid to pick one primary category (drives the default
// copy — see src/lib/categories.ts), plus an optional expandable set of
// extra categories that don't change any defaults, just tag the page as
// relevant to more than one audience.
//
// Deliberately takes `locale` as a plain prop instead of reading
// useLanguage() itself — /auth/signup doesn't use the app's i18n system at
// all (it's English-only by design), so this stays usable there too.
export default function CategoryPicker({
  locale,
  primary,
  onSelectPrimary,
  extra,
  onToggleExtra,
  strings,
}: {
  locale: "en" | "fr";
  primary: CategoryId | null;
  onSelectPrimary: (id: CategoryId) => void;
  extra: CategoryId[];
  onToggleExtra: (id: CategoryId) => void;
  strings: { morePrompt: string; moreHint: string };
}) {
  const [showMore, setShowMore] = useState(extra.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectPrimary(c.id)}
            aria-pressed={primary === c.id}
            className={`ringo-tactile relative min-h-[92px] text-left rounded-card border p-3.5 ${
              primary === c.id
                ? "border-ringo-indigo bg-ringo-indigo/[0.06] shadow-[0_0_0_1px_rgb(var(--ringo-accent))]"
                : "border-ringo-border hover:border-ringo-indigo/50 hover:bg-ringo-muted/[0.04]"
            }`}
          >
            {primary === c.id && (
              <span aria-hidden="true" className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-ringo-indigo text-white">
                <Check size={12} strokeWidth={3} />
              </span>
            )}
            <span className="text-xl leading-none">{c.emoji}</span>
            <p className="text-sm font-medium mt-1.5">{c.label[locale]}</p>
            <p className="text-[11px] text-ringo-muted mt-0.5 line-clamp-2">{c.examples[locale]}</p>
          </button>
        ))}
      </div>

      {primary && (
        <div>
          {!showMore ? (
            <button
              type="button"
              onClick={() => setShowMore(true)}
              className="ringo-tactile inline-flex min-h-[44px] items-center rounded-full border border-ringo-border px-4 text-sm font-medium text-ringo-indigo hover:border-ringo-indigo/40"
            >
              {strings.morePrompt}
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-ringo-muted">{strings.moreHint}</p>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.filter((c) => c.id !== primary).map((c) => {
                  const checked = extra.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onToggleExtra(c.id)}
                      aria-pressed={checked}
                      className={`ringo-tactile min-h-[44px] text-xs px-3.5 py-1.5 rounded-full border ${
                        checked
                          ? "border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo font-medium"
                          : "border-ringo-border text-ringo-muted"
                      }`}
                    >
                      {c.emoji} {c.label[locale]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
