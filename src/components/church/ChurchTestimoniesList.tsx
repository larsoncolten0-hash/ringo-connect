import { Quote } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import type { PublicTestimony } from "@/lib/church/public/testimonies";
import { SERIF } from "@/components/church/site/churchTheme";

// "Testimonies" as a PAGE (the landing page): every testimony of this church week, one card each, in the order they were shared. The same public data as the slideshow on the church page, so the same rules:
// only the words and, when the person allowed it, their name; never a phone number, a group, a status or a note, because the list is never given them. PLAIN TEXT. No rotation: a page you read.
export default function ChurchTestimoniesList({
  t,
  testimonies,
  accent,
  accentText,
  textColor,
  borderTint,
  radiusClass,
  headingLevel = "h1",
  intro,
}: {
  t: Translations;
  testimonies: PublicTestimony[];
  accent: string;
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
  headingLevel?: "h1" | "h2";
  intro?: string;
}) {
  const c = t.churchTestimonies.public;
  if (testimonies.length === 0) return null;
  const H = headingLevel;
  const headingId = "church-testimonies-page-heading";
  return (
    <section aria-labelledby={headingId} className={`relative ${radiusClass}`} style={{ color: textColor }}>
      <H id={headingId} className={`${H === "h1" ? "text-[2rem] sm:text-[2.4rem]" : "text-[1.65rem]"} font-semibold leading-tight tracking-[-0.01em]`} style={{ fontFamily: SERIF }}>
        {c.heading}
      </H>
      {intro && (
        <p className="mt-2 max-w-[65ch] text-[0.95rem] leading-relaxed" style={{ opacity: 0.8 }}>
          {intro}
        </p>
      )}
      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {testimonies.map((item) => (
          <li key={item.id} className={`min-w-0 border p-5 sm:p-6 ${radiusClass}`} style={{ borderColor: borderTint, backgroundColor: hexToRgba("#FFFFFF", 0.6) }}>
            <blockquote className="min-w-0">
              <Quote size={22} aria-hidden="true" className="mb-2" style={{ color: hexToRgba(accent, 0.7), fill: hexToRgba(accent, 0.25) }} />
              <p className="whitespace-pre-line text-[1.05rem] leading-[1.6] [overflow-wrap:anywhere]" style={{ fontFamily: SERIF }}>
                {item.body}
              </p>
              {item.display_name && (
                <footer className="mt-3 text-sm font-semibold tracking-wide" style={{ color: accentText }}>
                  {c.by(item.display_name)}
                </footer>
              )}
            </blockquote>
          </li>
        ))}
      </ul>
    </section>
  );
}
