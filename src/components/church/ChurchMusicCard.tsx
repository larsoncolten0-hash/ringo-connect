import { Music2 } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import type { PublicMusicLink } from "@/lib/church/public/music";

// "Music" on the public church page (Phase 8), also drawn in the dashboard preview. Rendered by ProfileView only for the Churches & Ministries category and only when at least one link is visible. A link-out
// only: each entry is the label the church chose, the platform's name, and one link that opens that platform in a new tab. Nothing is played, downloaded or sold here. Everything is PLAIN TEXT.
export default function ChurchMusicCard({
  t,
  links,
  accent,
  accentText,
  textColor,
  borderTint,
  radiusClass,
  preview = false,
}: {
  t: Translations;
  links: PublicMusicLink[];
  accent: string;
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
  /** In the dashboard preview the links go nowhere. */
  preview?: boolean;
}) {
  const c = t.churchMusic.public;
  if (links.length === 0) return null;
  const platformName = (id: string) => (t.churchMusic.platforms as Record<string, string>)[id] ?? id;
  const headingId = "church-music-heading";
  return (
    <section aria-labelledby={headingId} className={`relative overflow-hidden ${radiusClass}`} style={{ border: `1px solid ${borderTint}`, backgroundColor: hexToRgba(textColor, 0.03) }}>
      <div className="h-1.5 w-full" style={{ backgroundColor: accent }} aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-2">
          <Music2 size={15} className="shrink-0" style={{ color: accent }} aria-hidden="true" />
          <h2 id={headingId} className="text-[11px] uppercase tracking-wider" style={{ opacity: 0.5 }}>
            {c.heading}
          </h2>
        </div>
        <ul className="mt-3 flex flex-col gap-1">
          {links.map((l) => {
            const name = platformName(l.platform);
            const inner = (
              <>
                <span className="min-w-0 text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{l.title}</span>
                <span className="shrink-0 text-xs" style={{ opacity: 0.7 }}>
                  {c.listenOn(name)}
                </span>
              </>
            );
            return (
              <li key={l.id}>
                {preview ? (
                  <span className="flex min-h-[44px] items-center justify-between gap-3 py-1" style={{ color: accentText }}>
                    {inner}
                  </span>
                ) : (
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={c.open(l.title, name)}
                    className="flex min-h-[44px] items-center justify-between gap-3 py-1 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ color: accentText, outlineColor: accentText }}
                  >
                    {inner}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs" style={{ opacity: 0.65 }}>
          {c.external}
        </p>
      </div>
    </section>
  );
}
