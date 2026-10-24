import { ArrowUpRight, Music2 } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import type { PublicMusicLink } from "@/lib/church/public/music";
import { SERIF } from "@/components/church/site/churchTheme";

// "Music" on the public church page (Phase 8), also drawn in the dashboard preview. Rendered on the church site only for the Churches & Ministries category and only when at least one link is visible. A link-out
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
  const row = `flex min-h-[60px] items-center gap-3 border px-4 py-2.5 ${radiusClass}`;
  return (
    <section aria-labelledby={headingId} className={`relative ${radiusClass}`} style={{ color: textColor }}>
      <h2 id={headingId} className="text-[1.65rem] font-semibold leading-tight tracking-[-0.01em]" style={{ fontFamily: SERIF }}>
        {c.heading}
      </h2>
      <ul className="mt-5 grid gap-2 sm:grid-cols-2">
        {links.map((l) => {
          const name = platformName(l.platform);
          const inner = (
            <>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(accent, 0.12) }} aria-hidden="true">
                <Music2 size={16} style={{ color: accentText }} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[0.975rem] font-semibold leading-snug [overflow-wrap:anywhere]">{l.title}</span>
                <span className="text-xs" style={{ opacity: 0.75 }}>
                  {c.listenOn(name)}
                </span>
              </span>
              <ArrowUpRight size={17} className="shrink-0" style={{ color: accentText }} aria-hidden="true" />
            </>
          );
          return (
            <li key={l.id}>
              {preview ? (
                <span className={row} style={{ borderColor: borderTint }}>
                  {inner}
                </span>
              ) : (
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label={c.open(l.title, name)}
                  className={`${row} transition-colors hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`}
                  style={{ borderColor: borderTint, outlineColor: accentText, backgroundColor: hexToRgba("#FFFFFF", 0.6) }}
                >
                  {inner}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm" style={{ opacity: 0.75 }}>
        {c.external}
      </p>
    </section>
  );
}
