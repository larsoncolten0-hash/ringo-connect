"use client";

import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  Phone,
  Mail,
  MapPin,
  Eye,
  MousePointerClick,
  UserCheck,
  Heart,
  TrendingUp,
  Smartphone,
} from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { useLanguage } from "@/components/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import IndustryShowcase from "./IndustryShowcase";
import EcosystemDiagram from "./EcosystemDiagram";
import IndustriesGrid from "./IndustriesGrid";
import RestaurantShowcase from "./RestaurantShowcase";
import JourneySteps from "./JourneySteps";
import NfcQrSection from "./NfcQrSection";

// This homepage is deliberately built only around what's actually shipped
// in the app today: links/catalog (every category), the Music &
// Entertainment tracks/tickets/support system, the Restaurant & Food
// menu/ordering/QR-table system, WhatsApp hand-off, click analytics, and
// QR codes. "NFC" is real too, just not a separate backend feature — an
// NFC tag written with a profile's URL opens exactly the same page a QR
// code or plain link already does, so describing it costs nothing to
// promise. Nothing here claims payment collection, bookings, or
// integrations that don't exist — see the section-by-section comments
// below for why each claim is safe to make.
export default function LandingView({
  isLoggedIn,
  dashboardHref,
}: {
  isLoggedIn: boolean;
  dashboardHref: string;
}) {
  const { t } = useLanguage();

  const primaryHref = isLoggedIn ? dashboardHref : "/auth/signup";
  const primaryLabel = isLoggedIn ? t.landing.goToDashboard : t.landing.heroCtaPrimary;

  return (
    <div className="min-h-screen bg-ringo-bg text-ringo-text">
      {/* ============ NAV ============ */}
      <header className="sticky top-0 z-40 bg-ringo-bg/85 backdrop-blur border-b border-ringo-border">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-5 py-3.5">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Image src="/logo.png" alt="Ringo Connect" width={26} height={26} className="rounded-md" />
            <span className="font-display font-medium text-ringo-text">Ringo Connect</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-6" aria-label="Main">
            <a href="#features" className="text-sm text-ringo-muted hover:text-ringo-text transition-colors">
              {t.landing.navFeatures}
            </a>
            <a href="#industries" className="text-sm text-ringo-muted hover:text-ringo-text transition-colors">
              {t.landing.navIndustries}
            </a>
            <a href="#restaurant" className="text-sm text-ringo-muted hover:text-ringo-text transition-colors">
              {t.landing.navRestaurant}
            </a>
            <a href="#nfc" className="text-sm text-ringo-muted hover:text-ringo-text transition-colors">
              {t.landing.navNfc}
            </a>
            <Link href="/get-started" className="text-sm text-ringo-muted hover:text-ringo-text transition-colors">
              {t.landing.navPricing}
            </Link>
          </nav>

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
                <Link href="/auth/login" className="ml-1 px-3.5 py-2 rounded-card text-sm font-medium text-ringo-text hidden sm:inline-block">
                  {t.landing.login}
                </Link>
                <Link href="/auth/signup" className="px-4 py-2 rounded-card bg-ringo-indigo text-white text-sm font-medium">
                  {t.landing.getStarted}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ============ HERO ============ */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center opacity-[0.12] pointer-events-none" aria-hidden="true">
          <div className="relative w-[480px] h-[480px]">
            <span className="absolute inset-0 rounded-full border border-ringo-indigo animate-ring-pulse-1" />
            <span className="absolute inset-0 rounded-full border border-ringo-teal animate-ring-pulse-2" />
            <span className="absolute inset-0 rounded-full border border-ringo-coral animate-ring-pulse-3" />
          </div>
        </div>

        <div className="relative max-w-6xl mx-auto px-5 pt-16 pb-20 grid lg:grid-cols-[1fr_auto] gap-12 items-center">
          <div className="text-center lg:text-left flex flex-col items-center lg:items-start">
            <span className="text-xs font-medium tracking-wide uppercase text-ringo-indigo bg-ringo-indigo/10 px-3 py-1 rounded-full mb-5">
              {t.landing.heroEyebrow}
            </span>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.4rem] font-medium tracking-[-0.02em] leading-[1.08] mb-5 max-w-xl">
              {t.landing.heroTitle}
            </h1>
            <p className="text-ringo-muted text-base sm:text-lg max-w-lg mb-8">{t.landing.heroSubtitle}</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href={primaryHref}
                className="flex items-center justify-center gap-1.5 px-6 py-3 rounded-card bg-ringo-indigo text-white text-sm font-medium shadow-[0_8px_24px_-6px_rgba(79,70,229,0.45)]"
              >
                {primaryLabel}
                <ArrowRight size={14} />
              </Link>
              <a href="#journey" className="flex items-center justify-center px-6 py-3 rounded-card border border-ringo-border text-sm font-medium text-ringo-text">
                {t.landing.heroCtaSecondary}
              </a>
            </div>
          </div>

          <IndustryShowcase />
        </div>
      </section>

      {/* ============ YOUR DIGITAL WORLD (Features) ============ */}
      <section id="features" className="max-w-6xl mx-auto px-5 py-20 scroll-mt-16">
        <div className="text-center mb-10">
          <span className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2 block">{t.landing.ecosystemEyebrow}</span>
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] max-w-lg mx-auto mb-3">{t.landing.ecosystemTitle}</h2>
          <p className="text-ringo-muted max-w-lg mx-auto">{t.landing.ecosystemSubtitle}</p>
        </div>
        <EcosystemDiagram />
      </section>

      {/* ============ MORE THAN A LINK ============ */}
      <section className="max-w-6xl mx-auto px-5 py-16">
        <div className="text-center mb-10">
          <span className="text-xs font-medium tracking-wide uppercase text-ringo-teal mb-2 block">{t.landing.moreEyebrow}</span>
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] max-w-lg mx-auto mb-3">{t.landing.moreTitle}</h2>
          <p className="text-ringo-muted max-w-lg mx-auto">{t.landing.moreSubtitle}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[t.landing.moreCardCard, t.landing.moreCardHub, t.landing.moreCardStore, t.landing.moreCardMenu, t.landing.moreCardShowcase, t.landing.moreCardConnection].map((label) => (
            <div key={label} className="rounded-card border border-ringo-border/70 bg-ringo-surface px-5 py-4 text-sm font-medium text-ringo-text">
              {label}
            </div>
          ))}
        </div>
      </section>

      {/* ============ INDUSTRIES ============ */}
      <section id="industries" className="max-w-6xl mx-auto px-5 py-20 scroll-mt-16">
        <div className="text-center mb-10">
          <span className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2 block">{t.landing.industriesEyebrow}</span>
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] max-w-lg mx-auto mb-3">{t.landing.industriesTitle}</h2>
          <p className="text-ringo-muted max-w-lg mx-auto">{t.landing.industriesSubtitle}</p>
        </div>
        <IndustriesGrid />
      </section>

      {/* ============ RESTAURANT & FOOD ============ */}
      <section id="restaurant" className="bg-ringo-surface border-y border-ringo-border/70 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-5 py-20 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <span className="text-xs font-medium tracking-wide uppercase text-[#1F9D55] mb-2 block">{t.landing.restaurantEyebrow}</span>
            <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] mb-3">{t.landing.restaurantTitle}</h2>
            <p className="text-ringo-muted mb-6 max-w-md">{t.landing.restaurantSubtitle}</p>
            <ul className="flex flex-col gap-3 mb-7">
              {[t.landing.restaurantPointMenu, t.landing.restaurantPointHours, t.landing.restaurantPointOrder, t.landing.restaurantPointQr].map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-sm text-ringo-text">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#1F9D55] mt-1.5 shrink-0" />
                  {point}
                </li>
              ))}
            </ul>
            <Link href="/auth/signup" className="inline-flex items-center gap-1.5 text-sm font-medium text-white px-5 py-2.5 rounded-card" style={{ backgroundColor: "#1F9D55" }}>
              {t.landing.restaurantCta}
              <ArrowRight size={13} />
            </Link>
          </div>
          <RestaurantShowcase />
        </div>
      </section>

      {/* ============ HOW IT WORKS / JOURNEY ============ */}
      <section id="journey" className="max-w-6xl mx-auto px-5 py-20 scroll-mt-16">
        <div className="text-center mb-12">
          <span className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2 block">{t.landing.journeyEyebrow}</span>
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] max-w-lg mx-auto">{t.landing.journeyTitle}</h2>
        </div>
        <JourneySteps />
      </section>

      {/* ============ NFC + QR ============ */}
      <section id="nfc" className="max-w-4xl mx-auto px-5 py-20 scroll-mt-16">
        <NfcQrSection />
      </section>

      {/* ============ COMMERCE + CUSTOMER CONNECTION ============ */}
      <section className="bg-ringo-surface border-y border-ringo-border/70">
        <div className="max-w-6xl mx-auto px-5 py-20">
          <div className="text-center mb-12">
            <span className="text-xs font-medium tracking-wide uppercase text-ringo-coral mb-2 block">{t.landing.commerceEyebrow}</span>
            <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] max-w-lg mx-auto mb-3">{t.landing.commerceTitle}</h2>
            <p className="text-ringo-muted max-w-lg mx-auto">{t.landing.commerceSubtitle}</p>
          </div>

          <div className="text-center mb-8">
            <span className="text-xs font-medium tracking-wide uppercase text-ringo-teal mb-2 block">{t.landing.connectionEyebrow}</span>
            <h3 className="font-display text-xl font-medium tracking-[-0.01em] max-w-lg mx-auto mb-3">{t.landing.connectionTitle}</h3>
            <p className="text-ringo-muted max-w-lg mx-auto mb-8">{t.landing.connectionSubtitle}</p>
          </div>

          <div className="flex items-center justify-center flex-wrap gap-2">
            {[
              { icon: Eye, label: t.landing.connectionFlowVisitor },
              { icon: MousePointerClick, label: t.landing.connectionFlowConnection },
              { icon: UserCheck, label: t.landing.connectionFlowCustomer },
              { icon: Heart, label: t.landing.connectionFlowRelationship },
              { icon: TrendingUp, label: t.landing.connectionFlowGrowth },
            ].map((s, i, arr) => (
              <div key={s.label} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-1.5">
                  <span className="w-11 h-11 rounded-full bg-ringo-bg border border-ringo-border flex items-center justify-center text-ringo-indigo">
                    <s.icon size={17} />
                  </span>
                  <span className="text-xs font-medium text-ringo-text">{s.label}</span>
                </div>
                {i < arr.length - 1 && <ArrowRight size={14} className="text-ringo-muted shrink-0 -mt-4" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ AFRICA ============ */}
      <section className="max-w-6xl mx-auto px-5 py-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <span className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2 block">{t.landing.africaEyebrow}</span>
            <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] mb-3">{t.landing.africaTitle}</h2>
            <p className="text-ringo-muted mb-6">{t.landing.africaSubtitle}</p>
          </div>
          <ul className="flex flex-col gap-4">
            {[
              { icon: Smartphone, text: t.landing.africaPointMobile },
              { icon: FaWhatsapp, text: t.landing.africaPointWhatsapp },
              { icon: ArrowRight, text: t.landing.africaPointQrNfc },
              { icon: TrendingUp, text: t.landing.africaPointMoney },
              { icon: Heart, text: t.landing.africaPointLocal },
            ].map((p, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-ringo-text">
                <span className="w-8 h-8 rounded-full bg-ringo-indigo/10 text-ringo-indigo flex items-center justify-center shrink-0">
                  <p.icon size={14} />
                </span>
                <span className="pt-1.5">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ============ WHY RINGO ============ */}
      <section className="max-w-3xl mx-auto px-5 py-16 text-center">
        <span className="text-xs font-medium tracking-wide uppercase text-ringo-teal mb-2 block">{t.landing.whyEyebrow}</span>
        <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] mb-3">{t.landing.whyTitle}</h2>
        <p className="text-ringo-muted">{t.landing.whySubtitle}</p>
      </section>

      {/* ============ CONTACT ============ */}
      <section className="max-w-3xl mx-auto px-5 py-16">
        <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-8 sm:p-10 text-center">
          <span className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2 block">{t.landing.contactEyebrow}</span>
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] mb-3">{t.landing.contactTitle}</h2>
          <p className="text-ringo-muted mb-7">{t.landing.contactSubtitle}</p>

          <div className="flex flex-col items-center gap-1.5 mb-7 text-sm text-ringo-muted">
            <p className="font-medium text-ringo-text">{t.landing.contactAddressLabel}</p>
            <p className="flex items-center gap-1.5">
              <MapPin size={13} />
              {t.landing.contactAddressLocation}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row justify-center gap-3">
            <a
              href="tel:+237694028846"
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-card bg-ringo-indigo text-white text-sm font-medium"
            >
              <Phone size={15} />
              {t.landing.contactCall} · +237 694 028 846
            </a>
            <a
              href="mailto:info@ringoconnectltd.com"
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-card border border-ringo-border text-sm font-medium text-ringo-text"
            >
              <Mail size={15} />
              {t.landing.contactEmail}
            </a>
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="px-5 py-16">
        <div className="max-w-3xl mx-auto text-center rounded-card bg-gradient-to-br from-ringo-indigo to-ringo-indigo/85 text-white px-6 py-16 shadow-[0_16px_40px_-12px_rgba(79,70,229,0.5)]">
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] mb-3">{t.landing.finalCtaTitle}</h2>
          <p className="text-white/75 mb-7 max-w-md mx-auto">{t.landing.finalCtaSubtitle}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-4">
            <Link href={primaryHref} className="inline-flex items-center gap-1.5 px-6 py-3 rounded-card bg-white text-ringo-indigo text-sm font-medium">
              {isLoggedIn ? t.landing.goToDashboard : t.landing.finalCtaPrimary}
              <ArrowRight size={14} />
            </Link>
            {!isLoggedIn && (
              <Link href="/auth/login" className="inline-flex items-center gap-1.5 px-6 py-3 rounded-card border border-white/30 text-white text-sm font-medium">
                {t.landing.finalCtaSecondary}
              </Link>
            )}
          </div>
          <p className="text-xs text-white/60">{t.landing.finalCtaMicrocopy}</p>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="border-t border-ringo-border">
        <div className="max-w-6xl mx-auto px-5 py-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Image src="/logo.png" alt="" width={22} height={22} className="rounded-md" />
              <span className="font-display font-medium text-sm">Ringo Connect</span>
            </div>
            <p className="text-sm text-ringo-muted leading-relaxed">{t.landing.footerTagline}</p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ringo-muted mb-3">{t.landing.footerProductHeading}</h3>
            <div className="flex flex-col gap-2 text-sm">
              <a href="#features" className="text-ringo-muted hover:text-ringo-text transition-colors">{t.landing.navFeatures}</a>
              <Link href="/get-started" className="text-ringo-muted hover:text-ringo-text transition-colors">{t.landing.navPricing}</Link>
              <a href="#nfc" className="text-ringo-muted hover:text-ringo-text transition-colors">{t.landing.navNfc}</a>
              <Link href="/get-started-affiliate" className="text-ringo-muted hover:text-ringo-text transition-colors">{t.landing.footerAffiliate}</Link>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ringo-muted mb-3">{t.landing.footerIndustriesHeading}</h3>
            <div className="flex flex-col gap-2 text-sm">
              <a href="#industries" className="text-ringo-muted hover:text-ringo-text transition-colors">{t.landing.industryArtistsTitle}</a>
              <a href="#restaurant" className="text-ringo-muted hover:text-ringo-text transition-colors">{t.landing.industryRestaurantsTitle}</a>
              <a href="#industries" className="text-ringo-muted hover:text-ringo-text transition-colors">{t.landing.industryBusinessTitle}</a>
              <a href="#industries" className="text-ringo-muted hover:text-ringo-text transition-colors">{t.landing.industryRealEstateTitle}</a>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ringo-muted mb-3">{t.landing.footerCompanyHeading}</h3>
            <div className="flex flex-col gap-2 text-sm">
              <Link href="/terms" className="text-ringo-muted hover:text-ringo-text transition-colors">{t.landing.footerTerms}</Link>
              <Link href="/privacy" className="text-ringo-muted hover:text-ringo-text transition-colors">{t.landing.footerPrivacy}</Link>
              <a href="mailto:info@ringoconnectltd.com" className="text-ringo-muted hover:text-ringo-text transition-colors">info@ringoconnectltd.com</a>
              <a href="tel:+237694028846" className="text-ringo-muted hover:text-ringo-text transition-colors">+237 694 028 846</a>
            </div>
          </div>
        </div>
        <div className="border-t border-ringo-border">
          <div className="max-w-6xl mx-auto px-5 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-ringo-muted/70">
            <p>© {new Date().getFullYear()} Ringo Connect Ltd. {t.landing.footerRights}</p>
            <p>{t.landing.contactAddressLocation}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
