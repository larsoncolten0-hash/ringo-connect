"use client";

import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import PublicLanguageSelector from "@/components/PublicLanguageSelector";
import PoweredByRingo from "@/components/PoweredByRingo";
import OptImg from "@/components/ui/OptImg";
import type { PublicAbout, PublicGroup, PublicGroupPage, PublicPastor } from "@/lib/church/public/groups";
import Monogram from "./Monogram";
import { ChurchGroupBody, ChurchGroupsCard } from "./ChurchGroupsPublic";
import { ChurchPastorsBody } from "./ChurchPastorsPublic";
import ChurchBibleYearBody from "./ChurchBibleYearBody";
import ChurchGiveBody from "./ChurchGiveBody";
import type { PublicFund } from "@/lib/church/public/giving";
import { CH, SERIF, SERIF_HREF, churchCardTheme, churchPalette } from "./churchTheme";

// The pages the church expansion adds to a church's public site, in the church's own template (linen, serif): the groups index, one group, and the Pastors page. Each is the same frame as a landing
// page: a slim bar with the church's name (a link back to its page) and the language choice, one back link, the content with its single <h1>, and the footer. It draws only what the loaders gave it
// (published only) and an empty state when there is nothing, so a page never looks broken.

export type ChurchExpansionPageData =
  | { mode: "groups"; groups: PublicGroup[] }
  | { mode: "group"; page: PublicGroupPage }
  | { mode: "pastors"; pastors: PublicPastor[]; about: PublicAbout | null }
  | { mode: "bibleYear"; profile: { id: string; name: string } }
  | { mode: "give"; funds: PublicFund[] };

export default function ChurchExpansionPage({ church, data }: { church: { name: string; username: string; avatarUrl: string | null; accent: string }; data: ChurchExpansionPageData }) {
  const { t, locale } = useLanguage();
  const s = t.churchSite.public;
  const pal = churchPalette(church.accent);
  const card = churchCardTheme(pal);
  const home = `/${encodeURIComponent(church.username)}`;
  const g = t.churchExpansion.groups.public;
  const backHref = data.mode === "group" ? `${home}/church/groups` : home;
  const backLabel = data.mode === "group" ? g.back : s.landing.backTo(church.name);
  const lang = locale === "fr" ? "fr" : "en";
  const common = { t, locale: lang as "en" | "fr", ...card };

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
        <a href={backHref} className="-ml-2 mb-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-sm font-semibold transition-colors hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2" style={{ color: pal.accentText, outlineColor: pal.accentText }}>
          <ArrowLeft size={16} aria-hidden="true" />
          {backLabel}
        </a>

        {data.mode === "groups" ? (
          data.groups.length > 0 ? (
            <ChurchGroupsCard {...common} groups={data.groups} username={church.username} headingLevel="h1" intro={g.intro} />
          ) : (
            <Empty title={g.title} body={g.empty} />
          )
        ) : data.mode === "group" ? (
          <ChurchGroupBody {...common} page={data.page} />
        ) : data.mode === "give" ? (
          <ChurchGiveBody church={church} funds={data.funds} theme={card} />
        ) : data.mode === "bibleYear" ? (
          <ChurchBibleYearBody profile={data.profile} username={church.username} theme={card} />
        ) : data.pastors.length > 0 ? (
          <ChurchPastorsBody {...common} pastors={data.pastors} about={data.about} />
        ) : (
          <Empty title={t.churchExpansion.pastors.public.title} body={t.churchExpansion.pastors.public.empty} />
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

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <section aria-labelledby="church-expansion-empty">
      <h1 id="church-expansion-empty" className="text-[2rem] font-semibold leading-tight tracking-[-0.01em] sm:text-[2.4rem]" style={{ fontFamily: SERIF }}>
        {title}
      </h1>
      <p className="mt-4 max-w-[60ch] rounded-2xl border border-dashed px-5 py-6 text-[0.975rem] leading-relaxed" style={{ borderColor: CH.line, color: CH.muted }}>
        {body}
      </p>
    </section>
  );
}
