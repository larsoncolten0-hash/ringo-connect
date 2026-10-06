"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import BrandLogo from "@/components/BrandLogo";
import {
  ArrowRight,
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
  Smartphone,
  Menu,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import MenuBackdrop from "@/components/ui/MenuBackdrop";
import { useLanguage } from "@/components/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Reveal from "./Reveal";
import NavDropdown from "./NavDropdown";
import HeroRingoObject from "./HeroRingoObject";
import { heroDisplay } from "./heroFont";
import IdeaSection from "./IdeaSection";
import ConnectionSection from "./ConnectionSection";
import IndustriesSection from "./IndustriesSection";
import RestaurantSection from "./RestaurantSection";
import CardStorySection from "./CardStorySection";
import CommerceStory from "./CommerceStory";
import JourneySteps from "./JourneySteps";
import PricingSection from "./PricingSection";
import PathPickerSection from "./PathPickerSection";
import AffiliateSection from "./AffiliateSection";
import { ClosingCta, LandingFooter } from "./ClosingSection";
import { Section, SectionHeading } from "./Section";

// Every claim on this page maps to something Ringo really does today:
// links, music (releases, tickets, fan support), a product catalog,
// restaurant menus with dine-in/takeaway/delivery ordering, event
// tickets, WhatsApp-first contact, QR codes and the Ringo Connect Card
// (a real NFC tag written with a profile's URL), customer connections
// and booking, the Community follower/announcement system, and the
// existing affiliate/referral program. Nothing here claims payment
// collection or integrations that don't exist, and no commission rate is
// quoted for the affiliate program since that's admin-configurable.
//
// Design (Phase 2): one story on one visual language, "warm technology". Strongest to quietest:
//   hero (the Ringo Card)  >  the connection story, the Ringo Card + QR, the close (dark material)  >  supporting product stories
//   >  informational sections (quiet). Light and dark alternate on purpose: hero, idea (quiet), connection (ink), industries,
//   restaurant (quiet), the Card (ink), commerce, how it works (quiet), pricing, path picker (quiet), affiliate, the close (ink).
// Gold marks identity and the one important action (header, hero and close share the same button); teal appears only where something is
// connected. The indigo brand token is no longer used on this page, but is untouched for the rest of the app.
export default function LandingView({
  isLoggedIn,
  dashboardHref,
  appName,
  logoUrl,
  plans,
  bundleAddons,
  isCameroon,
}: {
  isLoggedIn: boolean;
  dashboardHref: string;
  // Platform branding (src/lib/branding.ts) — see AdminShell.tsx's own
  // comment on why this isn't hardcoded.
  appName: string;
  logoUrl: string;
  // All 5 plans (free/basic/pro/business_basic/business_pro), for the
  // #pricing section — fetched server-side in src/app/page.tsx, same
  // reason appName/logoUrl are props instead of a client-side fetch.
  plans: any[];
  // The two Ringo Card bundle addon rows, for #pricing's third "Ringo
  // Card" track (A5 of the entry-point restructure) — see
  // PricingSection.tsx.
  bundleAddons: any[];
  isCameroon: boolean;
}) {
  const { t } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Every "get started"/"create your Ringo" CTA on this page funnels into
  // the assisted /get-started form (plan pick → info → optional payment) —
  // "Log in" → "Create one" now lands here too, not on self-serve
  // /auth/signup (still reachable directly, just no longer linked to).
  const primaryHref = isLoggedIn ? dashboardHref : "/get-started";
  const affiliateWhatsappHref = `https://wa.me/237694028846?text=${encodeURIComponent(
    "Hi! I'd like to become a Ringo Connect affiliate."
  )}`;
  const primaryLabel = isLoggedIn ? t.landing.goToDashboard : t.landing.heroCtaPrimary;

  const industryDropdownItems = [
    { icon: Music, title: t.landing.industryArtistsTitle, description: t.landing.industryArtistsBody, href: "#industries" },
    { icon: UtensilsCrossed, title: t.landing.industryRestaurantsTitle, description: t.landing.industryRestaurantsBody, href: "#restaurant" },
    { icon: Store, title: t.landing.industryBusinessTitle, description: t.landing.industryBusinessBody, href: "#industries" },
    { icon: Building2, title: t.landing.industryRealEstateTitle, description: t.landing.industryRealEstateBody, href: "#industries" },
    { icon: Bus, title: t.landing.industryTransportTitle, description: t.landing.industryTransportBody, href: "#industries" },
    { icon: Briefcase, title: t.landing.industryProfessionalsTitle, description: t.landing.industryProfessionalsBody, href: "#industries" },
  ];

  // Two very different accounts share the same "Log in" word: the creator/business dashboard
  // (existing /auth/login) and a customer's own My Ringo (their saved profiles/tickets/orders,
  // reachable again from here if they lose their installed PWA — /my-ringo/signin, unchanged).
  const loginDropdownItems = [
    { icon: Building2, title: t.landing.loginCreatorTitle, description: t.landing.loginCreatorDesc, href: "/auth/login" },
    { icon: Smartphone, title: t.landing.loginMyRingoTitle, description: t.landing.loginMyRingoDesc, href: "/my-ringo/signin" },
  ];

  const featuresDropdownItems = [
    { icon: Link2, title: t.landing.chipLinks, description: t.landing.ecosystemSubtitle, href: "#features" },
    { icon: Ticket, title: t.landing.chipTickets, description: t.landing.industryArtistsBody, href: "#industries" },
    { icon: QrCodeIcon, title: t.landing.navNfc, description: t.landing.nfcSubtitle, href: "#nfc" },
    { icon: BarChart3, title: t.landing.chipAnalytics, description: t.landing.connectionSubtitle, href: "#features" },
  ];

  // Flattened for the mobile menu — the rich hover dropdowns (NavDropdown)
  // are a desktop interaction; a phone gets one simple, tappable list
  // instead of trying to shrink those cards down.
  const mobileNavLinks = [
    { label: t.landing.navFeatures, href: "#features" },
    { label: t.landing.navIndustries, href: "#industries" },
    { label: t.landing.navRestaurant, href: "#restaurant" },
    { label: t.landing.navNfc, href: "#nfc" },
    { label: t.landing.navPricing, href: "#pricing" },
    // The desktop nav offers this as a second option inside the "Log in" dropdown (see
    // loginDropdownItems above) — the mobile menu is a flat list, so it gets its own row instead.
    { label: t.landing.loginMyRingoTitle, href: "/my-ringo/signin" },
  ];

  const navLink =
    "inline-flex min-h-[44px] items-center text-sm text-ringo-muted hover:text-ringo-text transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-text";
  const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-text";
  // The header CTA is the hero's gold button at header size: one family of primary actions on the whole page.
  const headerCta = `ringo-tactile ringo-cta inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-full text-sm font-semibold whitespace-nowrap ${focusRing}`;

  return (
    <div className={`ringo-indigo-world min-h-screen bg-ringo-bg text-ringo-text overflow-x-hidden ${heroDisplay.variable}`}>
      {/* ============ NAV ============ */}
      {/* Fixed rather than sticky — sticky can visually detach and appear
          to "disappear" on scroll depending on ancestor stacking/overflow,
          fixed pins it to the viewport unconditionally. The spacer div
          right after (h-16) reserves the space fixed positioning takes
          the header out of, so page content doesn't jump under it.
          The bar is the design system's one glass recipe (it floats over scrolling content, so blur earns its place) with a warm
          hairline and no elevation. */}
      <header className="ringo-glass fixed top-0 inset-x-0 z-40 h-16 flex items-center rounded-none border-x-0 border-t-0 border-b border-ringo-line-warm shadow-none">
        <div className="max-w-6xl mx-auto w-full flex items-center justify-between gap-2 px-5">
          <Link href="/" className={`flex items-center shrink-0 min-h-[44px] text-ringo-text ${focusRing}`}>
            <BrandLogo
              logoUrl={logoUrl}
              appName={appName}
              variant="responsive"
              height={26}
              legacy={
                <span className="flex items-center gap-2">
                  <Image src={logoUrl} alt={appName} width={26} height={26} className="rounded-md object-contain" />
                  <span className="hidden sm:inline ringo-display font-medium text-ringo-text">{appName}</span>
                </span>
              }
            />
          </Link>

          <nav className="hidden lg:flex items-center gap-7" aria-label="Main">
            <NavDropdown label={t.landing.navFeatures} items={featuresDropdownItems} columns={1} />
            <NavDropdown label={t.landing.navIndustries} items={industryDropdownItems} columns={2} />
            <a href="#restaurant" className={navLink}>
              {t.landing.navRestaurant}
            </a>
            <a href="#nfc" className={navLink}>
              {t.landing.navNfc}
            </a>
            <a href="#pricing" className={`${navLink} min-w-[44px] justify-center`}>
              {t.landing.navPricing}
            </a>
          </nav>

          <div className="flex items-center gap-0.5 sm:gap-1.5">
            {/* the two shared toggles are 36px; inside this header they are raised to the 44px touch target */}
            <div className="contents ringo-touch-toggles">
              <LanguageToggle />
              <ThemeToggle iconOnly />
            </div>

            {isLoggedIn ? (
              <Link href={dashboardHref} className={`lg:ml-1 w-11 sm:w-auto sm:px-4 ${headerCta}`}>
                <span className="sr-only sm:not-sr-only">{t.landing.goToDashboard}</span>
                <ArrowRight size={14} />
              </Link>
            ) : (
              <>
                {/* Desktop: a real choice between the two very different accounts sharing this
                    word. Mobile keeps the original plain link (unchanged) — NavDropdown's own
                    panel width was only ever designed for >= sm screens (it's only ever rendered
                    inside the lg:flex nav elsewhere on this page); "My Ringo" gets its own row in
                    the mobile menu below instead of forcing that dropdown into a width it was
                    never built for. Under 400px the plain link moves into the menu panel as well,
                    so the one gold action and the language toggle keep the room they need. */}
                <div className="hidden lg:block lg:ml-1">
                  <NavDropdown label={t.landing.login} items={loginDropdownItems} columns={1} />
                </div>
                <Link
                  href="/auth/login"
                  className="max-[399px]:hidden lg:hidden px-2.5 py-2 rounded-card text-sm font-medium text-ringo-text hover:bg-ringo-muted/10 transition-colors whitespace-nowrap inline-flex items-center min-h-[44px]"
                >
                  {t.landing.login}
                </Link>
                <Link href="/get-started" className={`px-3.5 sm:px-4 ${headerCta}`}>
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
              className={`lg:hidden shrink-0 w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-ringo-text hover:bg-ringo-muted/10 transition-colors ${focusRing}`}
            >
              {mobileMenuOpen ? <X size={19} /> : <Menu size={19} />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {mobileMenuOpen && (
            <>
              <MenuBackdrop key="backdrop" onClose={() => setMobileMenuOpen(false)} className="z-20" topClassName="top-16" portal />
              <motion.div
                key="panel"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.16 }}
                className="lg:hidden absolute top-16 inset-x-0 z-40 max-h-[calc(100vh-4rem)] overflow-y-auto bg-ringo-bg border-b border-ringo-line-warm shadow-ringo-3"
              >
                <nav className="flex flex-col px-5 py-2" aria-label="Mobile">
                  {mobileNavLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center min-h-[48px] text-base font-medium text-ringo-text border-b border-ringo-line-warm last:border-0 ${focusRing}`}
                    >
                      {link.label}
                    </Link>
                  ))}
                  {!isLoggedIn && (
                    <Link
                      href="/auth/login"
                      onClick={() => setMobileMenuOpen(false)}
                      className={`min-[400px]:hidden flex items-center min-h-[48px] text-base font-medium text-ringo-text border-t border-ringo-line-warm ${focusRing}`}
                    >
                      {t.landing.login}
                    </Link>
                  )}
                </nav>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </header>
      <div className="h-16" aria-hidden />

      {/* ============ HERO ============ */}
      {/* Phase 2A visual pilot, the first surface on the Ringo design foundation (see src/lib/design, src/components/brand).
          Mobile order is deliberate: headline, what it is, the way in, then the object, which starts inside the first screen on a
          phone and is the focal point from lg up. The destinations are unchanged: primaryHref and #journey. */}
      <section className="relative overflow-hidden">
        <div className="relative max-w-6xl mx-auto px-5 pt-10 sm:pt-20 pb-14 sm:pb-20 grid lg:grid-cols-[1.15fr_1fr] gap-12 lg:gap-16 items-center">
          <div className="flex flex-col items-start">
            <h1
              className="text-[2.5rem] min-[380px]:text-[2.75rem] sm:text-6xl lg:text-[4rem] font-semibold tracking-[-0.03em] leading-[1.02] text-balance mb-6 max-w-xl"
              style={{ fontFamily: "var(--font-hero-display), var(--font-display), sans-serif" }}
            >
              <span className="block">{t.landing.heroTitleLead}</span>
              <span className="block text-ringo-gold-display">{t.landing.heroTitleRest}</span>
            </h1>
            <p className="text-ringo-muted text-lg max-w-md mb-9 leading-relaxed">{t.landing.heroSubtitle}</p>
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <Link
                href={primaryHref}
                className="ringo-tactile ringo-cta flex items-center justify-center gap-1.5 min-h-[48px] px-7 rounded-full text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-text"
              >
                {primaryLabel}
                <ArrowRight size={14} />
              </Link>
              <a
                href="#journey"
                className="ringo-press transition-[transform,opacity,border-color] duration-ringo-fast ease-ringo flex items-center justify-center min-h-[48px] px-7 rounded-full border border-ringo-line-warm text-sm font-semibold text-ringo-text hover:border-ringo-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-text"
              >
                {t.landing.heroCtaSecondary}
              </a>
            </div>
          </div>

          <HeroRingoObject />
        </div>
      </section>

      {/* ============ THE IDEA (#features) ============ */}
      <IdeaSection />

      {/* ============ MADE FOR REAL CONNECTION (Africa-first) ============ */}
      <ConnectionSection />

      {/* ============ BUILT FOR WHAT YOU DO (#industries) ============ */}
      <IndustriesSection />

      {/* ============ RESTAURANT & FOOD (#restaurant) ============ */}
      <RestaurantSection />

      {/* ============ RINGO CARD + QR (#nfc) ============ */}
      <CardStorySection />

      {/* ============ COMMERCE ============ */}
      <CommerceStory />

      {/* ============ HOW IT WORKS (#journey) ============ */}
      <Section id="journey" tone="quiet">
        <Reveal>
          <SectionHeading title={t.landing.journeyTitle} />
        </Reveal>
        <Reveal delay={0.1} className="mt-12">
          <JourneySteps />
        </Reveal>
      </Section>

      {/* ============ PRICING (#pricing) ============ */}
      <Section id="pricing">
        <Reveal className="mb-12 flex flex-col items-center text-center">
          <SectionHeading title={t.landing.pricingTitle} lead={t.landing.pricingSubtitle} className="mx-auto" />
        </Reveal>
        <Reveal delay={0.1}>
          <PricingSection plans={plans} bundleAddons={bundleAddons} isCameroon={isCameroon} />
        </Reveal>
      </Section>

      {/* ============ NOT SURE WHERE TO START? (path picker, the bridge to the funnels) ============ */}
      <PathPickerSection />

      {/* ============ START EARNING (AFFILIATE) ============ */}
      <Section innerClassName="!py-14 sm:!py-20">
        <Reveal>
          <AffiliateSection />
        </Reveal>
      </Section>

      {/* ============ THE CLOSE + FOOTER ============ */}
      <ClosingCta isLoggedIn={isLoggedIn} primaryHref={primaryHref} />
      <LandingFooter logoUrl={logoUrl} appName={appName} affiliateHref={affiliateWhatsappHref} />
    </div>
  );
}
