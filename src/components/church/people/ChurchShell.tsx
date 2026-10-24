"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";

// The sections whose content is (or becomes) PUBLIC on the church page: they carry their own explanation, so the privacy line of the private sections is not repeated there.
const PUBLIC_SECTIONS = ["/dashboard/church/content", "/dashboard/church/events", "/dashboard/church/announcements", "/dashboard/church/bible", "/dashboard/church/music", "/dashboard/church/reports", "/dashboard/church/care", "/dashboard/church/store"];

// Heading and section tabs of the church workspace (/dashboard/church/**). A tab only appears for a section the signed-in person may open; the server re-checks on every page and every request.
// `isOwner` only decides whether the Store tab is offered: the Shop it links to is owner-only.
export default function ChurchShell({ caps, isOwner = false, children }: { caps: ChurchCapabilities; isOwner?: boolean; children: React.ReactNode }) {
  const { t } = useLanguage();
  const c = t.churchPeople;
  const pathname = usePathname() ?? "";
  const tabs = [
    { href: "/dashboard/church/people", label: c.tabs.people, show: caps.viewMembers || caps.viewChildren },
    { href: "/dashboard/church/groups", label: c.tabs.groups, show: caps.viewGroups },
    { href: "/dashboard/church/leadership", label: c.tabs.leadership, show: caps.viewLeadership },
    { href: "/dashboard/church/content", label: t.churchContent.tab, show: caps.viewContent },
    { href: "/dashboard/church/events", label: t.churchWorkspace.tabs.events, show: caps.viewEvents },
    { href: "/dashboard/church/announcements", label: t.churchWorkspace.tabs.announcements, show: caps.viewEvents },
    { href: "/dashboard/church/bible", label: t.churchWorkspace.tabs.bible, show: caps.viewBible },
    { href: "/dashboard/church/attendance", label: t.churchWorkspace.tabs.attendance, show: caps.viewAttendance },
    { href: "/dashboard/church/music", label: t.churchWorkspace.tabs.music, show: caps.manageMusic },
    { href: "/dashboard/church/reports", label: t.churchWorkspace.tabs.reports, show: caps.viewReports },
    { href: "/dashboard/church/care", label: t.churchWorkspace.tabs.care, show: caps.viewCare },
    { href: "/dashboard/church/store", label: t.churchWorkspace.tabs.store, show: isOwner },
  ].filter((x) => x.show);

  return (
    <div className="max-w-4xl">
      <header className="mb-5">
        <h1 className="font-display text-xl font-semibold text-ringo-text">{c.title}</h1>
        {/* People, Groups and Leadership are private. The Content tab is the opposite (its words become public once published) and says so itself, so the privacy line is not repeated there. */}
        {!PUBLIC_SECTIONS.some((p) => pathname.startsWith(p)) && (
          <p className="mt-1 flex items-start gap-2 text-sm leading-relaxed text-ringo-muted">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-ringo-indigo" aria-hidden="true" />
            <span>{c.subtitle}</span>
          </p>
        )}
      </header>
      <nav aria-label={c.tabsLabel} className="mb-5 -mx-1 overflow-x-auto px-1">
        <ul className="flex min-w-max gap-1 border-b border-ringo-border/70">
          {tabs.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative inline-flex min-h-[44px] items-center px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 ${active ? "text-ringo-indigo after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-ringo-indigo" : "text-ringo-muted hover:text-ringo-text"}`}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {children}
    </div>
  );
}

export function NoAccess({ section }: { section?: "people" | "groups" | "leadership" | "content" | "events" | "bible" | "attendance" | "music" | "reports" | "care" | "store" }) {
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
