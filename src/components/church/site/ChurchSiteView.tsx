"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, BadgeCheck, Menu, Navigation, Phone, UserPlus, X } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { useLanguage } from "@/components/LanguageProvider";
import { contrastRatio, hexToRgba } from "@/lib/color";
import { getBackgroundStyle } from "@/lib/theme";
import { avatarRadius, normalizeAvatarShape } from "@/lib/avatarShape";
import { isUsablePhone } from "@/lib/heroAction";
import { buildVCard, vCardFileName } from "@/lib/vcard";
import { saveContactClick } from "@/components/SaveContactButton";
import type { PublicWord } from "@/lib/church/content/publicWord";
import type { ChurchPublicExtras } from "@/lib/church/public";
import type { ChurchVisit } from "@/lib/church/publicPage";
import { landingPath, type ChurchLandingKind } from "@/lib/church/public/landing";
import OptImg from "@/components/ui/OptImg";
import SocialIcon from "@/components/SocialIcon";
import ShareButton from "@/components/ShareButton";
import PublicLanguageSelector from "@/components/PublicLanguageSelector";
import FanRecognitionHeader from "@/components/FanRecognitionHeader";
import ConnectButton from "@/components/connect/ConnectButton";
import AddToHomeScreen from "@/components/AddToHomeScreen";
import PoweredByRingo from "@/components/PoweredByRingo";
import ChurchVisitCard from "@/components/church/ChurchVisitCard";
import ChurchServicesCard from "./ChurchServicesCard";
import DailyWordCard from "@/components/church/DailyWordCard";
import { ChurchAnnouncementsCard, ChurchEventsCard } from "@/components/church/ChurchEventsCards";
import ChurchBibleCard from "@/components/church/ChurchBibleCard";
import ChurchMusicCard from "@/components/church/ChurchMusicCard";
import ChurchCareCard from "@/components/church/ChurchCareCard";
import ChurchTestimoniesCard from "@/components/church/ChurchTestimoniesCard";
import ShareTestimony from "@/components/church/ShareTestimony";
import { ChurchGroupsCard } from "./ChurchGroupsPublic";
import { ChurchPastorsCard } from "./ChurchPastorsPublic";
import ChurchMembershipJoin from "./ChurchMembershipJoin";
import ChurchNotificationsCard from "./ChurchNotificationsCard";
import ChurchBibleYearCard from "./ChurchBibleYearCard";
import ChurchGiveCard from "./ChurchGiveCard";
import ChurchCounsellingForm from "./ChurchCounsellingForm";
import { CH, SERIF, SERIF_HREF, churchCardTheme, churchHeroTheme, churchPalette, safeAccent } from "./churchTheme";
import Monogram from "./Monogram";

// The Churches & Ministries public page: the church's own template, chosen by ProfileView for this category only (the same way Music has its own view), so every
// other category renders exactly as before. It composes the church modules that already exist (each one renders only when the church published something) under
// a church website's information architecture: who we are and how to visit first, then what is happening, then the words, testimonies and resources, then contact.
// Nothing is invented: a section with no content is not on the page and not in the navigation. The shared sections (contact card, links, store) are built once by
// ProfileView and passed in, so their behaviour (analytics, checkout, the public-content filters) is unchanged.

type SectionId = "visit" | "news" | "word" | "groups" | "pastors" | "testimonies" | "bible" | "bibleYear" | "giving" | "counselling" | "music" | "care" | "store" | "links" | "contact";

export interface ChurchSiteProps {
  profile: any;
  preview: boolean;
  isOwner: boolean;
  staffBadges: { orgUsername: string; orgName: string; orgAvatarUrl: string | null; roleName: string }[];
  accent: string;
  churchVisit: ChurchVisit | null;
  churchType: string | null;
  dailyWords: PublicWord[];
  churchPublic: ChurchPublicExtras;
  socialLinks: any[];
  /** The shared sections, already built by ProfileView (null when they have nothing to show). */
  shared: { about: ReactNode; links: ReactNode; catalog: ReactNode };
  onWhatsappClick: () => void;
}

export default function ChurchSiteView({ profile, preview, isOwner, staffBadges, accent: rawAccent, churchVisit, churchType, dailyWords, churchPublic, socialLinks, shared, onWhatsappClick }: ChurchSiteProps) {
  const { t, locale } = useLanguage();
  const s = t.churchSite.public;
  const accent = safeAccent(rawAccent);
  const pal = churchPalette(accent);
  // The owner's Appearance colours (background, text, solid or gradient) paint the hero, as they did before the church had its own template; everything below sits on linen.
  const hero = churchHeroTheme(profile, accent);
  const card = churchCardTheme(pal);
  const name: string = profile.name || profile.username || "";
  const avatarShape = normalizeAvatarShape(profile.avatar_shape);
  const wa = isUsablePhone(profile.whatsapp_number) ? String(profile.whatsapp_number).trim() : null;
  const phone = isUsablePhone(profile.about_phone) ? String(profile.about_phone).trim() : null;
  const care = churchPublic.care ?? [];
  const groups = churchPublic.groups ?? [];
  const pastors = churchPublic.pastors ?? [];
  const testimonies = churchPublic.testimonies ?? [];
  const hasNews = churchPublic.announcements.length > 0 || churchPublic.events.length > 0;
  const hasContact = !!shared.about || socialLinks.length > 0 || !isOwner;

  // The navigation lists only the sections that are actually on the page, in page order.
  const present: Record<SectionId, boolean> = {
    visit: !!churchVisit,
    news: hasNews,
    word: dailyWords.length > 0,
    groups: groups.length > 0,
    pastors: pastors.length > 0,
    testimonies: testimonies.length > 0 || !preview,
    bible: churchPublic.programs.length > 0,
    bibleYear: churchPublic.features?.bible_year === true,
    giving: churchPublic.features?.giving === true,
    counselling: churchPublic.features?.counselling === true,
    music: churchPublic.music.length > 0,
    care: care.length > 0,
    store: !!shared.catalog,
    links: !!shared.links,
    contact: hasContact,
  };
  const order: SectionId[] = ["visit", "news", "word", "groups", "pastors", "testimonies", "bible", "bibleYear", "giving", "counselling", "music", "care", "store", "links", "contact"];
  const nav = order.filter((id) => present[id]);
  const anchor = (id: SectionId) => `church-${id}`;
  // "See more" opens the section's landing page; the dashboard preview has no page to open, so it draws no link
  const see = (kind: ChurchLandingKind): string | undefined => (preview ? undefined : landingPath(profile.username, kind));
  // the group pages and the Pastors page have their own addresses beside the landing pages
  const seePage = (page: "groups" | "pastors" | "bible-year" | "give"): string | undefined => (preview ? undefined : `/${encodeURIComponent(profile.username)}/church/${page}`);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Save Contact reuses the shared vCard builder and click handler (the same as the Music page); it needs a number to be worth saving, like SaveContactButton.
  const vcardHref = wa || phone ? `data:text/vcard;charset=utf-8,${encodeURIComponent(buildVCard(profile, typeof window !== "undefined" ? window.location.href : undefined))}` : null;
  const waHref = wa ?`https://wa.me/${wa.replace(/[^0-9]/g, "")}${profile.default_whatsapp_message ? `?text=${encodeURIComponent(profile.default_whatsapp_message)}` : ""}` : null;
  const btnBase = "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full px-5 text-[0.95rem] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.98] motion-reduce:active:scale-100";
  // These buttons sit in the hero, so their focus ring reads on the hero background; an accent too close to the hero colour gets an edge so the button never disappears.
  const filled = { backgroundColor: pal.accent, color: pal.onAccent, outlineColor: hero.accentText, border: `1.5px solid ${contrastRatio(accent, hero.bg) < 3 ? hero.ink : "transparent"}` } as const;
  const outline = { border: `1.5px solid ${CH.line}`, color: CH.ink, backgroundColor: CH.surface, outlineColor: hero.accentText } as const;
  // The primary hero action is "Plan a visit" when the church says when and where it meets; otherwise WhatsApp takes that place.
  const waPrimary = !churchVisit && !!waHref;

  const sectionCls = "scroll-mt-24";
  const sharedHeadings = "[&_h2]:![font-family:var(--ch-serif)] [&_h2]:!text-[1.4rem] sm:[&_h2]:!text-[1.65rem] [&_h2]:!font-semibold [&_h2]:!normal-case [&_h2]:!leading-tight [&_h2]:!tracking-[-0.01em] [&_h2]:!opacity-100";

  return (
    <div
      className="church-site relative w-full overflow-x-clip"
      style={{ backgroundColor: CH.paper, color: CH.ink, ["--ch-serif" as any]: SERIF, ["--theme" as any]: accent }}
    >
      {/* The display serif, loaded only on church pages. */}
      <link rel="stylesheet" href={SERIF_HREF} />
      <style>{`.church-site ::selection{background:${pal.accentWash};color:${CH.ink}}.church-site :focus-visible{outline-color:${pal.accentText}}`}</style>

      {/* ---------------------------------------------------------------- top bar: identity + section navigation */}
      <div className="sticky top-0 z-30 border-b backdrop-blur-sm" style={{ borderColor: CH.line, backgroundColor: hexToRgba(CH.paper, 0.94) }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <a href={preview ? undefined : "#top"} className="flex min-w-0 items-center gap-2.5 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ outlineColor: pal.accentText }}>
            {profile.avatar_url ? (
              <OptImg src={profile.avatar_url} alt="" widths={[64, 128]} sizes="36px" square className={`h-9 w-9 shrink-0 object-cover ${avatarRadius(avatarShape, "hero")}`} style={{ backgroundColor: CH.surface }} />
            ) : (
              <Monogram name={name} accent={accent} className={`h-9 w-9 text-base ${avatarRadius(avatarShape, "hero")}`} />
            )}
            <span className="truncate text-[1.05rem] font-semibold" style={{ fontFamily: SERIF }}>
              {name}
            </span>
          </a>

          {nav.length > 0 && (
            <nav aria-label={s.navLabel} className="ml-auto hidden xl:block">
              <ul className="flex items-center gap-0.5">
                {nav.map((id) => (
                  <li key={id}>
                    <a href={`#${anchor(id)}`} className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors hover:bg-black/[0.05] focus-visible:outline focus-visible:outline-2" style={{ outlineColor: pal.accentText }}>
                      {s.sections[id]}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <div className={`flex shrink-0 items-center gap-1.5 ${nav.length > 0 ? "ml-auto xl:ml-2" : "ml-auto"}`}>
            {!preview && (
              <>
                <FanRecognitionHeader username={profile.username} creatorName={name} accent={accent} isOwner={isOwner} />
                <PublicLanguageSelector variant="bar" accent={accent} />
                <ShareButton
                  accent={accent}
                  title={name}
                  strings={{
                    share: t.profilePage.share,
                    copyLink: t.profilePage.copyLink,
                    linkCopied: t.profilePage.linkCopied,
                    shareWhatsapp: t.profilePage.shareWhatsapp,
                    shareFacebook: t.profilePage.shareFacebook,
                    shareX: t.profilePage.shareX,
                    moreOptions: t.profilePage.moreOptions,
                    showQrCode: t.profilePage.showQrCode,
                    qrCodeTitle: t.profilePage.qrCodeTitle,
                    qrCodeSubtitle: t.profilePage.qrCodeSubtitle,
                    qrCodeError: t.profilePage.qrCodeError,
                    downloadQrCode: t.profilePage.downloadQrCode,
                    close: t.profilePage.close,
                  }}
                />
              </>
            )}
            {nav.length > 0 && (
              <button
                ref={menuButton}
                type="button"
                aria-expanded={menuOpen}
                aria-controls="church-site-menu"
                onClick={() => setMenuOpen((o) => !o)}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-full border px-3 text-sm font-semibold transition-colors hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2 sm:px-4 xl:hidden"
                style={{ borderColor: CH.line, backgroundColor: CH.surface, outlineColor: pal.accentText }}
              >
                {menuOpen ? <X size={17} aria-hidden="true" /> : <Menu size={17} aria-hidden="true" />}
                <span className="sr-only sm:not-sr-only">{menuOpen ? s.closeMenu : s.menu}</span>
              </button>
            )}
          </div>
        </div>

        {/* Below xl the sections open as a panel under the bar: every destination visible at once, in two columns, never a sideways scroll. */}
        {nav.length > 0 && menuOpen && (
          <nav id="church-site-menu" aria-label={s.navLabel} className="border-t xl:hidden" style={{ borderColor: CH.line, backgroundColor: CH.paper }}>
            <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-1.5 px-4 py-4 sm:grid-cols-3 sm:px-6">
              {nav.map((id) => (
                <li key={id}>
                  <a
                    href={`#${anchor(id)}`}
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-[52px] items-center rounded-2xl border px-4 text-[0.95rem] font-semibold transition-colors hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2"
                    style={{ borderColor: CH.line, backgroundColor: CH.surface, outlineColor: pal.accentText }}
                  >
                    {s.sections[id]}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>

      {/* ---------------------------------------------------------------- hero: the church's face and the ways to come */}
      <header id="top" className="relative" style={{ ...getBackgroundStyle(hero.gradient ? "gradient" : "solid", hero.bg, hero.bgEnd), color: hero.ink }}>
        <div className={`relative w-full overflow-hidden ${profile.cover_image_url ? "h-[208px] sm:h-[300px] lg:h-[360px]" : "h-[120px] sm:h-[150px]"}`} >
          {profile.cover_image_url ? (
            // the photo fades out with a mask, so it blends into whatever the owner's background is (a solid colour or a gradient) with no seam
            <OptImg src={profile.cover_image_url} widths={[480, 768, 1280, 1920]} sizes="100vw" priority className="h-full w-full object-cover [mask-image:linear-gradient(to_bottom,#000_50%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,#000_50%,transparent)]" />
          ) : (
            <div aria-hidden="true" className="absolute inset-0" style={{ background: `radial-gradient(120% 140% at 85% 0%, ${hexToRgba(accent, 0.28)}, transparent 60%)` }} />
          )}
        </div>

        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="relative -mt-12 sm:-mt-16">
            {profile.avatar_url ? (
              <OptImg
                src={profile.avatar_url}
                alt={name}
                widths={[160, 320, 480]}
                sizes="(min-width: 640px) 128px, 96px"
                square
                priority
                className={`h-24 w-24 object-cover shadow-[0_10px_30px_-12px_rgba(28,25,21,0.45)] ring-4 sm:h-32 sm:w-32 ${avatarRadius(avatarShape, "hero")}`}
                style={{ backgroundColor: CH.surface, ["--tw-ring-color" as any]: hero.bg }}
              />
            ) : (
              <Monogram name={name} accent={accent} ringColor={hero.bg} className={`h-24 w-24 text-[2.4rem] shadow-[0_10px_30px_-12px_rgba(28,25,21,0.45)] ring-4 sm:h-32 sm:w-32 sm:text-[3rem] ${avatarRadius(avatarShape, "hero")}`} />
            )}
          </div>

          <div className="mt-4 max-w-3xl pb-10 sm:pb-14">
            {churchType && (
              <p className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: hexToRgba(hero.accentText, 0.5), color: hero.accentText }}>
                {churchType}
              </p>
            )}
            <h1 className="mt-3 flex max-w-full items-start gap-2 text-[2.15rem] font-semibold leading-[1.08] tracking-[-0.02em] [text-wrap:balance] sm:text-[3rem]" style={{ fontFamily: SERIF }}>
              <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
              {profile.verified && (
                <BadgeCheck size={24} className="mt-2 shrink-0" style={{ color: "#3B82F6", fill: "#3B82F6", stroke: hero.bg }} aria-label={t.profilePage.verifiedBadge}>
                  <title>{t.profilePage.verifiedBadge}</title>
                </BadgeCheck>
              )}
            </h1>
            {profile.is_demo && (
              <p className="mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: "#F59E0B", color: "#111827" }}>
                {t.demo.publicBadge}
              </p>
            )}
            {profile.bio && <p className="mt-3 max-w-[52ch] text-[1.1rem] leading-relaxed sm:text-[1.2rem]" style={{ color: hero.ink }}>{profile.bio}</p>}
            {profile.about_long_bio && <p className="mt-4 max-w-[65ch] text-[0.975rem] leading-[1.7] whitespace-pre-line [overflow-wrap:anywhere]">{profile.about_long_bio}</p>}

            {staffBadges.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {staffBadges.map((badge) => (
                  <a key={badge.orgUsername} href={`/${badge.orgUsername}`} className={`flex min-h-[36px] items-center gap-1.5 rounded-full border py-1 pr-3 text-xs font-medium transition hover:opacity-75 ${badge.orgAvatarUrl ? "pl-1.5" : "pl-3"}`} style={{ borderColor: hexToRgba(hero.ink, 0.3), color: hero.accentText }}>
                    {badge.orgAvatarUrl && <img src={badge.orgAvatarUrl} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />}
                    {t.profilePage.staffBadge(badge.roleName, badge.orgName)}
                  </a>
                ))}
              </div>
            )}

            {(churchVisit || waHref || phone) && (
              <div className="mt-6 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
                {churchVisit && (
                  <a href={`#${anchor("visit")}`} className={`${btnBase} col-span-2 hover:brightness-95 sm:col-span-1`} style={filled}>
                    {s.planVisit}
                  </a>
                )}
                {waHref && (
                  <a
                    href={preview ? undefined : waHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.whatsappAria(name)}
                    onClick={onWhatsappClick}
                    className={`${btnBase} ${waPrimary ? "col-span-2 hover:brightness-95 sm:col-span-1" : "hover:bg-black/[0.03]"}`}
                    style={waPrimary ? filled : outline}
                  >
                    <FaWhatsapp size={17} className="shrink-0" style={{ color: waPrimary ? pal.onAccent : "#128C4B" }} aria-hidden="true" />
                    {s.whatsapp}
                  </a>
                )}
                {phone && (
                  <a href={preview ? undefined : `tel:${phone.replace(/[^0-9+]/g, "")}`} aria-label={s.callAria(name)} className={`${btnBase} hover:bg-black/[0.03]`} style={outline}>
                    <Phone size={16} className="shrink-0" aria-hidden="true" />
                    {s.call}
                  </a>
                )}
                {vcardHref && (
                  <a
                    href={preview ? undefined : vcardHref}
                    download={preview ? undefined : vCardFileName(profile)}
                    onClick={(e) => (preview ? e.preventDefault() : saveContactClick(e, profile))}
                    className={`${btnBase} hover:bg-black/[0.03]`}
                    style={outline}
                  >
                    <UserPlus size={16} className="shrink-0" aria-hidden="true" />
                    {t.profilePage.saveContactButton}
                  </a>
                )}
                {churchVisit?.directionsUrl && (
                  <a href={preview ? undefined : churchVisit.directionsUrl} target="_blank" rel="noopener noreferrer" className={`${btnBase} hover:bg-black/[0.03]`} style={outline}>
                    <Navigation size={16} className="shrink-0" aria-hidden="true" />
                    {s.getDirections}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------------- the church's content */}
      <div id={preview ? undefined : "profile-content"} tabIndex={preview ? undefined : -1} className="focus:outline-none">
        <div className="mx-auto flex max-w-6xl flex-col gap-14 px-4 pb-16 sm:gap-20 sm:px-6">
          {churchVisit && (
            <div id={anchor("visit")} className={sectionCls}>
              <ChurchVisitCard t={t} visit={churchVisit} {...card} surface={CH.surface} />
            </div>
          )}

          {(churchPublic.services ?? []).length > 0 && (
            <div id="church-services" className={sectionCls}>
              <ChurchServicesCard t={t} locale={locale} services={churchPublic.services} {...card} surface={CH.surface} />
            </div>
          )}

          {hasNews && (
            <div id={anchor("news")} className={`${sectionCls} grid gap-12 lg:gap-14 ${churchPublic.events.length > 0 && churchPublic.announcements.length > 0 ? "lg:grid-cols-[1fr_1.45fr]" : ""}`}>
              {/* the notes first (they are short and current), then the dated events in the wider column */}
              {churchPublic.announcements.length > 0 && <ChurchAnnouncementsCard t={t} locale={locale} announcements={churchPublic.announcements} rotate seeMoreHref={see("announcements")} {...card} />}
              {churchPublic.events.length > 0 && <ChurchEventsCard t={t} locale={locale} events={churchPublic.events} seeMoreHref={see("events")} {...card} />}
            </div>
          )}

          {dailyWords.length > 0 && (
            <div id={anchor("word")} className={`${sectionCls} max-w-3xl`}>
              <DailyWordCard t={t} locale={locale} words={dailyWords} {...card} />
            </div>
          )}

          {groups.length > 0 && (
            <div id={anchor("groups")} className={sectionCls}>
              <ChurchGroupsCard t={t} locale={locale} groups={groups} username={profile.username} seeMoreHref={seePage("groups")} {...card} />
            </div>
          )}

          {pastors.length > 0 && (
            <div id={anchor("pastors")} className={sectionCls}>
              <ChurchPastorsCard t={t} locale={locale} pastors={pastors} seeMoreHref={seePage("pastors")} {...card} />
            </div>
          )}

          {present.testimonies && (
            <div id={anchor("testimonies")} className={`${sectionCls} flex flex-col gap-4`}>
              {testimonies.length > 0 && (
                <ChurchTestimoniesCard
                  t={t}
                  testimonies={testimonies}
                  accent={accent}
                  accentText={pal.accentOnNight}
                  textColor={CH.nightText}
                  borderTint="rgba(244, 238, 228, 0.16)"
                  radiusClass="rounded-[28px]"
                  surface={CH.night}
                  seeMoreHref={see("testimonies")}
                />
              )}
              {!preview && <ShareTestimony t={t} locale={locale} username={profile.username} {...card} />}
            </div>
          )}

          {churchPublic.programs.length > 0 && (
            <div id={anchor("bible")} className={sectionCls}>
              <ChurchBibleCard t={t} locale={locale} programs={churchPublic.programs} seeMoreHref={see("bible")} {...card} />
            </div>
          )}

          {present.bibleYear && (
            <div id={anchor("bibleYear")} className={sectionCls}>
              <ChurchBibleYearCard t={t} href={seePage("bible-year")} accent={pal.accent} accentText={pal.accentText} textColor={CH.ink} borderTint={CH.line} radiusClass="rounded-[22px]" />
            </div>
          )}

          {present.giving && (
            <div id={anchor("giving")} className={sectionCls}>
              <ChurchGiveCard t={t} href={seePage("give")} accent={pal.accent} accentText={pal.accentText} textColor={CH.ink} borderTint={CH.line} radiusClass="rounded-[22px]" />
            </div>
          )}

          {present.counselling && (
            <div id={anchor("counselling")} className={`${sectionCls} max-w-2xl`}>
              <ChurchCounsellingForm username={profile.username} accent={pal.accent} accentText={pal.accentText} textColor={CH.ink} borderTint={CH.line} radiusClass="rounded-[22px]" preview={preview} />
            </div>
          )}

          {churchPublic.music.length > 0 && (
            <div id={anchor("music")} className={sectionCls}>
              <ChurchMusicCard t={t} links={churchPublic.music} {...card} />
            </div>
          )}

          {care.length > 0 && (
            <div id={anchor("care")} className={sectionCls}>
              <ChurchCareCard t={t} locale={locale} cases={care} seeMoreHref={see("care")} {...card} />
            </div>
          )}

          {shared.catalog && (
            <div id={anchor("store")} className={`${sectionCls} max-w-3xl ${sharedHeadings}`}>
              {shared.catalog}
            </div>
          )}

          {shared.links && (
            <div id={anchor("links")} className={`${sectionCls} max-w-2xl ${sharedHeadings}`}>
              {shared.links}
            </div>
          )}

          {hasContact && (
            <section id={anchor("contact")} aria-labelledby="church-contact-heading" className={`${sectionCls} grid gap-6 lg:grid-cols-[1fr_1fr] lg:items-start`}>
              <div className="flex flex-col gap-5">
                <h2 id="church-contact-heading" className="text-[1.65rem] font-semibold leading-tight tracking-[-0.01em]" style={{ fontFamily: SERIF }}>
                  {s.contactTitle}
                </h2>
                {shared.about}
                {socialLinks.length > 0 && (
                  <div className="flex flex-wrap gap-2.5">
                    {socialLinks.map((x: any) => (
                      <SocialIcon key={x.id} platform={x.platform} url={x.url} themed />
                    ))}
                  </div>
                )}
              </div>
              {!isOwner && (
                <div className="lg:pt-14">
                  <ConnectButton profile={{ id: profile.id, name }} accent={accent} radiusClass="rounded-[22px]" buttonStyle={outline} borderTint={CH.line} textColor={CH.ink} preview={preview} variant="card" />
                  <div className="mt-4">
                    <ChurchMembershipJoin profile={{ id: profile.id, name }} accent={pal.accent} accentText={pal.accentText} textColor={CH.ink} borderTint={CH.line} radiusClass="rounded-[22px]" preview={preview} />
                  </div>
                  <div className="mt-4">
                    <ChurchNotificationsCard profile={{ id: profile.id, name }} accent={pal.accent} accentText={pal.accentText} textColor={CH.ink} borderTint={CH.line} radiusClass="rounded-[22px]" preview={preview} />
                  </div>
                </div>
              )}
            </section>
          )}

          {!preview && (
            <div className="max-w-2xl">
              <AddToHomeScreen displayName={name} username={profile.username} accent={accent} radiusClass="rounded-[22px]" buttonStyle={outline} borderTint={CH.line} textColor={CH.ink} />
            </div>
          )}
        </div>
      </div>

      <footer role="contentinfo" className="border-t" style={{ borderColor: CH.line }}>
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-8 text-center sm:flex-row sm:justify-between sm:px-6 sm:text-left">
          <div>
            <p className="text-sm" style={{ color: CH.muted }}>
              © {new Date().getFullYear()} {profile.name}. {t.profilePage.rights}
            </p>
            <PoweredByRingo className="mt-1" />
          </div>
          {!preview && (
            <a href="#top" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2" style={{ color: pal.accentText, outlineColor: pal.accentText }}>
              <ArrowUp size={15} aria-hidden="true" />
              {s.backToTop}
            </a>
          )}
        </div>
      </footer>
    </div>
  );
}
