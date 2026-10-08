"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import BrandLogo from "@/components/BrandLogo";
import PublicLanguageSelector from "@/components/PublicLanguageSelector";
import { useLanguage } from "@/components/LanguageProvider";
import { LEGAL_CONTACT_EMAIL, type LegalBlock, type LegalDoc } from "@/lib/legal/types";
import { privacyEn } from "@/lib/legal/privacy.en";
import { privacyFr } from "@/lib/legal/privacy.fr";
import { termsEn } from "@/lib/legal/terms.en";
import { termsFr } from "@/lib/legal/terms.fr";
import { cookiesEn } from "@/lib/legal/cookies.en";
import { cookiesFr } from "@/lib/legal/cookies.fr";

// One layout for the Privacy Policy and the Terms of Service, in the visitor's language (the same language choice as the rest of Ringo). Content lives in src/lib/legal/*.
type LegalKind = "privacy" | "terms" | "cookies";
const DOCS: Record<LegalKind, Record<"en" | "fr", LegalDoc>> = {
  privacy: { en: privacyEn, fr: privacyFr },
  terms: { en: termsEn, fr: termsFr },
  cookies: { en: cookiesEn, fr: cookiesFr },
};

const link = "text-ringo-indigo hover:underline underline-offset-2";
const EMAIL_SPLIT = new RegExp(`(${LEGAL_CONTACT_EMAIL.replace(/\./g, "\\.")})`);

/** Inline **bold**, `code` and e-mail addresses become real markup; everything else is plain text. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(\/[a-z-]+\))/g).flatMap((part, i) => {
    const internal = part.match(/^\[([^\]]+)\]\((\/[a-z-]+)\)$/);
    if (internal)
      return [
        <Link key={i} href={internal[2]} className={link}>
          {internal[1]}
        </Link>,
      ];
    if (part.startsWith("**") && part.endsWith("**")) return [<strong key={i}>{part.slice(2, -2)}</strong>];
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`"))
      return [
        <code key={i} className="rounded bg-ringo-surface px-1 py-0.5 font-mono text-[13px] break-all">
          {part.slice(1, -1)}
        </code>,
      ];
    return part.split(EMAIL_SPLIT).map((s, j) =>
      s === LEGAL_CONTACT_EMAIL ? (
        <a key={`${i}-${j}`} href={`mailto:${s}`} className={link}>
          {s}
        </a>
      ) : (
        s
      )
    );
  });
}

function Block({ block, reviewLabel }: { block: LegalBlock; reviewLabel: string }) {
  if ("p" in block) return <p>{inline(block.p)}</p>;
  if ("ul" in block)
    return (
      <ul className="list-disc pl-5 flex flex-col gap-1.5">
        {block.ul.map((item) => (
          <li key={item}>{inline(item)}</li>
        ))}
      </ul>
    );
  return (
    <p className="rounded-card border border-amber-300/70 bg-amber-50 px-3.5 py-2.5 text-[13.5px] text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100">
      <strong>{reviewLabel}: </strong>
      {block.review}
    </p>
  );
}

export default function LegalDocument({ kind }: { kind: LegalKind }) {
  const { locale, t } = useLanguage();
  const doc = DOCS[kind][locale] ?? DOCS[kind].en;
  const all = [
    { kind: "terms", href: "/terms", label: t.legalLinks.terms },
    { kind: "privacy", href: "/privacy", label: t.legalLinks.privacy },
    { kind: "cookies", href: "/cookies", label: t.legalLinks.cookies },
  ];
  const others = all.filter((l) => l.kind !== kind);

  return (
    <div className="min-h-screen bg-ringo-bg text-ringo-text">
      <header className="border-b border-ringo-border">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 px-5 py-3">
          <Link href="/" className="flex items-center min-h-[44px]" aria-label={t.legalPage.backHome}>
            <BrandLogo variant="full" height={24} />
          </Link>
          <PublicLanguageSelector variant="bar" accent="#4F46E5" />
        </div>
      </header>

      <main id="legal-content" className="max-w-3xl mx-auto px-5 py-10 sm:py-12">
        <h1 className="font-display text-3xl font-medium tracking-tight mb-2">{doc.title}</h1>
        <p className="text-sm text-ringo-muted mb-8">
          {t.legalPage.lastUpdated}: {doc.updated}
        </p>

        <div className="flex flex-col gap-4 text-[15px] leading-[1.7] text-ringo-text">
          {doc.intro.map((p) => (
            <p key={p}>{inline(p)}</p>
          ))}
        </div>

        <nav aria-label={t.legalPage.contents} className="my-8 rounded-card border border-ringo-border bg-ringo-surface px-4 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ringo-muted mb-2">{t.legalPage.contents}</p>
          <ol className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2 text-sm">
            {doc.sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block py-1.5 text-ringo-text hover:text-ringo-indigo">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="flex flex-col gap-9 text-[15px] leading-[1.7]">
          {doc.sections.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-6 flex flex-col gap-3">
              <h2 id={`${s.id}-h`} className="font-display text-xl font-medium">
                {s.title}
              </h2>
              {s.blocks.map((b, i) => (
                <Block key={i} block={b} reviewLabel={t.legalPage.reviewLabel} />
              ))}
            </section>
          ))}
        </div>

        <footer className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ringo-border pt-6 text-sm">
          {others.map((o) => (
            <Link key={o.href} href={o.href} className={`${link} inline-flex min-h-[44px] items-center`}>
              {o.label}
            </Link>
          ))}
          <Link href="/" className={`${link} inline-flex min-h-[44px] items-center`}>
            {t.legalPage.backHome}
          </Link>
        </footer>
      </main>
    </div>
  );
}
