"use client";

import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchLandingData, ChurchLandingKind } from "@/lib/church/public/landing";
import PublicLanguageSelector from "@/components/PublicLanguageSelector";
import PoweredByRingo from "@/components/PoweredByRingo";
import OptImg from "@/components/ui/OptImg";
import { ChurchAnnouncementsCard, ChurchEventsCard } from "@/components/church/ChurchEventsCards";
import ChurchBibleCard from "@/components/church/ChurchBibleCard";
import ChurchCareCard from "@/components/church/ChurchCareCard";
import ChurchTestimoniesList from "@/components/church/ChurchTestimoniesList";
import Monogram from "./Monogram";
import { CH, SERIF, SERIF_HREF, churchCardTheme, churchPalette } from "./churchTheme";

// A church's LANDING page for one module (/{username}/church/{kind}): the full list behind a "See more" button on the church page. It is the church's own template (linen, serif), a slim bar with the
// church's name (a link back to its page) and the language choice, one back link, the module's list as the page's single <h1>, and the footer. It draws only what the loaders gave it (published only,
// consent where it applies, expiry in Cameroon time) and an empty state when there is nothing, so a landing page never looks broken.
export default function ChurchLandingView({ kind, church, data }: { kind: ChurchLandingKind; church: { name: string; username: string; avatarUrl: string | null; accent: string }; data: ChurchLandingData }) {
  const { t, locale } = useLanguage();
  const s = t.churchSite.public;
  const L = s.landing;
  const pal = churchPalette(church.accent);
  const card = churchCardTheme(pal);
  const home = `/${encodeURIComponent(church.username)}`;
  const empty = data.announcements.length + data.events.length + data.testimonies.length + data.care.length + data.programs.length === 0;
  const intro = L.intro[kind];

  return (
    <div className="church-site min-h-screen w-full overflow-x-clip" style={{ backgroundColor: CH.paper, color: CH.ink }}>
      <link rel="stylesheet" href={SERIF_HREF} />
      <header className="sticky top-0 z-30 border-b" style={{ borderColor: CH.line, backgroundColor: "rgba(247, 242, 233, 0.95)" }}>
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4 sm:px-6">
          <a href={home} className="flex min-w-0 items-center gap-2.5 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ outlineColor: pal.accentText }}>
            {church.avatarUrl ? <OptImg src={church.avatarUrl} alt="" widths={[64, 128]} sizes="36px" square className="h-9 w-9 shrink-0 rounded-full object-cover" /> : <Monogram name={church.name} accent={church.accent} className="h-9 w-9 rounded-full text-base" />}
            <span className="truncate text-[1.05rem] font-semibold" style={{ fontFamily: SERIF }}>
              {church.name}
            </span>
          </a>
          <div className="ml-auto shrink-0">
            <PublicLanguageSelector variant="bar" accent={church.accent} />
          </div>
        </div>
      </header>

      <main id="profile-content" className="mx-auto max-w-4xl px-4 pb-16 pt-5 sm:px-6">
        <a href={home} className="-ml-2 mb-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-sm font-semibold transition-colors hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2" style={{ color: pal.accentText, outlineColor: pal.accentText }}>
          <ArrowLeft size={16} aria-hidden="true" />
          {L.backTo(church.name)}
        </a>

        {empty ? (
          <section aria-labelledby="church-landing-empty">
            <h1 id="church-landing-empty" className="text-[2rem] font-semibold leading-tight tracking-[-0.01em] sm:text-[2.4rem]" style={{ fontFamily: SERIF }}>
              {L.titles[kind]}
            </h1>
            <p className="mt-4 max-w-[60ch] rounded-2xl border border-dashed px-5 py-6 text-[0.975rem] leading-relaxed" style={{ borderColor: CH.line, color: CH.muted }}>
              {L.empty[kind]}
            </p>
          </section>
        ) : kind === "announcements" ? (
          <ChurchAnnouncementsCard t={t} locale={locale} announcements={data.announcements} grouped headingLevel="h1" intro={intro} {...card} />
        ) : kind === "events" ? (
          <ChurchEventsCard t={t} locale={locale} events={data.events} headingLevel="h1" intro={intro} {...card} />
        ) : kind === "testimonies" ? (
          <ChurchTestimoniesList t={t} testimonies={data.testimonies} intro={intro} {...card} />
        ) : kind === "care" ? (
          <ChurchCareCard t={t} locale={locale} cases={data.care} headingLevel="h1" {...card} />
        ) : (
          <ChurchBibleCard t={t} locale={locale} programs={data.programs} headingLevel="h1" intro={intro} {...card} />
        )}
      </main>

      <footer role="contentinfo" className="border-t" style={{ borderColor: CH.line }}>
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-2 px-4 py-8 text-center sm:px-6">
          <p className="text-sm" style={{ color: CH.muted }}>
            © {new Date().getFullYear()} {church.name}. {t.profilePage.rights}
          </p>
          <PoweredByRingo className="mt-1" />
        </div>
      </footer>
    </div>
  );
}
