"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Mail } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { useLanguage } from "@/components/LanguageProvider";
import BrandLogo from "@/components/BrandLogo";
import Ring from "@/components/brand/Ring";
import Reveal from "./Reveal";
import { Section, primaryButtonOnInk, secondaryButtonOnInk } from "./Section";

// The close: the page returns to its central idea (the hero's own headline strings), on the dark material with the Ring as a large
// faint emblem, the same gold button as the hero and header, and the existing contact ways (WhatsApp and email, unchanged) as a quiet
// row beneath. Strong, but deliberately smaller and calmer than the hero. The footer follows on the same ink, so the page ends as one
// continuous dark mass rather than a CTA card followed by a separate footer.
export function ClosingCta({ isLoggedIn, primaryHref }: { isLoggedIn: boolean; primaryHref: string }) {
  const { t } = useLanguage();
  const l = t.landing;

  return (
    <Section tone="ink">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-1/2 h-[420px] w-[420px] -translate-y-1/2 opacity-[0.3] sm:-right-10 sm:h-[560px] sm:w-[560px]"
      >
        <Ring size={560} state="idle" weight="fine" className="h-full w-full" />
      </div>

      <div className="relative max-w-2xl">
        <Reveal>
          <h2 className="ringo-display text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.03em] text-balance sm:text-6xl">
            <span className="block">{l.heroTitleLead}</span>
            <span className="block text-ringo-gold">{l.heroTitleRest}</span>
          </h2>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-ringo-stone-300">{l.finalCtaSubtitle}</p>
          <div className="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link href={primaryHref} className={primaryButtonOnInk}>
              {isLoggedIn ? l.goToDashboard : l.finalCtaPrimary}
              <ArrowRight size={14} />
            </Link>
            {!isLoggedIn && (
              <Link href="/auth/login" className={secondaryButtonOnInk}>
                {l.finalCtaSecondary}
              </Link>
            )}
          </div>
          <p className="mt-5 text-sm text-ringo-stone-300">{l.finalCtaMicrocopy}</p>
        </Reveal>

        <Reveal delay={0.1} className="mt-16 border-t border-ringo-paper/10 pt-8">
          <p className="ringo-display text-lg font-semibold">{l.contactTitle}</p>
          <p className="mt-1 text-sm text-ringo-stone-300">{l.contactSubtitle}</p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <a href="https://wa.me/237694028846" target="_blank" rel="noopener noreferrer" className={secondaryButtonOnInk}>
              <FaWhatsapp size={16} />
              {l.contactWhatsapp}
            </a>
            <a href="mailto:info@ringoconnectltd.com" className={secondaryButtonOnInk}>
              <Mail size={16} />
              {l.contactEmail}
            </a>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

export function LandingFooter({ logoUrl, appName, affiliateHref }: { logoUrl: string; appName: string; affiliateHref: string }) {
  const { t } = useLanguage();
  const l = t.landing;
  const link = "inline-flex min-h-[44px] items-center text-ringo-stone-300 transition-colors hover:text-ringo-gold-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-paper";
  const heading = "ringo-display mb-3 text-sm font-semibold text-ringo-paper";

  return (
    <footer className="border-t border-ringo-paper/10 bg-ringo-ink text-ringo-paper">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="mb-3 flex items-center text-sm">
            <BrandLogo
              logoUrl={logoUrl}
              appName={appName}
              variant="full"
              height={24}
              tone="dark"
              legacy={
                <span className="flex items-center gap-2">
                  <Image src={logoUrl} alt="" width={22} height={22} className="rounded-md object-contain" />
                  <span className="ringo-display text-sm font-medium">{appName}</span>
                </span>
              }
            />
          </div>
          <p className="text-sm leading-relaxed text-ringo-stone-300">{l.footerTagline}</p>
        </div>

        <div>
          <h3 className={heading}>{l.footerProductHeading}</h3>
          <div className="flex flex-col text-sm">
            <a href="#features" className={link}>{l.navFeatures}</a>
            <a href="#pricing" className={link}>{l.navPricing}</a>
            <a href="#nfc" className={link}>{l.navNfc}</a>
            <a href={affiliateHref} target="_blank" rel="noopener noreferrer" className={link}>{l.footerAffiliate}</a>
          </div>
        </div>

        <div>
          <h3 className={heading}>{l.footerIndustriesHeading}</h3>
          <div className="flex flex-col text-sm">
            <a href="#industries" className={link}>{l.industryArtistsTitle}</a>
            <a href="#restaurant" className={link}>{l.industryRestaurantsTitle}</a>
            <a href="#industries" className={link}>{l.industryBusinessTitle}</a>
            <a href="#industries" className={link}>{l.industryRealEstateTitle}</a>
          </div>
        </div>

        <div>
          <h3 className={heading}>{l.footerCompanyHeading}</h3>
          <div className="flex flex-col text-sm">
            <Link href="/terms" className={link}>{l.footerTerms}</Link>
            <Link href="/privacy" className={link}>{l.footerPrivacy}</Link>
            <a href="mailto:info@ringoconnectltd.com" className={link}>info@ringoconnectltd.com</a>
            <a href="tel:+237694028846" className={link}>+237 694 028 846</a>
          </div>
        </div>
      </div>
      <div className="border-t border-ringo-paper/10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-5 py-5 text-xs text-ringo-stone-300 sm:flex-row">
          <p>© {new Date().getFullYear()} Ringo Connect Ltd. {l.footerRights}</p>
          <p>{l.contactAddressLocation}</p>
        </div>
      </div>
    </footer>
  );
}
