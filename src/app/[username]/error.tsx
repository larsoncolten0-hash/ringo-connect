"use client";

import Image from "next/image";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";

// What a visitor sees if a public profile page (or one of its item / booking pages) fails to render: the same quiet,
// branded screen as the "not found" state, in the visitor's language, with a way to try again and a way out.
// It carries no error text, digest or stack: nothing about the failure reaches the visitor.
export default function PublicProfileError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useLanguage();
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center bg-ringo-bg" role="alert">
      <Image src="/logo.png" alt="" width={44} height={44} className="rounded-[12px]" />
      <h1 className="text-xl font-semibold text-ringo-text">{t.profilePage.errorTitle}</h1>
      <p className="max-w-xs text-sm text-ringo-muted">{t.profilePage.errorBody}</p>
      <div className="flex flex-col items-center gap-2 w-full max-w-xs">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex w-full items-center justify-center min-h-[44px] px-5 rounded-full bg-ringo-indigo text-white text-sm font-semibold transition hover:brightness-110 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-indigo"
        >
          {t.profilePage.errorRetry}
        </button>
        <Link
          href="/"
          className="inline-flex w-full items-center justify-center min-h-[44px] px-5 rounded-full text-sm font-medium text-ringo-muted transition hover:text-ringo-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-indigo"
        >
          {t.profilePage.notFoundCta}
        </Link>
      </div>
    </main>
  );
}
