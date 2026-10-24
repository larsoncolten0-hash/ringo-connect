"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Quote } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import type { PublicTestimony } from "@/lib/church/public/testimonies";
import { SERIF } from "@/components/church/site/churchTheme";

// "Testimonies" on the public church page: a slideshow of the testimonies the church approved and published with the submitter's consent (the database function behind it re-checks that on every
// request). One testimony is shown at a time; the controls are real buttons (previous, next, one dot per testimony) and the arrow keys work. There is NO automatic rotation, so nothing moves by itself and
// nothing needs a pause control. Only the words and, when the person allowed it, their name are shown: never a phone number, a group, a status or a note, because the card is never given them.
// Everything is PLAIN TEXT. Rendered on the church site for churches only, and only when at least one testimony is public. On the church site it sits on the evening band (`surface`), set as a large
// serif quotation; the controls stay inside the card at every width.
export default function ChurchTestimoniesCard({
  t,
  testimonies,
  accent,
  accentText,
  textColor,
  borderTint,
  radiusClass,
  surface,
}: {
  t: Translations;
  testimonies: PublicTestimony[];
  accent: string;
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
  /** The card's own fill (the church site's evening band); a faint tint of the text colour otherwise. */
  surface?: string;
}) {
  const c = t.churchTestimonies.public;
  const [index, setIndex] = useState(0);
  if (testimonies.length === 0) return null;
  const n = testimonies.length;
  const current = Math.min(index, n - 1);
  const item = testimonies[current];
  const go = (to: number) => setIndex(((to % n) + n) % n);
  const headingId = "church-testimonies-heading";
  const btn = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2";
  // long testimonies step down a size so a phone never needs to scroll inside the card
  const long = item.body.length > 420;

  return (
    <section
      aria-labelledby={headingId}
      aria-roledescription="carousel"
      className={`relative overflow-hidden ${radiusClass}`}
      style={{ border: `1px solid ${borderTint}`, backgroundColor: surface ?? hexToRgba(textColor, 0.03), color: textColor }}
      onKeyDown={(e) => {
        if (n < 2) return;
        if (e.key === "ArrowRight") go(current + 1);
        else if (e.key === "ArrowLeft") go(current - 1);
      }}
    >
      <div className="px-5 py-7 sm:px-10 sm:py-10">
        <h2 id={headingId} className="text-[1.65rem] font-semibold leading-tight tracking-[-0.01em]" style={{ fontFamily: SERIF }}>
          {c.heading}
        </h2>

        <div role="group" aria-roledescription="slide" aria-label={c.position(current + 1, n)} aria-live="polite" className="mt-6 min-h-[9rem]">
          <blockquote key={item.id} className="relative min-w-0 animate-fade-up motion-reduce:animate-none">
            <Quote size={30} aria-hidden="true" className="mb-3" style={{ color: hexToRgba(accent, 0.7), fill: hexToRgba(accent, 0.25) }} />
            <p className={`relative max-w-[60ch] whitespace-pre-line [overflow-wrap:anywhere] ${long ? "text-[1.05rem] leading-relaxed" : "text-[1.25rem] leading-[1.55] sm:text-[1.4rem]"}`} style={{ fontFamily: SERIF }}>
              {item.body}
            </p>
            {item.display_name && (
              <footer className="mt-5 text-sm font-semibold tracking-wide" style={{ color: accentText }}>
                {c.by(item.display_name)}
              </footer>
            )}
          </blockquote>
        </div>

        {n > 1 && (
          <div className="mt-7 flex items-center justify-between gap-3 border-t pt-4" style={{ borderColor: borderTint }}>
            <button type="button" aria-label={c.previous} onClick={() => go(current - 1)} className={btn} style={{ border: `1px solid ${borderTint}`, color: accentText }}>
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <div className="flex min-w-0 flex-wrap items-center justify-center">
              {testimonies.map((x, i) => (
                <button key={x.id} type="button" aria-label={c.goTo(i + 1)} aria-current={i === current ? "true" : undefined} onClick={() => go(i)} className="group flex h-11 min-w-[28px] items-center justify-center focus-visible:outline-none">
                  <span
                    className="block h-2 rounded-full transition-all group-focus-visible:ring-2 motion-reduce:transition-none"
                    style={{ width: i === current ? 22 : 8, backgroundColor: i === current ? accent : hexToRgba(textColor, 0.3) }}
                  />
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
