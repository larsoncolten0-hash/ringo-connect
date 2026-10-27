"use client";

import { UserRound } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import type { PublicLang } from "@/lib/church/public/events";
import type { PublicAbout, PublicPastor } from "@/lib/church/public/groups";
import OptImg from "@/components/ui/OptImg";
import { safeChurchImageUrl } from "@/lib/church/images";
import SectionShell from "./SectionShell";
import { SERIF } from "./churchTheme";

// The Pastors of a church: on the church page a short introduction of each (photo, name, a word) with "See more", and on the Pastors page the whole biography plus the church's vision and mission.
// All text is plain text. A pastor appears only when the church published them; the page needs no account and shows no contact detail.

interface Theme {
  t: Translations;
  locale: PublicLang;
  accent: string;
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
}

const either = (a: string | null, b: string | null, lang: PublicLang, fa: string | null, fb: string | null): string | null => (lang === "en" ? a ?? b : fb ?? fa);
const word = (p: PublicPastor, lang: PublicLang) => (lang === "en" ? p.word_en ?? p.word_fr : p.word_fr ?? p.word_en);
const bio = (p: PublicPastor, lang: PublicLang) => (lang === "en" ? p.bio_en ?? p.bio_fr : p.bio_fr ?? p.bio_en);

function Portrait({ pastor, size, theme }: { pastor: PublicPastor; size: number; theme: Theme }) {
  const cls = "shrink-0 rounded-full object-cover";
  const photo = safeChurchImageUrl(pastor.photo_url);
  return photo ? (
    <OptImg src={photo} alt="" widths={[size * 2, size * 4]} sizes={`${size}px`} square className={cls} style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, backgroundColor: hexToRgba(theme.accent, 0.12), color: theme.accentText }} aria-hidden="true">
      <UserRound size={Math.round(size / 2.4)} />
    </span>
  );
}

/** On the church page: the first pastors in short, and a "See more" to the Pastors page. */
export function ChurchPastorsCard({ pastors, seeMoreHref, ...theme }: Theme & { pastors: PublicPastor[]; seeMoreHref?: string }) {
  const c = theme.t.churchExpansion.pastors.public;
  if (pastors.length === 0) return null;
  const shown = pastors.slice(0, 3);
  return (
    <SectionShell t={theme.t} headingId="church-pastors-heading" heading={c.title} intro={c.intro} seeMoreHref={seeMoreHref} accentText={theme.accentText} borderTint={theme.borderTint} textColor={theme.textColor}>
      <ul className="mt-5 grid gap-3 sm:grid-cols-3">
        {shown.map((p) => {
          const w = word(p, theme.locale);
          return (
            <li key={p.id} className={`flex min-w-0 flex-col items-center gap-3 border p-5 text-center ${theme.radiusClass}`} style={{ borderColor: theme.borderTint, backgroundColor: hexToRgba("#FFFFFF", 0.6) }}>
              <Portrait pastor={p} size={96} theme={theme} />
              <h3 className="text-[1.1rem] font-semibold leading-snug [overflow-wrap:anywhere]" style={{ fontFamily: SERIF }}>
                {p.name}
              </h3>
              {w && <p className="line-clamp-4 text-sm leading-relaxed whitespace-pre-line" style={{ opacity: 0.85 }}>{w}</p>}
            </li>
          );
        })}
      </ul>
    </SectionShell>
  );
}

/** The Pastors page: every pastor in full, then the vision and the mission. */
export function ChurchPastorsBody({ pastors, about, ...theme }: Theme & { pastors: PublicPastor[]; about: PublicAbout | null }) {
  const c = theme.t.churchExpansion.pastors.public;
  const vision = about ? either(about.vision_en, about.vision_fr, theme.locale, about.vision_en, about.vision_fr) : null;
  const mission = about ? either(about.mission_en, about.mission_fr, theme.locale, about.mission_en, about.mission_fr) : null;
  return (
    <div className="flex flex-col gap-12">
      <SectionShell t={theme.t} headingId="church-pastors-heading" heading={c.title} headingLevel="h1" intro={c.intro} accentText={theme.accentText} borderTint={theme.borderTint} textColor={theme.textColor}>
        <ul className="mt-6 flex flex-col gap-8">
          {pastors.map((p) => {
            const w = word(p, theme.locale);
            const b = bio(p, theme.locale);
            return (
              <li key={p.id} className="flex min-w-0 flex-col gap-4 sm:flex-row sm:gap-6">
                <Portrait pastor={p} size={128} theme={theme} />
                <div className="min-w-0">
                  <h2 className="text-[1.4rem] font-semibold leading-tight [overflow-wrap:anywhere]" style={{ fontFamily: SERIF }}>
                    {p.name}
                  </h2>
                  {w && (
                    <blockquote className="mt-2 border-l-2 pl-4 text-[1rem] italic leading-relaxed whitespace-pre-line" style={{ borderColor: theme.accent }}>
                      <span className="sr-only">{c.wordLabel}: </span>
                      {w}
                    </blockquote>
                  )}
                  {b && <p className="mt-3 max-w-[65ch] text-[0.975rem] leading-[1.7] whitespace-pre-line [overflow-wrap:anywhere]">{b}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </SectionShell>
      {(vision || mission) && (
        <div className="grid gap-8 sm:grid-cols-2">
          {vision && (
            <section aria-labelledby="church-vision-heading">
              <h2 id="church-vision-heading" className="text-[1.4rem] font-semibold" style={{ fontFamily: SERIF }}>
                {c.visionTitle}
              </h2>
              <p className="mt-2 max-w-[60ch] text-[0.975rem] leading-[1.7] whitespace-pre-line [overflow-wrap:anywhere]">{vision}</p>
            </section>
          )}
          {mission && (
            <section aria-labelledby="church-mission-heading">
              <h2 id="church-mission-heading" className="text-[1.4rem] font-semibold" style={{ fontFamily: SERIF }}>
                {c.missionTitle}
              </h2>
              <p className="mt-2 max-w-[60ch] text-[0.975rem] leading-[1.7] whitespace-pre-line [overflow-wrap:anywhere]">{mission}</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
