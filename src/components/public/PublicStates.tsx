"use client";

import Image from "next/image";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";

// The words for the two states every visitor of a public page can land in, in the visitor's language.
// Kept in client components because the language lives in LanguageProvider (the server cannot know it);
// the server files that use them (app/loading.tsx, app/[username]/not-found.tsx) stay plain.

export function LoadingLabel() {
  const { t } = useLanguage();
  return <p className="text-xs font-medium text-ringo-muted animate-fade-in">{t.profilePage.loading}</p>;
}

// Shown for a missing, unpublished or suspended profile alike: the wording says nothing about WHICH,
// so a visitor cannot tell a suspended profile from one that never existed. The 404 status itself comes
// from notFound() in the route, untouched.
export function PublicNotFound() {
  const { t } = useLanguage();
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center bg-ringo-bg">
      <Image src="/logo.png" alt="" width={44} height={44} className="rounded-[12px]" />
      <h1 className="text-xl font-semibold text-ringo-text">{t.profilePage.notFoundTitle}</h1>
      <p className="max-w-xs text-sm text-ringo-muted">{t.profilePage.notFoundBody}</p>
      <Link
        href="/"
        className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-full bg-ringo-indigo text-white text-sm font-semibold transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50 focus-visible:ring-offset-2"
      >
        {t.profilePage.notFoundCta}
      </Link>
    </main>
  );
}
