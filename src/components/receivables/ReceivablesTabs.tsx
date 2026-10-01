"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";

// Sub-navigation inside the Debtors area: overview, contacts, reminder settings.
export default function ReceivablesTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const r = t.receivables.ui;
  const tabs = [
    { href: "/dashboard/documents/receivables", label: r.tabDebtors, active: pathname === "/dashboard/documents/receivables" },
    { href: "/dashboard/documents/receivables/contacts", label: r.tabContacts, active: pathname.startsWith("/dashboard/documents/receivables/contacts") },
    { href: "/dashboard/documents/receivables/settings", label: r.tabReminders, active: pathname.startsWith("/dashboard/documents/receivables/settings") },
  ];
  return (
    <nav className="flex gap-2 flex-wrap mb-5" aria-label={r.title}>
      {tabs.map((x) => (
        <Link key={x.href} href={x.href} aria-current={x.active ? "page" : undefined}
          className={`inline-flex min-h-[40px] items-center rounded-full px-4 text-sm font-medium transition ${x.active ? "bg-ringo-indigo text-white" : "border border-ringo-border text-ringo-text hover:bg-ringo-muted/10"}`}>
          {x.label}
        </Link>
      ))}
    </nav>
  );
}
