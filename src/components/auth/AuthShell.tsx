"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { DEFAULT_BRANDING } from "@/lib/brandingDefaults";

// Every page that renders this has "use client" at the top (login,
// signup, forgot/reset password, confirm, confirmed, logout) — so unlike
// DashboardShell/AdminShell/LandingView (all fed branding as a prop from
// a Server Component layout/page), this fetches it itself from the
// public GET /api/branding, starting from DEFAULT_BRANDING so the panel
// never shows placeholder/missing content while that request is in
// flight. Importing src/lib/branding.ts directly here isn't an option —
// it pulls in next/headers transitively (via createAdminClient), which
// Next.js refuses to bundle into a Client Component at all.
export default function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const [{ appName, logoUrl }, setBranding] = useState(DEFAULT_BRANDING);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/branding")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && !cancelled) setBranding(data);
      })
      .catch(() => {
        // Silent — DEFAULT_BRANDING already rendered, matching today's
        // real values in the common case where nothing's been customized.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen grid lg:grid-cols-[42%_1fr]">
      {/* Brand panel */}
      <div className="hidden lg:flex relative flex-col justify-between bg-[#0B1023] text-white p-10 overflow-hidden">
        <Link href="/" className="flex items-center gap-2.5 relative z-10">
          <Image src={logoUrl} alt="" width={28} height={28} className="rounded-md object-contain" />
          <span className="font-display font-medium text-lg">{appName}</span>
        </Link>

        {/* Signature: pulsing signal rings + orbiting node — the "ring" in Ringo */}
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <div className="relative w-[280px] h-[280px]">
            <span className="absolute inset-0 rounded-full border border-ringo-indigo animate-ring-pulse-1" />
            <span className="absolute inset-0 rounded-full border border-ringo-teal animate-ring-pulse-2" />
            <span className="absolute inset-0 rounded-full border border-ringo-coral animate-ring-pulse-3" />
            <div className="absolute left-1/2 top-1/2 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-white" />
            <div className="absolute left-1/2 top-1/2 w-full h-full animate-orbit">
              <div className="w-2.5 h-2.5 rounded-full bg-ringo-coral" />
            </div>
          </div>
        </div>

        <div className="relative z-10 max-w-xs">
          <p className="font-display text-2xl leading-snug mb-2">
            One page. Every link, every product, one chat away.
          </p>
          <p className="text-sm text-white/60">
            Creators use {appName} to turn a single link into their storefront, their socials, and a direct line on WhatsApp.
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-sm mx-auto">
          <Link href="/" className="lg:hidden flex items-center gap-2 mb-8">
            <Image src={logoUrl} alt="" width={26} height={26} className="rounded-md object-contain" />
            <span className="font-display font-medium text-ringo-text">{appName}</span>
          </Link>
          <p className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2">
            {eyebrow}
          </p>
          <h1 className="font-display text-2xl font-medium text-ringo-text mb-1">{title}</h1>
          <p className="text-sm text-ringo-muted mb-8">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
