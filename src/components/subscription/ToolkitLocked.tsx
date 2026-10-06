"use client";

import { useId } from "react";
import { BookOpen, Boxes, Check, FileBarChart, FileText, Lock, ReceiptText, type LucideIcon } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import PlanCta from "@/components/ui/PlanCta";

export type ToolkitTool = "sales" | "inventory" | "documents" | "bookkeeping" | "reports";
/** Why the tool cannot be used by this business even with a paid plan: its kind of business is not offered the tools (or, for "inventory", stock tracking). */
export type ToolkitUnavailableKind = "restaurant" | "music" | "events" | "other" | "inventory";

const ICONS: Record<ToolkitTool, LucideIcon> = {
  sales: ReceiptText,
  inventory: Boxes,
  documents: FileText,
  bookkeeping: BookOpen,
  reports: FileBarChart,
};

// Where each kind of business goes instead (all existing dashboard pages). "other" goes to the editor, where the category is chosen.
const NEXT_HREF: Record<ToolkitUnavailableKind, string> = {
  restaurant: "/dashboard/restaurant",
  music: "/dashboard/music",
  events: "/dashboard/tickets",
  other: "/dashboard",
  inventory: "/dashboard/home",
};

// What an owner sees in place of a business tool (Record Sale, Inventory, Invoices, Bookkeeping, Reports) they cannot use. Two honest cases, both purposeful
// states and never an error:
//   * default            the plan does not include the tools: what the tool is for and one clear way to upgrade, on the existing subscription page;
//   * `unavailable` set  the tools are not offered for this kind of business: it says so plainly and points to what that business has instead. It NEVER offers an
//                        upgrade, because an upgrade would not unlock anything.
// Neither carries any business data: the server layout that renders this never renders the tool itself, and the tool's API still refuses.
export default function ToolkitLocked({ tool, unavailable }: { tool: ToolkitTool; unavailable?: ToolkitUnavailableKind }) {
  const { t } = useLanguage();
  const titleId = useId();
  const Icon = ICONS[tool];
  const name = { sales: t.nav.recordSale, inventory: t.nav.inventory, documents: t.nav.documents, bookkeeping: t.nav.bookkeeping, reports: t.nav.reports }[tool];
  const U = t.toolkitLock.unavailable;
  const copy = unavailable ? U[unavailable] : t.toolkitLock.tools[tool];

  return (
    <section aria-labelledby={titleId} className="mx-auto flex max-w-xl flex-col items-start gap-5 rounded-card border border-ringo-border bg-ringo-surface p-6 sm:p-8">
      <div className="flex w-full items-center justify-between gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ringo-indigo/10 text-ringo-indigo">
          <Icon size={22} aria-hidden="true" />
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ringo-indigo/10 px-3 py-1 text-xs font-semibold text-ringo-indigo">
          <Lock size={12} aria-hidden="true" />
          {unavailable ? U.badge : t.toolkitLock.badge}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ringo-muted">{name}</p>
        <h1 id={titleId} className="font-display text-2xl font-bold leading-tight tracking-[-0.01em] text-ringo-text sm:text-3xl">
          {copy.headline}
        </h1>
        <p className="text-sm leading-relaxed text-ringo-muted">{copy.body}</p>
      </div>

      {!unavailable && (
        <ul className="flex flex-col gap-2.5">
          {t.toolkitLock.tools[tool].points.map((point: string) => (
            <li key={point} className="flex items-start gap-2.5 text-sm text-ringo-text">
              <Check size={16} className="mt-0.5 shrink-0 text-ringo-indigo" aria-hidden="true" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        {unavailable ? (
          <PlanCta href={NEXT_HREF[unavailable]} variant="secondary" className="sm:shrink-0 sm:whitespace-nowrap">
            {U[unavailable].cta}
          </PlanCta>
        ) : (
          <PlanCta variant="primary" ariaLabel={t.toolkitLock.ctaAria(name)} className="sm:shrink-0 sm:whitespace-nowrap">
            {t.toolkitLock.cta}
          </PlanCta>
        )}
        <p className="text-xs leading-relaxed text-ringo-muted">{unavailable ? U.note : t.toolkitLock.note}</p>
      </div>
    </section>
  );
}
