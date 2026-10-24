import { Clock, MapPin, Navigation } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import type { ChurchVisit } from "@/lib/church/publicPage";
import { SERIF } from "@/components/church/site/churchTheme";

// "Visit us": when and where the church meets. Rendered on the church site only for the Churches & Ministries category and only when the profile has service
// times or a location (see getChurchVisit); it shows exactly what the owner wrote, nothing more. Colors come from the props (the church site's paper ground, or
// whatever surface a preview draws it on). Service times are a timetable on the left, the place and the way there on the right; one column on a phone.
export default function ChurchVisitCard({
  t,
  visit,
  accent,
  accentText,
  textColor,
  borderTint,
  radiusClass,
  surface,
}: {
  t: Translations;
  visit: ChurchVisit;
  /** The owner's accent, for decoration (icons, the directions button edge). */
  accent: string;
  /** The accent adjusted to read as TEXT on the surface behind the card. */
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
  /** The card's own fill (the church site's raised surface); a faint tint of the text colour otherwise. */
  surface?: string;
}) {
  const c = t.profilePage.church;
  const headingId = "church-visit-heading";
  const both = visit.serviceTimes.length > 0 && !!visit.location;
  return (
    <section aria-labelledby={headingId} className={`relative overflow-hidden ${radiusClass}`} style={{ border: `1px solid ${borderTint}`, backgroundColor: surface ?? hexToRgba(textColor, 0.03) }}>
      <div className="p-5 sm:p-7">
        <h2 id={headingId} className="text-[1.65rem] font-semibold leading-tight tracking-[-0.01em] [text-wrap:balance]" style={{ fontFamily: SERIF }}>
          {c.visitTitle}
        </h2>

        <div className={`mt-5 grid gap-6 ${both ? "sm:grid-cols-[1.1fr_1fr] sm:gap-8" : ""}`}>
          {visit.serviceTimes.length > 0 && (
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: accentText }}>
                <Clock size={16} className="shrink-0" style={{ color: accent }} aria-hidden="true" />
                {c.serviceTimes}
              </p>
              {visit.serviceTimes.length === 1 ? (
                <p className="mt-2 text-base font-medium leading-snug [overflow-wrap:anywhere]">{visit.serviceTimes[0]}</p>
              ) : (
                <ul className="mt-2 flex flex-col">
                  {visit.serviceTimes.map((line, i) => (
                    <li key={line} className="py-2.5 text-base font-medium leading-snug tabular-nums [overflow-wrap:anywhere]" style={i > 0 ? { borderTop: `1px solid ${borderTint}` } : undefined}>
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {visit.location && (
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: accentText }}>
                <MapPin size={16} className="shrink-0" style={{ color: accent }} aria-hidden="true" />
                {c.location}
              </p>
              <p className="mt-2 text-base font-medium leading-snug [overflow-wrap:anywhere]">{visit.location}</p>
              {visit.directionsUrl && (
                <a
                  href={visit.directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={c.directionsTo(visit.location)}
                  className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-full border px-5 text-sm font-semibold transition-colors hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ borderColor: hexToRgba(accent, 0.6), color: accentText, outlineColor: accentText }}
                >
                  <Navigation size={15} aria-hidden="true" />
                  {c.getDirections}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
