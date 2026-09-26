"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/protection", label: "Overview" },
  { href: "/admin/protection/disputes", label: "Disputes" },
  { href: "/admin/protection/refunds", label: "Refunds" },
];

export default function AdminProtectionTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b border-ringo-border/70 -mb-px">
      {TABS.map((t) => {
        const active = t.href === "/admin/protection" ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3.5 py-2 text-sm font-medium border-b-2 transition-colors ${
              active ? "border-ringo-indigo text-ringo-text" : "border-transparent text-ringo-muted hover:text-ringo-text"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
