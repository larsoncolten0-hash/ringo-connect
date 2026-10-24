"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Award, BarChart3, BookOpen, CalendarDays, ChevronDown, ChevronLeft, ClipboardCheck, HeartHandshake, LayoutGrid, Megaphone, MessageSquareQuote, Music2, Network, PenLine, ShieldCheck, ShoppingBag, Users, type LucideIcon } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import type { Translations } from "@/lib/i18n/translations";

// The sections whose content is (or becomes) PUBLIC on the church page: they carry their own explanation, so the privacy line of the private sections is not repeated there.
const PUBLIC_SECTIONS = ["/dashboard/church/content", "/dashboard/church/events", "/dashboard/church/announcements", "/dashboard/church/bible", "/dashboard/church/music", "/dashboard/church/reports", "/dashboard/church/care", "/dashboard/church/testimonies", "/dashboard/church/store"];

export const CHURCH_HOME = "/dashboard/church";

export type ChurchModuleKey = "people" | "groups" | "leadership" | "content" | "events" | "announcements" | "bible" | "attendance" | "music" | "reports" | "care" | "testimonies" | "store";
export type ChurchModuleGroup = "community" | "ministry" | "care" | "business";
export interface ChurchModule {
  key: ChurchModuleKey;
  href: string;
  label: string;
  group: ChurchModuleGroup;
  icon: LucideIcon;
}

export const CHURCH_GROUP_ORDER: ChurchModuleGroup[] = ["community", "ministry", "care", "business"];

/** Every church section the signed-in person may open, in one fixed order, each with its group (People & community, Ministry & worship, Care & insight, Church business).
 *  The one list behind the section navigation AND the church home grid, so the two can never disagree. A section only appears for a person allowed to open it; the server
 *  re-checks on every page and every request. `isOwner` only decides whether the Store is offered: the Shop it links to is owner-only. */
export function churchModules(t: Translations, caps: ChurchCapabilities, isOwner: boolean): ChurchModule[] {
  const c = t.churchPeople;
  const w = t.churchWorkspace.tabs;
  const tabs = [
    { key: "people", href: "/dashboard/church/people", label: c.tabs.people, group: "community", icon: Users, show: caps.viewMembers || caps.viewChildren },
    { key: "groups", href: "/dashboard/church/groups", label: c.tabs.groups, group: "community", icon: Network, show: caps.viewGroups },
    { key: "leadership", href: "/dashboard/church/leadership", label: c.tabs.leadership, group: "community", icon: Award, show: caps.viewLeadership },
    { key: "content", href: "/dashboard/church/content", label: t.churchContent.tab, group: "ministry", icon: PenLine, show: caps.viewContent },
    { key: "events", href: "/dashboard/church/events", label: w.events, group: "ministry", icon: CalendarDays, show: caps.viewEvents },
    { key: "announcements", href: "/dashboard/church/announcements", label: w.announcements, group: "ministry", icon: Megaphone, show: caps.viewEvents },
    { key: "bible", href: "/dashboard/church/bible", label: w.bible, group: "ministry", icon: BookOpen, show: caps.viewBible },
    { key: "attendance", href: "/dashboard/church/attendance", label: w.attendance, group: "ministry", icon: ClipboardCheck, show: caps.viewAttendance },
    { key: "music", href: "/dashboard/church/music", label: w.music, group: "ministry", icon: Music2, show: caps.manageMusic },
    { key: "reports", href: "/dashboard/church/reports", label: w.reports, group: "care", icon: BarChart3, show: caps.viewReports },
    { key: "care", href: "/dashboard/church/care", label: w.care, group: "care", icon: HeartHandshake, show: caps.viewCare },
    { key: "testimonies", href: "/dashboard/church/testimonies", label: w.testimonies, group: "care", icon: MessageSquareQuote, show: caps.viewTestimonies },
    { key: "store", href: "/dashboard/church/store", label: w.store, group: "business", icon: ShoppingBag, show: isOwner },
  ] as const;
  return tabs.filter((x) => x.show).map(({ show: _show, ...m }) => m as ChurchModule);
}

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

// The church workspace (/dashboard/church/**). On the church home the module grid IS the navigation, so the shell adds nothing there. On a section page the sections are ONE
// list: a sidebar on a wide screen, and on a phone a "All sections" panel that opens in place as a two-column grid. Every section is reachable without a sideways scroll.
export default function ChurchShell({ caps, isOwner = false, children }: { caps: ChurchCapabilities; isOwner?: boolean; children: React.ReactNode }) {
  const { t } = useLanguage();
  const c = t.churchPeople;
  const h = t.churchSite.home;
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const modules = churchModules(t, caps, isOwner);

  if (pathname === CHURCH_HOME) return <div className="mx-auto max-w-6xl">{children}</div>;

  const current = modules.find((m) => isActive(pathname, m.href));
  const groups = CHURCH_GROUP_ORDER.map((g) => ({ g, items: modules.filter((m) => m.group === g) })).filter((x) => x.items.length > 0);
  // with a single section there is no home grid to return to (the church index opens that section directly)
  const showHome = modules.length > 1;
  const CurrentIcon = current?.icon ?? LayoutGrid;

  return (
    <div className="mx-auto max-w-6xl lg:grid lg:grid-cols-[228px_minmax(0,1fr)] lg:gap-10">
      <nav aria-label={c.tabsLabel} className="mb-5 lg:sticky lg:top-6 lg:mb-0 lg:self-start">
        {showHome && (
          <Link
            href={CHURCH_HOME}
            className="mb-3 hidden min-h-[44px] items-center gap-2 rounded-xl px-3 text-sm font-semibold text-ringo-muted transition hover:bg-ringo-surface hover:text-ringo-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 lg:flex"
          >
            <LayoutGrid size={16} aria-hidden="true" />
            {h.crumbHome}
          </Link>
        )}
        {/* phone and tablet: the current section, and one button that opens every section in place */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="church-sections"
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-ringo-border bg-ringo-surface px-4 text-left transition hover:border-ringo-indigo/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 lg:hidden"
        >
          <CurrentIcon size={18} className="shrink-0 text-ringo-indigo" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ringo-text">{current?.label ?? h.allSections}</span>
          {current && <span className="shrink-0 text-xs font-semibold text-ringo-muted">{h.allSections}</span>}
          <ChevronDown size={16} className={`shrink-0 text-ringo-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        <div id="church-sections" className={`${open ? "block" : "hidden"} mt-2 rounded-2xl border border-ringo-border bg-ringo-surface p-3 lg:mt-0 lg:block lg:border-0 lg:bg-transparent lg:p-0`}>
          {groups.map(({ g, items }) => (
            <div key={g} className="mb-3 last:mb-0 lg:mb-5">
              <p className="px-1 pb-1.5 text-xs font-semibold text-ringo-muted lg:px-3">{h.groups[g]}</p>
              <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-1 lg:gap-0.5">
                {items.map((m) => {
                  const active = isActive(pathname, m.href);
                  const Icon = m.icon;
                  return (
                    <li key={m.href}>
                      <Link
                        href={m.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-[44px] items-center gap-2.5 rounded-xl px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 ${active ? "bg-ringo-indigo/10 text-ringo-indigo" : "text-ringo-muted hover:bg-ringo-surface hover:text-ringo-text lg:hover:bg-ringo-border/40"}`}
                      >
                        <Icon size={16} className="shrink-0" aria-hidden="true" />
                        <span className="min-w-0 truncate">{m.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="min-w-0">
        <header className="mb-5">
          {showHome && (
            <Link href={CHURCH_HOME} className="-ml-1 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-1 text-sm font-semibold text-ringo-muted transition hover:text-ringo-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 lg:hidden">
              <ChevronLeft size={16} aria-hidden="true" />
              {c.title}
            </Link>
          )}
          <h1 className="font-display text-2xl font-semibold text-ringo-text">{current?.label ?? c.title}</h1>
          {/* People, Groups and Leadership are private. The Content tab is the opposite (its words become public once published) and says so itself, so the privacy line is not repeated there. */}
          {!PUBLIC_SECTIONS.some((p) => pathname.startsWith(p)) && (
            <p className="mt-1 flex items-start gap-2 text-sm leading-relaxed text-ringo-muted">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-ringo-indigo" aria-hidden="true" />
              <span>{c.subtitle}</span>
            </p>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}

export function NoAccess({ section }: { section?: "people" | "groups" | "leadership" | "content" | "events" | "bible" | "attendance" | "music" | "reports" | "care" | "testimonies" | "store" }) {
  const { t } = useLanguage();
  const c = t.churchPeople;
  return (
    <div className="rounded-3xl border border-dashed border-ringo-border bg-ringo-surface/60 px-6 py-12 text-center">
      <h2 className="font-display text-base font-semibold text-ringo-text">{section ? ({ ...c.restricted, ...t.churchWorkspace.restricted } as Record<string, string>)[section] : c.noAccess.title}</h2>
      {!section && <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ringo-muted">{c.noAccess.body}</p>}
      <Link href="/dashboard" className="ringo-tactile mt-5 inline-flex min-h-[44px] items-center justify-center rounded-full border border-ringo-border px-5 text-sm font-semibold text-ringo-text hover:border-ringo-indigo/40">
        {c.noAccess.back}
      </Link>
    </div>
  );
}
