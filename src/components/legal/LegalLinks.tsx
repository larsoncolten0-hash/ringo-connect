"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";

// The two legal links, in the visitor's language. `agree` is the sentence shown where someone is about to create an account or pay; `plain` is just the two links (footers, menus).
export default function LegalLinks({ variant = "plain", className = "" }: { variant?: "plain" | "agree"; className?: string }) {
  const { t } = useLanguage();
  const link = "text-ringo-indigo hover:underline underline-offset-2";
  if (variant === "agree") {
    return (
      <p className={`text-xs leading-relaxed text-ringo-muted ${className}`}>
        {t.legalLinks.agreeLead}{" "}
        <Link href="/terms" className={link}>
          {t.legalLinks.terms}
        </Link>{" "}
        {t.legalLinks.agreeMid}{" "}
        <Link href="/privacy" className={link}>
          {t.legalLinks.privacy}
        </Link>
        .
      </p>
    );
  }
  return (
    <p className={`flex flex-wrap items-center gap-x-4 text-xs text-ringo-muted ${className}`}>
      <Link href="/terms" className={`${link} inline-flex min-h-[44px] items-center`}>
        {t.legalLinks.terms}
      </Link>
      <Link href="/privacy" className={`${link} inline-flex min-h-[44px] items-center`}>
        {t.legalLinks.privacy}
      </Link>
      <Link href="/cookies" className={`${link} inline-flex min-h-[44px] items-center`}>
        {t.legalLinks.cookies}
      </Link>
    </p>
  );
}
