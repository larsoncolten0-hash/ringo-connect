"use client";

import Link from "next/link";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import { CHURCH_GROUP_ORDER, churchModules } from "@/components/church/people/ChurchShell";
import { SERIF } from "@/components/church/site/churchTheme";
import Monogram from "@/components/church/site/Monogram";

// The church dashboard home (/dashboard/church): the church's name and a way to its public page, then every section the signed-in person may open, grouped, as a grid of
// whole-card links (two columns on a phone, one on a very narrow one, three or four on a wide screen). The same list as the section navigation (churchModules), so a
// section never appears here that the person cannot open. Nothing here reads church data beyond the page's own name and picture.
export default function ChurchHome({ caps, isOwner, church }: { caps: ChurchCapabilities; isOwner: boolean; church: { name: string; username: string | null; avatarUrl: string | null } }) {
  const { t } = useLanguage();
  const h = t.churchSite.home;
  const modules = churchModules(t, caps, isOwner);
  const groups = CHURCH_GROUP_ORDER.map((g) => ({ g, items: modules.filter((m) => m.group === g) })).filter((x) => x.items.length > 0);

  return (
    <div>
      <header className="mb-8 flex flex-col gap-4 rounded-3xl border border-ringo-border bg-ringo-surface p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {church.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={church.avatarUrl} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover sm:h-16 sm:w-16" />
          ) : (
            <Monogram name={church.name || h.title} accent="#4F46E5" className="h-14 w-14 rounded-2xl text-2xl sm:h-16 sm:w-16" />
          )}
          <div className="min-w-0">
            <h1 className="truncate text-[1.6rem] font-semibold leading-tight text-ringo-text sm:text-[1.85rem]" style={{ fontFamily: SERIF }}>
              {church.name || h.title}
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-ringo-muted">{h.intro}</p>
          </div>
        </div>
        {church.username && (
          <a
            href={`/${church.username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ringo-tactile inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-full border border-ringo-border px-5 text-sm font-semibold text-ringo-text transition hover:border-ringo-indigo/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40"
          >
            {h.viewPublic}
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        )}
      </header>

      <nav aria-label={h.sectionsLabel} className="flex flex-col gap-8">
        {groups.map(({ g, items }) => (
          <section key={g} aria-labelledby={`church-group-${g}`}>
            <h2 id={`church-group-${g}`} className="mb-3 text-base font-semibold text-ringo-text">
              {h.groups[g]}
            </h2>
            <ul className="grid grid-cols-2 gap-2.5 max-[339px]:grid-cols-1 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((m) => {
                const Icon = m.icon;
                return (
                  <li key={m.href} className="min-w-0">
                    <Link
                      href={m.href}
                      className="group flex h-full min-h-[104px] flex-col rounded-2xl border border-ringo-border bg-ringo-surface p-3.5 transition sm:p-4 hover:-translate-y-0.5 hover:border-ringo-indigo/40 hover:shadow-[0_10px_24px_-16px_rgba(20,17,10,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                    >
                      <span className="flex items-center justify-between">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ringo-indigo/10 text-ringo-indigo">
                          <Icon size={19} aria-hidden="true" />
                        </span>
                        <ChevronRight size={16} className="text-ringo-muted transition group-hover:translate-x-0.5 group-hover:text-ringo-indigo motion-reduce:transition-none" aria-hidden="true" />
                      </span>
                      <span className="mt-3 text-[0.95rem] font-semibold leading-snug text-ringo-text [overflow-wrap:anywhere]">{m.label}</span>
                      <span className="mt-1 text-xs leading-relaxed text-ringo-muted">{({ ...h.modules, ...t.churchExpansion.modules, members: t.churchExpansion.members.module, features: t.churchExpansion.features.module, counselling: t.churchExpansion.counselling.module, giving: t.churchExpansion.giving.module } as Record<string, string>)[m.key]}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>
    </div>
  );
}
