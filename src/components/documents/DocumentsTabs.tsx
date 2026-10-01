"use client";

import { usePathname } from "next/navigation";
import { FileText, Building2, Users } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import SectionTabs from "@/components/dashboard/SectionTabs";

// Sub-navigation of the invoice section (same SectionTabs the Shop and Music sections use).
export default function DocumentsTabs({ debtors = false }: { debtors?: boolean }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const tabs = [
    { href: "/dashboard/documents", label: t.documents.ui.tabInvoices, icon: FileText },
    ...(debtors ? [{ href: "/dashboard/documents/receivables", label: t.receivables.ui.tabDebtors, icon: Users }] : []),
    { href: "/dashboard/documents/settings", label: t.documents.ui.tabBusiness, icon: Building2 },
  ];
  // The Invoices tab also covers a document's own pages (/dashboard/documents/new, /<id>, /<id>/edit).
  const isActive = (href: string) =>
    href === "/dashboard/documents/settings" || href === "/dashboard/documents/receivables"
      ? pathname.startsWith(href)
      : pathname.startsWith("/dashboard/documents") && !pathname.startsWith("/dashboard/documents/settings") && !pathname.startsWith("/dashboard/documents/receivables");
  return <SectionTabs tabs={tabs} isActive={isActive} />;
}
