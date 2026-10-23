"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";

// The light frame of the visitor's "My Bible Journey" pages: a title, a way back to My Ringo, the language switch. It is deliberately NOT the My Ringo app shell (which signs the visitor in or sends them
// away): a visitor who is not signed in can still read a programme here, and is asked to sign in to follow it.
export default function JourneyShell({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const c = t.churchBible.journey;
  return (
    <div className="min-h-screen bg-ringo-bg text-ringo-text">
      <header className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 pb-2 pt-4" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
        <h1 className="font-display text-lg font-semibold">{c.pageTitle}</h1>
        <div className="flex items-center gap-1">
          <Link href="/my-ringo" className="inline-flex min-h-[44px] items-center rounded-full px-3 text-sm font-semibold text-ringo-indigo hover:bg-ringo-indigo/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">
            {c.myRingo}
          </Link>
          <LanguageToggle />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-2">{children}</main>
    </div>
  );
}
