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
  Music,
  Store,
  UtensilsCrossed,
  Sparkles,
} from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { useLanguage } from "@/components/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import GradientMesh from "./GradientMesh";
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
// integrations that don't exist.
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

  // A solid-color pill instead of a faint tint — the small badge every
  // section opens with, but loud enough to actually read as color.
  const Eyebrow = ({ children, color }: { children: React.ReactNode; color: string }) => (
    <span
      className="inline-flex text-xs font-semibold tracking-wide uppercase px-3.5 py-1.5 rounded-full mb-4 text-white shadow-[0_4px_12px_-2px_rgba(0,0,0,0.2)]"
      style={{ backgroundColor: color }}
    >
      {children}
    </span>
  );

  return (
    <div className="min-h-screen bg-ringo-bg text-ringo-text overflow-x-hidden">
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
        <GradientMesh tone="brand" />
        <div className="absolute inset-0 flex items-center justify-center opacity-[0.1] pointer-events-none" aria-hidden="true">
          <div className="relative w-[480px] h-[480px]">
            <span className="absolute inset-0 rounded-full border border-ringo-indigo animate-ring-pulse-1" />
            <span className="absolute inset-0 rounded-full border border-ringo-teal animate-ring-pulse-2" />
            <span className="absolute inset-0 rounded-full border border-ringo-coral animate-ring-pulse-3" />
          </div>
        </div>

        <div className="relative max-w-6xl mx-auto px-5 pt-16 pb-24 grid lg:grid-cols-[1fr_auto] gap-12 items-center">
          <div className="text-center lg:text-left flex flex-col items-center lg:items-start">
            <Eyebrow color="#4F46E5">{t.landing.heroEyebrow}</Eyebrow>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.5rem] font-medium tracking-[-0.02em] leading-[1.06] mb-5 max-w-xl">
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: "linear-gradient(100deg, #4F46E5, #FF6B4A 60%, #14B8A6)" }}
              >
                {t.landing.heroTitleLead}
              </span>{" "}
              {t.landing.heroTitleRest}
            </h1>
            <p className="text-ringo-muted text-base sm:text-lg max-w-lg mb-8">{t.landing.heroSubtitle}</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href={primaryHref}
                className="flex items-center justify-center gap-1.5 px-6 py-3 rounded-card text-white text-sm font-semibold shadow-[0_10px_28px_-6px_rgba(79,70,229,0.55)] transition-transform hover:-translate-y-0.5"
                style={{ background: "linear-gradient(100deg, #4F46E5, #6D5EF0)" }}
              >
                {primaryLabel}
                <ArrowRight size={14} />
              </Link>
              <a
                href="#journey"
                className="flex items-center justify-center px-6 py-3 rounded-card border-2 border-ringo-border text-sm font-semibold text-ringo-text hover:border-ringo-indigo/50 transition-colors"
              >
                {t.landing.heroCtaSecondary}
              </a>
            </div>
          </div>

          <div className="relative">
            {/* Colorful glow directly behind the phone, plus floating
                capability badges around it — makes the hero read as a
                living ecosystem, not a static screenshot. */}
            <div
              className="absolute inset-0 -m-10 rounded-full blur-[70px] opacity-40"
              style={{ background: "radial-gradient(circle, #F2B705, #4F46E5 55%, transparent 75%)" }}
              aria-hidden="true"
            />
            <span className="hidden sm:flex absolute -left-8 top-10 z-20 items-center gap-1.5 px-3 py-1.5 rounded-full bg-ringo-surface border border-ringo-border shadow-[0_8px_20px_-6px_rgba(15,23,42,0.2)] text-xs font-medium text-ringo-text motion-safe:animate-[float_5s_ease-in-out_infinite]">
              <Music size={12} style={{ color: "#F2B705" }} />
              {t.landing.chipMusic}
            </span>
            <span className="hidden sm:flex absolute -right-6 top-32 z-20 items-center gap-1.5 px-3 py-1.5 rounded-full bg-ringo-surface border border-ringo-border shadow-[0_8px_20px_-6px_rgba(15,23,42,0.2)] text-xs font-medium text-ringo-text motion-safe:animate-[float_6s_ease-in-out_infinite_0.4s]">
              <UtensilsCrossed size={12} style={{ color: "#1F9D55" }} />
              {t.landing.chipMenu}
            </span>
            <span className="hidden sm:flex absolute -left-4 bottom-16 z-20 items-center gap-1.5 px-3 py-1.5 rounded-full bg-ringo-surface border border-ringo-border shadow-[0_8px_20px_-6px_rgba(15,23,42,0.2)] text-xs font-medium text-ringo-text motion-safe:animate-[float_5.5s_ease-in-out_infinite_0.8s]">
              <FaWhatsapp size={12} color="#25D366" />
              {t.landing.chipWhatsapp}
            </span>
            <div className="relative z-10">
              <IndustryShowcase />
            </div>
          </div>
        </div>
      </section>

      {/* ============ YOUR DIGITAL WORLD (Features) ============ */}
      <section id="features" className="relative max-w-6xl mx-auto px-5 py-20 scroll-mt-16">
        <div className="text-center mb-4 flex flex-col items-center">
          <Eyebrow color="#4F46E5">{t.landing.ecosystemEyebrow}</Eyebrow>
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] max-w-lg mx-auto mb-3">{t.landing.ecosystemTitle}</h2>
          <p className="text-ringo-muted max-w-lg mx-auto">{t.landing.ecosystemSubtitle}</p>
        </div>
        <EcosystemDiagram />
      </section>

      {/* ============ MORE THAN A LINK ============ */}
      <section className="relative max-w-6xl mx-auto px-5 py-16">
        <div className="text-center mb-10 flex flex-col items-center">
          <Eyebrow color="#14B8A6">{t.landing.moreEyebrow}</Eyebrow>
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] max-w-lg mx-auto mb-3">{t.landing.moreTitle}</h2>
          <p className="text-ringo-muted max-w-lg mx-auto">{t.landing.moreSubtitle}</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { label: t.landing.moreCardCard, color: "#4F46E5" },
            { label: t.landing.moreCardHub, color: "#F2B705" },
            { label: t.landing.moreCardStore, color: "#FF6B4A" },
            { label: t.landing.moreCardMenu, color: "#1F9D55" },
            { label: t.landing.moreCardShowcase, color: "#0EA5E9" },
            { label: t.landing.moreCardConnection, color: "#E11D48" },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-card bg-ringo-surface px-5 py-4 text-sm font-semibold text-ringo-text shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
              style={{ borderLeft: `4px solid ${item.color}` }}
            >
              {item.label}
            </div>
          ))}
        </div>
      </section>

      {/* ============ INDUSTRIES ============ */}
      <section id="industries" className="relative max-w-6xl mx-auto px-5 py-20 scroll-mt-16">
        <div className="text-center mb-10 flex flex-col items-center">
          <Eyebrow color="#FF6B4A">{t.landing.industriesEyebrow}</Eyebrow>
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] max-w-lg mx-auto mb-3">{t.landing.industriesTitle}</h2>
          <p className="text-ringo-muted max-w-lg mx-auto">{t.landing.industriesSubtitle}</p>
        </div>
        <IndustriesGrid />
      </section>

      {/* ============ RESTAURANT & FOOD ============ */}
      <section id="restaurant" className="relative overflow-hidden scroll-mt-16" style={{ backgroundColor: "#F3FBF6" }}>
        <GradientMesh tone="green" />
        <div className="relative max-w-6xl mx-auto px-5 py-20 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <Eyebrow color="#1F9D55">{t.landing.restaurantEyebrow}</Eyebrow>
            <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] mb-3" style={{ color: "#14532D" }}>
              {t.landing.restaurantTitle}
            </h2>
            <p className="mb-6 max-w-md" style={{ color: "#3F5C4D" }}>
              {t.landing.restaurantSubtitle}
            </p>
            <ul className="flex flex-col gap-3 mb-7">
              {[t.landing.restaurantPointMenu, t.landing.restaurantPointHours, t.landing.restaurantPointOrder, t.landing.restaurantPointQr].map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-sm" style={{ color: "#14532D" }}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: "#1F9D55" }}>
                    <Sparkles size={10} color="#fff" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-white px-5 py-3 rounded-card shadow-[0_10px_24px_-6px_rgba(31,157,85,0.5)] transition-transform hover:-translate-y-0.5"
              style={{ backgroundColor: "#1F9D55" }}
            >
              {t.landing.restaurantCta}
              <ArrowRight size={13} />
            </Link>
          </div>
          <RestaurantShowcase />
        </div>
      </section>

      {/* ============ HOW IT WORKS / JOURNEY ============ */}
      <section id="journey" className="relative max-w-6xl mx-auto px-5 py-20 scroll-mt-16">
        <div className="text-center mb-12 flex flex-col items-center">
          <Eyebrow color="#4F46E5">{t.landing.journeyEyebrow}</Eyebrow>
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] max-w-lg mx-auto">{t.landing.journeyTitle}</h2>
        </div>
        <JourneySteps />
      </section>

      {/* ============ NFC + QR ============ */}
      <section id="nfc" className="relative overflow-hidden py-20 scroll-mt-16" style={{ backgroundColor: "#F5F3FF" }}>
        <GradientMesh tone="violet" />
        <div className="relative max-w-4xl mx-auto px-5">
          <NfcQrSection />
        </div>
      </section>

      {/* ============ COMMERCE + CUSTOMER CONNECTION ============ */}
      <section className="relative overflow-hidden" style={{ backgroundColor: "#FFF5F2" }}>
        <GradientMesh tone="warm" />
        <div className="relative max-w-6xl mx-auto px-5 py-20">
          <div className="text-center mb-12 flex flex-col items-center">
            <Eyebrow color="#FF6B4A">{t.landing.commerceEyebrow}</Eyebrow>
            <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] max-w-lg mx-auto mb-3">{t.landing.commerceTitle}</h2>
            <p className="text-ringo-muted max-w-lg mx-auto">{t.landing.commerceSubtitle}</p>
          </div>

          <div className="text-center mb-8 flex flex-col items-center">
            <Eyebrow color="#14B8A6">{t.landing.connectionEyebrow}</Eyebrow>
            <h3 className="font-display text-xl font-medium tracking-[-0.01em] max-w-lg mx-auto mb-3">{t.landing.connectionTitle}</h3>
            <p className="text-ringo-muted max-w-lg mx-auto mb-8">{t.landing.connectionSubtitle}</p>
          </div>

          <div className="flex items-center justify-center flex-wrap gap-2">
            {[
              { icon: Eye, label: t.landing.connectionFlowVisitor, color: "#0EA5E9" },
              { icon: MousePointerClick, label: t.landing.connectionFlowConnection, color: "#4F46E5" },
              { icon: UserCheck, label: t.landing.connectionFlowCustomer, color: "#F2B705" },
              { icon: Heart, label: t.landing.connectionFlowRelationship, color: "#E11D48" },
              { icon: TrendingUp, label: t.landing.connectionFlowGrowth, color: "#1F9D55" },
            ].map((s, i, arr) => (
              <div key={s.label} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-1.5">
                  <span
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white shadow-[0_8px_20px_-6px_rgba(15,23,42,0.3)]"
                    style={{ backgroundColor: s.color }}
                  >
                    <s.icon size={18} />
                  </span>
                  <span className="text-xs font-semibold text-ringo-text">{s.label}</span>
                </div>
                {i < arr.length - 1 && <ArrowRight size={14} className="text-ringo-muted shrink-0 -mt-4" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ AFRICA ============ */}
      <section className="relative overflow-hidden">
        <GradientMesh tone="gold" className="opacity-70" />
        <div className="relative max-w-6xl mx-auto px-5 py-20 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <Eyebrow color="#F2B705">{t.landing.africaEyebrow}</Eyebrow>
            <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] mb-3">{t.landing.africaTitle}</h2>
            <p className="text-ringo-muted mb-6">{t.landing.africaSubtitle}</p>
          </div>
          <ul className="flex flex-col gap-3">
            {[
              { icon: Smartphone, text: t.landing.africaPointMobile, color: "#4F46E5" },
              { icon: FaWhatsapp, text: t.landing.africaPointWhatsapp, color: "#25D366" },
              { icon: ArrowRight, text: t.landing.africaPointQrNfc, color: "#7C3AED" },
              { icon: TrendingUp, text: t.landing.africaPointMoney, color: "#F2B705" },
              { icon: Heart, text: t.landing.africaPointLocal, color: "#E11D48" },
            ].map((p, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-ringo-text bg-ringo-surface rounded-card px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: p.color }}>
                  <p.icon size={14} />
                </span>
                <span className="pt-1.5">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ============ WHY RINGO ============ */}
      <section className="relative max-w-3xl mx-auto px-5 py-16 text-center flex flex-col items-center">
        <Eyebrow color="#14B8A6">{t.landing.whyEyebrow}</Eyebrow>
        <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] mb-3">{t.landing.whyTitle}</h2>
        <p className="text-ringo-muted">{t.landing.whySubtitle}</p>
      </section>

      {/* ============ CONTACT ============ */}
      <section className="max-w-3xl mx-auto px-5 py-16">
        <div
          className="relative overflow-hidden rounded-[28px] p-8 sm:p-10 text-center text-white"
          style={{ background: "linear-gradient(135deg, #4F46E5, #6D5EF0 55%, #FF6B4A)" }}
        >
          <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-white/10" aria-hidden="true" />
          <div className="absolute -left-8 -bottom-8 w-32 h-32 rounded-full bg-white/10" aria-hidden="true" />
          <div className="relative">
            <span className="inline-flex text-xs font-semibold tracking-wide uppercase px-3.5 py-1.5 rounded-full mb-4 bg-white/20">
              {t.landing.contactEyebrow}
            </span>
            <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] mb-3">{t.landing.contactTitle}</h2>
            <p className="text-white/80 mb-7">{t.landing.contactSubtitle}</p>

            <div className="flex flex-col items-center gap-1.5 mb-7 text-sm text-white/80">
              <p className="font-medium text-white">{t.landing.contactAddressLabel}</p>
              <p className="flex items-center gap-1.5">
                <MapPin size={13} />
                {t.landing.contactAddressLocation}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row justify-center gap-3">
              <a
                href="tel:+237694028846"
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-card bg-white text-ringo-indigo text-sm font-semibold"
              >
                <Phone size={15} />
                {t.landing.contactCall} · +237 694 028 846
              </a>
              <a
                href="mailto:info@ringoconnectltd.com"
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-card border-2 border-white/40 text-sm font-semibold text-white"
              >
                <Mail size={15} />
                {t.landing.contactEmail}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="px-5 py-16">
        <div
          className="relative overflow-hidden max-w-3xl mx-auto text-center rounded-[28px] text-white px-6 py-16 shadow-[0_24px_60px_-16px_rgba(79,70,229,0.5)]"
          style={{ background: "linear-gradient(135deg, #4F46E5, #7C3AED 50%, #F2B705)" }}
        >
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] mb-3">{t.landing.finalCtaTitle}</h2>
          <p className="text-white/80 mb-7 max-w-md mx-auto">{t.landing.finalCtaSubtitle}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-4">
            <Link href={primaryHref} className="inline-flex items-center gap-1.5 px-6 py-3 rounded-card bg-white text-ringo-indigo text-sm font-semibold">
              {isLoggedIn ? t.landing.goToDashboard : t.landing.finalCtaPrimary}
              <ArrowRight size={14} />
            </Link>
            {!isLoggedIn && (
              <Link href="/auth/login" className="inline-flex items-center gap-1.5 px-6 py-3 rounded-card border-2 border-white/40 text-white text-sm font-semibold">
                {t.landing.finalCtaSecondary}
              </Link>
            )}
          </div>
          <p className="text-xs text-white/70">{t.landing.finalCtaMicrocopy}</p>
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
