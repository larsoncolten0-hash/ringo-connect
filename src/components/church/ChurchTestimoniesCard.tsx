"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Quote } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import type { PublicTestimony } from "@/lib/church/public/testimonies";

// "Testimonies" on the public church page: a slideshow of the testimonies the church approved and published with the submitter's consent (the database function behind it re-checks that on every
// request). One testimony is shown at a time; the controls are real buttons (previous, next, one dot per testimony) and the arrow keys work. There is NO automatic rotation, so nothing moves by itself and
// nothing needs a pause control. Only the words and, when the person allowed it, their name are shown: never a phone number, a group, a status or a note, because the card is never given them.
// Everything is PLAIN TEXT. Rendered by ProfileView for churches only, and only when at least one testimony is public.
export default function ChurchTestimoniesCard({
  t,
  testimonies,
  accent,
  accentText,
  textColor,
  borderTint,
  radiusClass,
}: {
  t: Translations;
  testimonies: PublicTestimony[];
  accent: string;
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
}) {
  const c = t.churchTestimonies.public;
  const [index, setIndex] = useState(0);
  if (testimonies.length === 0) return null;
  const n = testimonies.length;
  const current = Math.min(index, n - 1);
  const item = testimonies[current];
  const go = (to: number) => setIndex(((to % n) + n) % n);
  const headingId = "church-testimonies-heading";
  const btn = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2";

  return (
    <section
      aria-labelledby={headingId}
      aria-roledescription="carousel"
      className={`relative overflow-hidden ${radiusClass}`}
      style={{ border: `1px solid ${borderTint}`, backgroundColor: hexToRgba(textColor, 0.03) }}
      onKeyDown={(e) => {
        if (n < 2) return;
        if (e.key === "ArrowRight") go(current + 1);
        else if (e.key === "ArrowLeft") go(current - 1);
      }}
    >
      <div className="h-1.5 w-full" style={{ backgroundColor: accent }} aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-2">
          <Quote size={15} className="shrink-0" style={{ color: accent }} aria-hidden="true" />
          <h2 id={headingId} className="text-[11px] uppercase tracking-wider" style={{ opacity: 0.5 }}>
            {c.heading}
          </h2>
        </div>

        <div role="group" aria-roledescription="slide" aria-label={c.position(current + 1, n)} aria-live="polite" className="mt-3 min-h-[7rem]">
          <blockquote className="min-w-0">
            <p className="text-base leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{item.body}</p>
            {item.display_name && (
              <footer className="mt-3 text-sm font-semibold" style={{ color: accentText }}>
                {c.by(item.display_name)}
              </footer>
            )}
          </blockquote>
        </div>

        {n > 1 && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <button type="button" aria-label={c.previous} onClick={() => go(current - 1)} className={btn} style={{ border: `1px solid ${borderTint}`, color: accentText }}>
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <div className="flex flex-wrap items-center justify-center gap-1">
              {testimonies.map((x, i) => (
                <button key={x.id} type="button" aria-label={c.goTo(i + 1)} aria-current={i === current ? "true" : undefined} onClick={() => go(i)} className="flex h-11 w-6 items-center justify-center focus-visible:outline-none">
                  <span className="block h-2 w-2 rounded-full transition" style={{ backgroundColor: i === current ? accent : hexToRgba(textColor, 0.25) }} />
                </button>
              ))}
            </div>
            <button type="button" aria-label={c.next} onClick={() => go(current + 1)} className={btn} style={{ border: `1px solid ${borderTint}`, color: accentText }}>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
