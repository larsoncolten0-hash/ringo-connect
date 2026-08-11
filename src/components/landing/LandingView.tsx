"use client";

import Link from "next/link";
import Image from "next/image";
import { Link2, ShoppingBag, MessageCircle, BarChart3, ArrowRight } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";

export default function LandingView({
  isLoggedIn,
  dashboardHref,
}: {
  isLoggedIn: boolean;
  dashboardHref: string;
}) {
  const { t } = useLanguage();

  const FEATURES = [
    { icon: Link2, title: t.landing.featureLinksTitle, body: t.landing.featureLinksBody },
    { icon: ShoppingBag, title: t.landing.featureCatalogTitle, body: t.landing.featureCatalogBody },
    { icon: MessageCircle, title: t.landing.featureWhatsappTitle, body: t.landing.featureWhatsappBody },
    { icon: BarChart3, title: t.landing.featureAnalyticsTitle, body: t.landing.featureAnalyticsBody },
  ];

  return (
    <div className="min-h-screen bg-ringo-bg text-ringo-text">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-ringo-bg/85 backdrop-blur border-b border-ringo-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-5 py-3.5">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.png" alt="Ringo Connect" width={26} height={26} className="rounded-md" />
            <span className="font-display font-medium text-ringo-text">Ringo Connect</span>
          </Link>
          <div className="flex items-center gap-1.5">
            <LanguageToggle />
            <ThemeToggle iconOnly />
            {isLoggedIn ? (
              <Link
                href={dashboardHref}
                className="ml-1 flex items-center gap-1.5 px-4 py-2 rounded-card bg-ringo-indigo text-white text-sm font-medium"
              >
                {t.landing.goToDashboard}
                <ArrowRight size={14} />
              </Link>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="ml-1 px-3.5 py-2 rounded-card text-sm font-medium text-ringo-text hidden sm:inline-block"
                >
                  {t.landing.login}
                </Link>
                <Link
                  href="/auth/signup"
                  className="px-4 py-2 rounded-card bg-ringo-indigo text-white text-sm font-medium"
                >
                  {t.landing.getStarted}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 flex items-center justify-center opacity-[0.15] pointer-events-none"
          aria-hidden="true"
        >
          <div className="relative w-[420px] h-[420px]">
            <span className="absolute inset-0 rounded-full border border-ringo-indigo animate-ring-pulse-1" />
            <span className="absolute inset-0 rounded-full border border-ringo-teal animate-ring-pulse-2" />
            <span className="absolute inset-0 rounded-full border border-ringo-coral animate-ring-pulse-3" />
          </div>
        </div>

        <div className="relative max-w-3xl mx-auto px-5 pt-20 pb-24 text-center flex flex-col items-center">
          <span className="text-xs font-medium tracking-wide uppercase text-ringo-indigo bg-ringo-indigo/10 px-3 py-1 rounded-full mb-5">
            {t.landing.heroEyebrow}
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-medium tracking-[-0.02em] leading-[1.1] mb-5">
            {t.landing.heroTitle}
          </h1>
          <p className="text-ringo-muted text-base sm:text-lg max-w-xl mb-8">{t.landing.heroSubtitle}</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href={isLoggedIn ? dashboardHref : "/auth/signup"}
              className="px-6 py-3 rounded-card bg-ringo-indigo text-white text-sm font-medium shadow-[0_8px_24px_-6px_rgba(79,70,229,0.45)]"
            >
              {isLoggedIn ? t.landing.goToDashboard : t.landing.heroCtaPrimary}
            </Link>
            {!isLoggedIn && (
              <Link
                href="/auth/login"
                className="px-6 py-3 rounded-card border border-ringo-border text-sm font-medium text-ringo-text"
              >
                {t.landing.heroCtaSecondary}
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-5 py-20">
        <div className="text-center mb-12">
          <span className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2 block">
            {t.landing.featuresEyebrow}
          </span>
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] max-w-lg mx-auto">
            {t.landing.featuresTitle}
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_4px_16px_-4px_rgba(15,23,42,0.08)]"
            >
              <span className="w-9 h-9 rounded-full bg-ringo-indigo/10 flex items-center justify-center mb-3.5">
                <Icon size={16} className="text-ringo-indigo" />
              </span>
              <h3 className="text-sm font-medium text-ringo-text mb-1.5">{title}</h3>
              <p className="text-sm text-ringo-muted leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Brand customization highlight */}
      <section className="max-w-5xl mx-auto px-5 py-20 grid sm:grid-cols-2 gap-10 items-center">
        <div>
          <span className="text-xs font-medium tracking-wide uppercase text-ringo-teal mb-2 block">
            {t.landing.brandEyebrow}
          </span>
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] mb-4">
            {t.landing.brandTitle}
          </h2>
          <p className="text-ringo-muted leading-relaxed">{t.landing.brandBody}</p>
        </div>
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex gap-2 mb-4">
            {["#4F46E5", "#FF6B4A", "#14B8A6", "#E11D48", "#059669", "#0F172A"].map((c) => (
              <span key={c} className="w-7 h-7 rounded-full shrink-0" style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-9 rounded-full bg-ringo-indigo w-full" />
            <div className="h-9 rounded-full border-2 border-ringo-teal w-full" />
            <div className="h-9 rounded-full w-full" style={{ backgroundColor: "rgba(255,107,74,0.15)" }} />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-5 py-16">
        <div className="max-w-3xl mx-auto text-center rounded-card bg-gradient-to-br from-ringo-indigo to-ringo-indigo/85 text-white px-6 py-14 shadow-[0_16px_40px_-12px_rgba(79,70,229,0.5)]">
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] mb-3">
            {t.landing.ctaTitle}
          </h2>
          <p className="text-white/75 mb-7 max-w-md mx-auto">{t.landing.ctaSubtitle}</p>
          <Link
            href={isLoggedIn ? dashboardHref : "/auth/signup"}
            className="inline-flex items-center gap-1.5 px-6 py-3 rounded-card bg-white text-ringo-indigo text-sm font-medium"
          >
            {isLoggedIn ? t.landing.goToDashboard : t.landing.ctaButton}
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-ringo-border">
        <div className="max-w-5xl mx-auto px-5 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="" width={20} height={20} className="rounded-md" />
            <span className="text-sm text-ringo-muted">{t.landing.footerTagline}</span>
          </div>
          <p className="text-xs text-ringo-muted/70">
            © {new Date().getFullYear()} Ringo Connect. {t.landing.footerRights}
          </p>
        </div>
      </footer>
    </div>
  );
}