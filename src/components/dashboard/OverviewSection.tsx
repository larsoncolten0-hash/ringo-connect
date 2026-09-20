"use client";

import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// One "preview" card on a dashboard section's first page: a few live numbers from one of the
// section's other pages, with a "See more" link that opens that page. Used so the hamburger
// menu can list only the sections while every setting inside them is still surfaced on the
// section's landing page.
export default function OverviewSection({
  title,
  icon: Icon,
  href,
  children,
}: {
  title: string;
  icon: LucideIcon;
  href: string;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  return (
    <section className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ringo-text">
          <Icon size={15} className="text-ringo-indigo" />
          {title}
        </h2>
        <Link href={href} className="flex items-center gap-0.5 text-xs font-semibold text-ringo-indigo whitespace-nowrap">
          {t.nav.seeMore}
          <ChevronRight size={13} />
        </Link>
      </div>
      {children}
    </section>
  );
}
