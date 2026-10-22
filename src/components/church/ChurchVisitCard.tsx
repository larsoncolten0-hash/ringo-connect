import { Clock, MapPin, Navigation } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import type { ChurchVisit } from "@/lib/church/publicPage";

// "Visit us": when and where the church meets. Rendered by ProfileView only for the Churches & Ministries category and only when the profile has service
// times or a location (see getChurchVisit); it shows exactly what the owner wrote, nothing more. Colors come from the page's own theme and panel, never
// from a palette of its own, so it follows the owner's accent and the Paper panel contrast rules like every other section.
export default function ChurchVisitCard({
  t,
  visit,
  accent,
  accentText,
  textColor,
  borderTint,
  radiusClass,
}: {
  t: Translations;
  visit: ChurchVisit;
  /** The owner's accent, for decoration (the top stripe, icons). */
  accent: string;
  /** The accent adjusted to read as TEXT on the panel behind the card. */
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
}) {
  const c = t.profilePage.church;
  const headingId = "church-visit-heading";
  return (
    <section aria-labelledby={headingId} className={`relative overflow-hidden ${radiusClass}`} style={{ border: `1px solid ${borderTint}`, backgroundColor: hexToRgba(textColor, 0.03) }}>
      <div className="h-1.5 w-full" style={{ backgroundColor: accent }} aria-hidden="true" />
      <div className="p-5">
        <h2 id={headingId} className="text-[11px] uppercase tracking-wider" style={{ opacity: 0.5 }}>
          {c.visitTitle}
        </h2>

        <div className="mt-3 flex flex-col gap-4">
          {visit.serviceTimes.length > 0 && (
            <div className="flex items-start gap-3 min-w-0">
              <Clock size={16} className="shrink-0 mt-0.5" style={{ color: accent }} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider" style={{ opacity: 0.7 }}>
                  {c.serviceTimes}
                </p>
                {visit.serviceTimes.length === 1 ? (
                  <p className="mt-0.5 text-sm font-medium [overflow-wrap:anywhere]">{visit.serviceTimes[0]}</p>
                ) : (
                  <ul className="mt-0.5 flex flex-col gap-1">
                    {visit.serviceTimes.map((line) => (
                      <li key={line} className="text-sm font-medium [overflow-wrap:anywhere]">
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {visit.location && (
            <div className="flex items-start gap-3 min-w-0">
              <MapPin size={16} className="shrink-0 mt-0.5" style={{ color: accent }} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider" style={{ opacity: 0.7 }}>
                  {c.location}
                </p>
                <p className="mt-0.5 text-sm font-medium [overflow-wrap:anywhere]">{visit.location}</p>
                {visit.directionsUrl && (
                  <a
                    href={visit.directionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={c.directionsTo(visit.location)}
                    className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition hover:opacity-75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ borderColor: hexToRgba(accent, 0.55), color: accentText, outlineColor: accentText }}
                  >
                    <Navigation size={14} aria-hidden="true" />
                    {c.getDirections}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
