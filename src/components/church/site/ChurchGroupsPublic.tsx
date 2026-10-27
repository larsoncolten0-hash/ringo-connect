"use client";

import { ChevronLeft, ChevronRight, Pause, Play, UsersRound } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import type { PublicLang } from "@/lib/church/public/events";
import type { PublicGroup, PublicGroupPage, PublicGroupPhoto } from "@/lib/church/public/groups";
import { ChurchAnnouncementsCard } from "@/components/church/ChurchEventsCards";
import OptImg from "@/components/ui/OptImg";
import { safeChurchImageUrl } from "@/lib/church/images";
import ChurchPicture from "./ChurchPicture";
import SectionShell from "./SectionShell";
import { SERIF } from "./churchTheme";
import { useRotation } from "./useRotation";

// The public group pages of a church (Men, Women, Youths, Children). A group is a PRESENTATION: a leader's name and photo, a welcome text, photos and the announcements written for it. The page lists
// no member and shows no count, and the Children page carries no caption, so no child is ever named. Everything is plain text; a picture is drawn only when its address is one this platform stores.

interface Theme {
  t: Translations;
  locale: PublicLang;
  accent: string;
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
}

const pick = (g: PublicGroup, lang: PublicLang): string | null => g[`description_${lang}`] ?? g[`description_${lang === "en" ? "fr" : "en"}`];
const kindLabel = (t: Translations, kind: string): string => (t.churchExpansion.groups.kinds as Record<string, string>)[kind] ?? kind;
const groupHref = (username: string, kind: string) => `/${encodeURIComponent(username)}/church/groups/${kind}`;

/** The list of group pages: on the church page (with "See more") and as the groups index page. Each card opens the group's own page. */
export function ChurchGroupsCard({ groups, username, headingLevel, seeMoreHref, intro, ...theme }: Theme & { groups: PublicGroup[]; username: string; headingLevel?: "h1" | "h2"; seeMoreHref?: string; intro?: string }) {
  const c = theme.t.churchExpansion.groups.public;
  if (groups.length === 0) return null;
  return (
    <SectionShell t={theme.t} headingId="church-groups-heading" heading={c.title} headingLevel={headingLevel} intro={intro} seeMoreHref={seeMoreHref} accentText={theme.accentText} borderTint={theme.borderTint} textColor={theme.textColor}>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {groups.map((g) => {
          const label = kindLabel(theme.t, g.kind);
          const blurb = pick(g, theme.locale);
          return (
            <li key={g.id} className="min-w-0">
              <a
                href={groupHref(username, g.kind)}
                aria-label={c.open(label)}
                className={`flex h-full min-h-[88px] items-center gap-4 border p-4 transition-colors hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${theme.radiusClass}`}
                style={{ borderColor: theme.borderTint, backgroundColor: hexToRgba("#FFFFFF", 0.6), outlineColor: theme.accentText }}
              >
                {safeChurchImageUrl(g.leader_photo_url) ? (
                  <OptImg src={safeChurchImageUrl(g.leader_photo_url) as string} alt="" widths={[96, 192]} sizes="56px" square className="h-14 w-14 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(theme.accent, 0.12), color: theme.accentText }} aria-hidden="true">
                    <UsersRound size={22} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[1.15rem] font-semibold leading-snug" style={{ fontFamily: SERIF }}>
                    {label}
                  </span>
                  {g.leader_name && (
                    <span className="mt-0.5 block truncate text-sm" style={{ opacity: 0.75 }}>
                      {c.led(g.leader_name)}
                    </span>
                  )}
                  {blurb && (
                    <span className="mt-1 line-clamp-2 text-sm leading-relaxed" style={{ opacity: 0.85 }}>
                      {blurb}
                    </span>
                  )}
                </span>
                <ChevronRight size={18} className="shrink-0" style={{ color: theme.accentText }} aria-hidden="true" />
              </a>
            </li>
          );
        })}
      </ul>
    </SectionShell>
  );
}

/** The photos of a group as a rotating slideshow (the shared rotation: it pauses on hover, keyboard focus, a hidden tab and for reduced motion, and always has a visible Pause / Play). */
function GroupPhotos({ photos, label, theme }: { photos: PublicGroupPhoto[]; label: string; theme: Theme }) {
  const sl = theme.t.churchSite.public.slides;
  const n = photos.length;
  const rot = useRotation(n, 6000);
  const p = photos[rot.index];
  const caption = p ? (p[`caption_${theme.locale}`] ?? p[`caption_${theme.locale === "en" ? "fr" : "en"}`]) : null;
  const btn = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2";
  if (!p) return null;
  return (
    <div
      aria-roledescription="carousel"
      aria-label={label}
      className="mt-6"
      ref={rot.rootRef}
      {...rot.hold}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") rot.next();
        else if (e.key === "ArrowLeft") rot.prev();
      }}
    >
      <div role="group" aria-roledescription="slide" aria-label={sl.position(rot.index + 1, n)} aria-live={rot.live}>
        <figure key={p.id} className={`overflow-hidden border animate-fade-up motion-reduce:animate-none ${theme.radiusClass}`} style={{ borderColor: theme.borderTint }}>
          <ChurchPicture src={p.image_url} ratio="4 / 3" />
          {caption && (
            <figcaption className="px-4 py-3 text-sm leading-relaxed" style={{ opacity: 0.85 }}>
              {caption}
            </figcaption>
          )}
        </figure>
      </div>
      {n > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <button type="button" aria-label={sl.previous} onClick={rot.prev} className={btn} style={{ borderColor: theme.borderTint, color: theme.accentText }}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <div className="flex min-w-0 flex-wrap items-center justify-center">
            {photos.map((x, i) => (
              <button key={x.id} type="button" aria-label={sl.goTo(i + 1)} aria-current={i === rot.index ? "true" : undefined} onClick={() => rot.go(i)} className="group flex h-11 min-w-[28px] items-center justify-center focus-visible:outline-none">
                <span className="block h-2 rounded-full transition-all group-focus-visible:ring-2 motion-reduce:transition-none" style={{ width: i === rot.index ? 22 : 8, backgroundColor: i === rot.index ? theme.accent : hexToRgba(theme.textColor, 0.25) }} />
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" aria-label={rot.playing ? sl.pause : sl.play} aria-pressed={!rot.playing} onClick={rot.toggle} className={btn} style={{ borderColor: theme.borderTint, color: theme.accentText }}>
              {rot.playing ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
            </button>
            <button type="button" aria-label={sl.next} onClick={rot.next} className={btn} style={{ borderColor: theme.borderTint, color: theme.accentText }}>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One group's page: leader, welcome text, rotating photos, and the announcements written for this group. The group name is the page's single h1. */
export function ChurchGroupBody({ page, ...theme }: Theme & { page: PublicGroupPage }) {
  const c = theme.t.churchExpansion.groups.public;
  const { group, photos, announcements } = page;
  const label = kindLabel(theme.t, group.kind);
  const blurb = pick(group, theme.locale);
  return (
    <div className="flex flex-col gap-12">
      <SectionShell t={theme.t} headingId="church-group-heading" heading={label} headingLevel="h1" accentText={theme.accentText} borderTint={theme.borderTint} textColor={theme.textColor}>
        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
          {safeChurchImageUrl(group.leader_photo_url) && <OptImg src={safeChurchImageUrl(group.leader_photo_url) as string} alt="" widths={[160, 320]} sizes="128px" square className="h-28 w-28 shrink-0 rounded-full object-cover sm:h-32 sm:w-32" />}
          <div className="min-w-0">
            {group.leader_name && (
              <p className="text-[1.05rem] font-semibold" style={{ color: theme.accentText }}>
                {c.led(group.leader_name)}
              </p>
            )}
            {blurb && <p className="mt-2 max-w-[65ch] text-[1rem] leading-[1.7] whitespace-pre-line [overflow-wrap:anywhere]">{blurb}</p>}
          </div>
        </div>
        <GroupPhotos photos={photos} label={c.photosLabel} theme={theme} />
      </SectionShell>

      {announcements.length > 0 ? (
        <ChurchAnnouncementsCard t={theme.t} locale={theme.locale} announcements={announcements} rotate heading={c.announcementsTitle} accent={theme.accent} accentText={theme.accentText} textColor={theme.textColor} borderTint={theme.borderTint} radiusClass={theme.radiusClass} />
      ) : (
        <p className="max-w-[60ch] text-sm" style={{ opacity: 0.75 }}>
          {c.noAnnouncements}
        </p>
      )}
    </div>
  );
}
