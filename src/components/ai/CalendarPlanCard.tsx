"use client";

import { CalendarDays } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { CalendarPlanView } from "@/lib/ai/content/calendarView";

// The Content Calendar summary card — shown once create_content_calendar
// runs. Unlike DraftCard, nothing here needs a Confirm & Apply: the items
// are already real rows, "planned" (never published) until the owner
// reviews them in the full Content Calendar view this card links to.

const MONTH_NAMES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_NAMES_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export default function CalendarPlanCard({ plan }: { plan: CalendarPlanView }) {
  const { t, locale } = useLanguage();
  const c = t.ringoAi.calendar;
  const monthName = (locale === "fr" ? MONTH_NAMES_FR : MONTH_NAMES_EN)[plan.month - 1] ?? "";

  return (
    <div className="mt-2 rounded-2xl border border-ringo-indigo/25 bg-ringo-surface shadow-[0_8px_24px_-16px_rgba(79,70,229,0.45)] overflow-hidden">
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-gradient-to-r from-ringo-indigo/[0.08] via-fuchsia-500/[0.05] to-transparent border-b border-ringo-border/60">
        <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-ringo-indigo to-fuchsia-500 text-white flex items-center justify-center shrink-0">
          <CalendarDays size={14} />
        </span>
        <p className="flex-1 min-w-0 text-sm font-semibold text-ringo-text truncate">
          {c.cardTitle} — {monthName} {plan.year}
        </p>
      </div>

      <div className="px-3.5 py-3 flex flex-col gap-2.5">
        <p className="text-sm text-ringo-text">{c.cardNote(plan.itemCount)}</p>
        <ul className="flex flex-col gap-1">
          {plan.items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-xs text-ringo-muted">
              <span className="w-14 shrink-0 font-medium text-ringo-text">{item.scheduledDate.slice(5)}</span>
              <span className="truncate">{item.title || c.contentTypeLabels[item.contentType] || item.contentType}</span>
            </li>
          ))}
        </ul>
        <a
          href={`/dashboard/content-calendar?year=${plan.year}&month=${plan.month}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-xl border border-ringo-border text-ringo-muted hover:text-ringo-text transition w-fit"
        >
          <CalendarDays size={12} />
          {c.viewFullCalendar}
        </a>
      </div>
    </div>
  );
}
