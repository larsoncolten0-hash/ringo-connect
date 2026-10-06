"use client";

import Link from "next/link";
import { useId } from "react";
import { BookOpen, Boxes, Check, FileBarChart, FileText, Lock, ReceiptText, type LucideIcon } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

export type ToolkitTool = "sales" | "inventory" | "documents" | "bookkeeping" | "reports";

const ICONS: Record<ToolkitTool, LucideIcon> = {
  sales: ReceiptText,
  inventory: Boxes,
  documents: FileText,
  bookkeeping: BookOpen,
  reports: FileBarChart,
};

// What a Free owner sees in place of a paid business tool (Record Sale, Inventory, Invoices, Bookkeeping, Reports): what the tool is for and one
// clear way to upgrade, on the existing subscription page. It is a purposeful state, not an error, and it carries no business data: the server
// layout that renders it never renders the tool itself, and the tool's API still refuses a plan without the business tools.
export default function ToolkitLocked({ tool }: { tool: ToolkitTool }) {
  const { t } = useLanguage();
  const titleId = useId();
  const Icon = ICONS[tool];
  const copy = t.toolkitLock.tools[tool];
  const name = { sales: t.nav.recordSale, inventory: t.nav.inventory, documents: t.nav.documents, bookkeeping: t.nav.bookkeeping, reports: t.nav.reports }[tool];

  return (
    <section aria-labelledby={titleId} className="mx-auto flex max-w-xl flex-col items-start gap-5 rounded-card border border-ringo-border bg-ringo-surface p-6 sm:p-8">
      <div className="flex w-full items-center justify-between gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ringo-indigo/10 text-ringo-indigo">
          <Icon size={22} aria-hidden="true" />
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ringo-indigo/10 px-3 py-1 text-xs font-semibold text-ringo-indigo">
          <Lock size={12} aria-hidden="true" />
          {t.toolkitLock.badge}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-ringo-muted">{name}</p>
        <h1 id={titleId} className="font-display text-2xl font-bold leading-tight tracking-[-0.01em] text-ringo-text sm:text-3xl">
          {copy.headline}
        </h1>
        <p className="text-sm leading-relaxed text-ringo-muted">{copy.body}</p>
      </div>

      <ul className="flex flex-col gap-2.5">
        {copy.points.map((point: string) => (
          <li key={point} className="flex items-start gap-2.5 text-sm text-ringo-text">
            <Check size={16} className="mt-0.5 shrink-0 text-ringo-indigo" aria-hidden="true" />
            <span>{point}</span>
          </li>
        ))}
      </ul>

      <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <Link
          href="/dashboard/subscription"
          aria-label={t.toolkitLock.ctaAria(name)}
          className="ringo-tactile inline-flex min-h-[44px] items-center justify-center rounded-full bg-ringo-indigo px-6 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50 focus-visible:ring-offset-2"
        >
          {t.toolkitLock.cta}
        </Link>
        <p className="text-xs leading-relaxed text-ringo-muted">{t.toolkitLock.note}</p>
      </div>
    </section>
  );
}
