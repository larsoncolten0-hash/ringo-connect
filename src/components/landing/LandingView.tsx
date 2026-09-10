"use client";

import { useState } from "react";
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
  Building2,
  Bus,
  Briefcase,
  Link2,
  Ticket,
  QrCode as QrCodeIcon,
  BarChart3,
  Menu,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { FaWhatsapp } from "react-icons/fa6";
import { useLanguage } from "@/components/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import GradientMesh from "./GradientMesh";
import Reveal from "./Reveal";
import NavDropdown from "./NavDropdown";
import IndustryShowcase from "./IndustryShowcase";
import EcosystemDiagram from "./EcosystemDiagram";
import IndustriesGrid from "./IndustriesGrid";
import RestaurantShowcase from "./RestaurantShowcase";
import JourneySteps from "./JourneySteps";
import NfcQrSection from "./NfcQrSection";
import AffiliateSection from "./AffiliateSection";

// This homepage is deliberately built only around what's actually shipped
// in the app today: links/catalog (every category), the Music &
// Entertainment tracks/tickets/support system, the Restaurant & Food
// menu/ordering/QR-table system, WhatsApp hand-off, click analytics, QR
// codes, and the existing affiliate/referral program. The "Ringo Connect
// Card" is a real NFC tag written with a profile's URL — the same
// destination a QR code or plain link already opens, just on a different
// physical medium, so describing it costs nothing to promise. Nothing
// here claims payment collection, bookings, or integrations that don't
// exist, and no commission rate is quoted for the affiliate program since
// that's admin-configurable.
//
// Design direction: color is used with intent, not everywhere — a single
// quiet gradient wash in the hero and a couple of key moments, small
// colored kickers instead of filled pills, and the rest of the page reads
// as a calm, confident neutral canvas. Restraint is the point.
export default function LandingView({
  isLoggedIn,
  dashboardHref,
}: {
  isLoggedIn: boolean;
  dashboardHref: string;
}) {
  const { t } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Every "get started"/"create your Ringo" CTA on this page funnels into
  // the assisted /get-started form (plan pick → info → optional payment),
  // not straight to self-serve /auth/signup — that's still reachable from
  // "Log in" → "sign up" for anyone who lands there directly.
  const primaryHref = isLoggedIn ? dashboardHref : "/get-started";
  const affiliateWhatsappHref = `https://wa.me/237694028846?text=${encodeURIComponent(
    "Hi! I'd like to become a Ringo Connect affiliate."
  )}`;
  const primaryLabel = isLoggedIn ? t.landing.goToDashboard : t.landing.heroCtaPrimary;

  // A small colored dot + tracked label — not a filled pill. The
  // restrained version of the "eyebrow" pattern used site-wide.
  const Kicker = ({ children, color }: { children: React.ReactNode; color: string }) => (
    <span className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em] uppercase text-ringo-muted mb-5">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {children}
    </span>
  );

  const industryDropdownItems = [
    { icon: Music, title: t.landing.industryArtistsTitle, description: t.landing.industryArtistsBody, href: "#industries", color: "#F2B705" },
    { icon: UtensilsCrossed, title: t.landing.industryRestaurantsTitle, description: t.landing.industryRestaurantsBody, href: "#restaurant", color: "#1F9D55" },
    { icon: Store, title: t.landing.industryBusinessTitle, description: t.landing.industryBusinessBody, href: "#industries", color: "#FF6B4A" },
    { icon: Building2, title: t.landing.industryRealEstateTitle, description: t.landing.industryRealEstateBody, href: "#industries", color: "#0EA5E9" },
    { icon: Bus, title: t.landing.industryTransportTitle, description: t.landing.industryTransportBody, href: "#industries", color: "#7C3AED" },
    { icon: Briefcase, title: t.landing.industryProfessionalsTitle, description: t.landing.industryProfessionalsBody, href: "#industries", color: "#E11D48" },
  ];

  const featuresDropdownItems = [
    { icon: Link2, title: t.landing.chipLinks, description: t.landing.ecosystemSubtitle, href: "#features", color: "#4F46E5" },
    { icon: Ticket, title: t.landing.chipTickets, description: t.landing.industryArtistsBody, href: "#industries", color: "#14B8A6" },
    { icon: QrCodeIcon, title: t.landing.navNfc, description: t.landing.nfcSubtitle, href: "#nfc", color: "#7C3AED" },
    { icon: BarChart3, title: t.landing.chipAnalytics, description: t.landing.connectionSubtitle, href: "#features", color: "#0EA5E9" },
  ];

  // Flattened for the mobile menu — the rich hover dropdowns (NavDropdown)
  // are a desktop interaction; a phone gets one simple, tappable list
  // instead of trying to shrink those cards down.
  const mobileNavLinks = [
    { label: t.landing.navFeatures, href: "#features" },
    { label: t.landing.navIndustries, href: "#industries" },
    { label: t.landing.navRestaurant, href: "#restaurant" },
    { label: t.landing.navNfc, href: "#nfc" },
    { label: t.landing.navPricing, href: "/get-started" },
  ];

  return (
    <div className="min-h-screen bg-ringo-bg text-ringo-text overflow-x-hidden">
      {/* ============ NAV ============ */}
      {/* Fixed rather than sticky — sticky can visually detach and appear
          to "disappear" on scroll depending on ancestor stacking/overflow,
          fixed pins it to the viewport unconditionally. The spacer div
          right after (h-16) reserves the space fixed positioning takes
          the header out of, so page content doesn't jump under it. */}
      <header className="fixed top-0 inset-x-0 z-40 h-16 flex items-center bg-ringo-bg/80 backdrop-blur-md border-b border-ringo-border">
        <div className="max-w-6xl mx-auto w-full flex items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Image src="/logo.png" alt="Ringo Connect" width={26} height={26} className="rounded-md" />
            <span className="hidden sm:inline font-display font-medium text-ringo-text">Ringo Connect</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-7" aria-label="Main">
            <NavDropdown label={t.landing.navFeatures} items={featuresDropdownItems} columns={1} />
            <NavDropdown label={t.landing.navIndustries} items={industryDropdownItems} columns={2} />
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

          <div className="flex items-center gap-1 sm:gap-1.5">
            {/* Language/theme toggles move into the mobile menu panel below
                lg — keeps the phone header down to just what matters:
                the nav toggle and the two account actions. */}
            <div className="hidden lg:flex items-center gap-1.5">
              <LanguageToggle />
              <ThemeToggle iconOnly />
            </div>

            {isLoggedIn ? (
              <Link
                href={dashboardHref}
                className="lg:ml-1 flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-card bg-ringo-indigo text-white text-sm font-medium whitespace-nowrap"
              >
                {t.landing.goToDashboard}
                <ArrowRight size={14} />
              </Link>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="lg:ml-1 px-2.5 sm:px-3.5 py-2 rounded-card text-sm font-medium text-ringo-text hover:bg-ringo-muted/10 transition-colors whitespace-nowrap"
                >
                  {t.landing.login}
                </Link>
                <Link
                  href="/get-started"
                  className="px-3 sm:px-4 py-2 rounded-card bg-ringo-indigo text-white text-sm font-medium whitespace-nowrap"
                >
                  {t.landing.getStarted}
                </Link>
              </>
            )}

            {/* Mobile nav toggle — the dropdown panel below carries the
                links that live in the desktop nav bar above. */}
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={mobileMenuOpen ? t.landing.closeMenu : t.landing.openMenu}
              aria-expanded={mobileMenuOpen}
              className="lg:hidden shrink-0 w-9 h-9 -mr-1 rounded-card flex items-center justify-center text-ringo-text hover:bg-ringo-muted/10 transition-colors"
            >
              {mobileMenuOpen ? <X size={19} /> : <Menu size={19} />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
              className="lg:hidden absolute top-16 inset-x-0 max-h-[calc(100vh-4rem)] overflow-y-auto bg-ringo-bg border-b border-ringo-border shadow-[0_20px_40px_-16px_rgba(15,23,42,0.2)]"
            >
              <nav className="flex flex-col px-5 py-3" aria-label="Mobile">
                {mobileNavLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="py-3 text-sm font-medium text-ringo-text border-b border-ringo-border/60 last:border-0"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
              <div className="flex items-center gap-1.5 px-5 pb-4">
                <LanguageToggle />
                <ThemeToggle iconOnly />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
      <div className="h-16" aria-hidden />

      {/* ============ HERO ============ */}
      <section className="relative overflow-hidden">
        <GradientMesh tone="brand" />

        <div className="relative max-w-6xl mx-auto px-5 pt-20 sm:pt-28 pb-24 sm:pb-32 grid lg:grid-cols-[1fr_auto] gap-16 items-center">
          <div className="text-center lg:text-left flex flex-col items-center lg:items-start">
            <Kicker color="#4F46E5">{t.landing.heroEyebrow}</Kicker>
            <h1 className="font-display text-[2.75rem] sm:text-6xl lg:text-[4rem] font-medium tracking-[-0.03em] leading-[1.02] mb-7 max-w-xl">
              <span className="block">{t.landing.heroTitleLead}</span>
              <span className="block text-ringo-indigo">{t.landing.heroTitleRest}</span>
            </h1>
            <p className="text-ringo-muted text-lg max-w-md mb-10 leading-relaxed">{t.landing.heroSubtitle}</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href={primaryHref}
                className="flex items-center justify-center gap-1.5 px-7 py-3.5 rounded-full bg-ringo-indigo text-white text-sm font-semibold shadow-[0_12px_28px_-8px_rgba(79,70,229,0.5)] transition-all hover:shadow-[0_16px_36px_-8px_rgba(79,70,229,0.6)] hover:-translate-y-0.5"
              >
                {primaryLabel}
                <ArrowRight size={14} />
              </Link>
              <a
                href="#journey"
                className="flex items-center justify-center px-7 py-3.5 rounded-full border border-ringo-border text-sm font-semibold text-ringo-text hover:border-ringo-text/30 transition-colors"
              >
                {t.landing.heroCtaSecondary}
              </a>
            </div>
          </div>

          <div className="relative" style={{ perspective: 1400 }}>
            <IndustryShowcase />
          </div>
        </div>
      </section>

      {/* ============ YOUR DIGITAL WORLD (Features) ============ */}
      <section id="features" className="relative max-w-6xl mx-auto px-5 py-24 sm:py-32 scroll-mt-16">
        <Reveal className="text-center mb-16 flex flex-col items-center">
          <Kicker color="#4F46E5">{t.landing.ecosystemEyebrow}</Kicker>
          <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] max-w-lg mx-auto mb-4">{t.landing.ecosystemTitle}</h2>
          <p className="text-ringo-muted max-w-md mx-auto">{t.landing.ecosystemSubtitle}</p>
        </Reveal>
        <Reveal delay={0.1}>
          <EcosystemDiagram />
        </Reveal>
      </section>

      {/* ============ MORE THAN A LINK ============ */}
      <section className="relative max-w-6xl mx-auto px-5 py-20">
        <Reveal className="text-center mb-12 flex flex-col items-center">
          <Kicker color="#14B8A6">{t.landing.moreEyebrow}</Kicker>
          <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] max-w-lg mx-auto mb-4">{t.landing.moreTitle}</h2>
          <p className="text-ringo-muted max-w-md mx-auto">{t.landing.moreSubtitle}</p>
        </Reveal>
        <Reveal delay={0.1} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
              className="rounded-2xl bg-ringo-surface border border-ringo-border/60 px-5 py-4 text-sm font-medium text-ringo-text transition-colors hover:border-ringo-border"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-2.5 align-middle" style={{ backgroundColor: item.color }} />
              {item.label}
            </div>
          ))}
        </Reveal>
      </section>

      {/* ============ INDUSTRIES ============ */}
      <section id="industries" className="relative max-w-6xl mx-auto px-5 py-24 sm:py-32 scroll-mt-16">
        <Reveal className="text-center mb-14 flex flex-col items-center">
          <Kicker color="#FF6B4A">{t.landing.industriesEyebrow}</Kicker>
          <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] max-w-lg mx-auto mb-4">{t.landing.industriesTitle}</h2>
          <p className="text-ringo-muted max-w-md mx-auto">{t.landing.industriesSubtitle}</p>
        </Reveal>
        <Reveal delay={0.1}>
          <IndustriesGrid />
        </Reveal>
      </section>

      {/* ============ RESTAURANT & FOOD ============ */}
      <section id="restaurant" className="relative border-y border-ringo-border/60 scroll-mt-16">
        <div className="max-w-6xl mx-auto px-5 py-24 sm:py-28 grid lg:grid-cols-2 gap-14 items-center">
          <Reveal>
            <Kicker color="#1F9D55">{t.landing.restaurantEyebrow}</Kicker>
            <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] mb-4">{t.landing.restaurantTitle}</h2>
            <p className="text-ringo-muted mb-8 max-w-md leading-relaxed">{t.landing.restaurantSubtitle}</p>
            <ul className="flex flex-col gap-3.5 mb-9">
              {[t.landing.restaurantPointMenu, t.landing.restaurantPointHours, t.landing.restaurantPointOrder, t.landing.restaurantPointQr].map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm text-ringo-text">
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: "#1F9D55" }} />
                  {point}
                </li>
              ))}
            </ul>
            <Link
              href="/get-started"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-white px-6 py-3 rounded-full shadow-[0_12px_28px_-8px_rgba(31,157,85,0.45)] transition-all hover:-translate-y-0.5"
              style={{ backgroundColor: "#1F9D55" }}
            >
              {t.landing.restaurantCta}
              <ArrowRight size={13} />
            </Link>
          </Reveal>
          <Reveal delay={0.15}>
            <RestaurantShowcase />
          </Reveal>
        </div>
      </section>

      {/* ============ HOW IT WORKS / JOURNEY ============ */}
      <section id="journey" className="relative max-w-6xl mx-auto px-5 py-24 sm:py-32 scroll-mt-16">
        <Reveal className="text-center mb-16 flex flex-col items-center">
          <Kicker color="#4F46E5">{t.landing.journeyEyebrow}</Kicker>
          <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] max-w-lg mx-auto">{t.landing.journeyTitle}</h2>
        </Reveal>
        <Reveal delay={0.1}>
          <JourneySteps />
        </Reveal>
      </section>

      {/* ============ RINGO CONNECT CARD + QR ============ */}
      <section id="nfc" className="relative max-w-4xl mx-auto px-5 py-24 sm:py-28 scroll-mt-16 border-t border-ringo-border/60">
        <Reveal>
          <NfcQrSection />
        </Reveal>
      </section>

      {/* ============ COMMERCE + CUSTOMER CONNECTION ============ */}
      <section className="relative border-y border-ringo-border/60">
        <div className="max-w-6xl mx-auto px-5 py-24 sm:py-28">
          <Reveal className="text-center mb-16 flex flex-col items-center">
            <Kicker color="#FF6B4A">{t.landing.commerceEyebrow}</Kicker>
            <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] max-w-lg mx-auto mb-4">{t.landing.commerceTitle}</h2>
            <p className="text-ringo-muted max-w-md mx-auto">{t.landing.commerceSubtitle}</p>
          </Reveal>

          <Reveal delay={0.1} className="text-center mb-10 flex flex-col items-center">
            <Kicker color="#14B8A6">{t.landing.connectionEyebrow}</Kicker>
            <h3 className="font-display text-2xl font-medium tracking-[-0.01em] max-w-lg mx-auto mb-3">{t.landing.connectionTitle}</h3>
            <p className="text-ringo-muted max-w-md mx-auto mb-8">{t.landing.connectionSubtitle}</p>
          </Reveal>

          <Reveal delay={0.2} className="flex items-center justify-center flex-wrap gap-2.5">
            {[
              { icon: Eye, label: t.landing.connectionFlowVisitor },
              { icon: MousePointerClick, label: t.landing.connectionFlowConnection },
              { icon: UserCheck, label: t.landing.connectionFlowCustomer },
              { icon: Heart, label: t.landing.connectionFlowRelationship },
              { icon: TrendingUp, label: t.landing.connectionFlowGrowth },
            ].map((s, i, arr) => (
              <div key={s.label} className="flex items-center gap-2.5">
                <div className="flex flex-col items-center gap-2">
                  <span className="w-12 h-12 rounded-full bg-ringo-surface border border-ringo-border flex items-center justify-center text-ringo-indigo shadow-[0_4px_16px_-6px_rgba(15,23,42,0.15)]">
                    <s.icon size={18} />
                  </span>
                  <span className="text-xs font-medium text-ringo-text">{s.label}</span>
                </div>
                {i < arr.length - 1 && <ArrowRight size={14} className="text-ringo-border shrink-0 -mt-5" />}
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ============ START EARNING (AFFILIATE) ============ */}
      <section className="max-w-6xl mx-auto px-5 py-20">
        <Reveal>
          <AffiliateSection />
        </Reveal>
      </section>

      {/* ============ AFRICA ============ */}
      <section className="relative max-w-6xl mx-auto px-5 py-24 sm:py-28">
        <div className="grid lg:grid-cols-2 gap-14 items-center">
          <Reveal>
            <Kicker color="#F2B705">{t.landing.africaEyebrow}</Kicker>
            <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] mb-4">{t.landing.africaTitle}</h2>
            <p className="text-ringo-muted leading-relaxed">{t.landing.africaSubtitle}</p>
          </Reveal>
          <Reveal delay={0.1}>
            <ul className="flex flex-col gap-3">
              {[
                { icon: Smartphone, text: t.landing.africaPointMobile },
                { icon: FaWhatsapp, text: t.landing.africaPointWhatsapp },
                { icon: QrCodeIcon, text: t.landing.africaPointQrNfc },
                { icon: TrendingUp, text: t.landing.africaPointMoney },
                { icon: Heart, text: t.landing.africaPointLocal },
              ].map((p, i) => (
                <li key={i} className="flex items-start gap-3.5 text-sm text-ringo-text">
                  <span className="w-8 h-8 rounded-full bg-ringo-bg border border-ringo-border flex items-center justify-center shrink-0 text-ringo-indigo">
                    <p.icon size={14} />
                  </span>
                  <span className="pt-1.5">{p.text}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ============ WHY RINGO ============ */}
      <section className="relative max-w-2xl mx-auto px-5 py-16">
        <Reveal className="text-center flex flex-col items-center">
          <Kicker color="#14B8A6">{t.landing.whyEyebrow}</Kicker>
          <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] mb-4">{t.landing.whyTitle}</h2>
          <p className="text-ringo-muted leading-relaxed">{t.landing.whySubtitle}</p>
        </Reveal>
      </section>

      {/* ============ CONTACT ============ */}
      <section className="max-w-3xl mx-auto px-5 py-16">
        <Reveal
          className="relative overflow-hidden rounded-[28px] p-8 sm:p-12 text-center text-white"
          delay={0}
        >
          <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #4F46E5, #3730A3)" }} aria-hidden="true" />
          <div className="relative">
            <span className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em] uppercase text-white/70 mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
              {t.landing.contactEyebrow}
            </span>
            <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] mb-4">{t.landing.contactTitle}</h2>
            <p className="text-white/70 mb-9">{t.landing.contactSubtitle}</p>

            <div className="flex flex-col items-center gap-1.5 mb-9 text-sm text-white/70">
              <p className="font-medium text-white">{t.landing.contactAddressLabel}</p>
              <p className="flex items-center gap-1.5">
                <MapPin size={13} />
                {t.landing.contactAddressLocation}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row justify-center gap-3">
              <a
                href="tel:+237694028846"
                className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-white text-ringo-indigo text-sm font-semibold"
              >
                <Phone size={15} />
                {t.landing.contactCall} · +237 694 028 846
              </a>
              <a
                href="mailto:info@ringoconnectltd.com"
                className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-full border border-white/30 text-sm font-semibold text-white"
              >
                <Mail size={15} />
                {t.landing.contactEmail}
              </a>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="px-5 py-16">
        <Reveal className="relative overflow-hidden max-w-3xl mx-auto text-center rounded-[28px] px-6 py-20 shadow-[0_30px_70px_-20px_rgba(15,23,42,0.2)] bg-ringo-surface border border-ringo-border/60">
          <h2 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.02em] mb-4">{t.landing.finalCtaTitle}</h2>
          <p className="text-ringo-muted mb-9 max-w-md mx-auto">{t.landing.finalCtaSubtitle}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-5">
            <Link
              href={primaryHref}
              className="inline-flex items-center gap-1.5 px-7 py-3.5 rounded-full bg-ringo-indigo text-white text-sm font-semibold shadow-[0_12px_28px_-8px_rgba(79,70,229,0.5)] transition-all hover:-translate-y-0.5"
            >
              {isLoggedIn ? t.landing.goToDashboard : t.landing.finalCtaPrimary}
              <ArrowRight size={14} />
            </Link>
            {!isLoggedIn && (
              <Link href="/auth/login" className="inline-flex items-center gap-1.5 px-7 py-3.5 rounded-full border border-ringo-border text-sm font-semibold text-ringo-text">
                {t.landing.finalCtaSecondary}
              </Link>
            )}
          </div>
          <p className="text-xs text-ringo-muted">{t.landing.finalCtaMicrocopy}</p>
        </Reveal>
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
              <a href={affiliateWhatsappHref} target="_blank" rel="noopener noreferrer" className="text-ringo-muted hover:text-ringo-text transition-colors">{t.landing.footerAffiliate}</a>
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
