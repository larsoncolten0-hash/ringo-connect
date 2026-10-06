"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// The one button for every plan action: Upgrade plan, Renew, Resubscribe, Unlock. Until now each place styled its own (underlined text, a small coloured
// word, a gradient card), so an important action could read as a footnote. This is the existing Ringo button language (ringo-tactile: a physical press;
// ringo-cta: the accent fill used for the few important actions; rounded-card: the corner radius of every other dashboard button), always bordered, always
// at least 44px tall, with a visible keyboard focus ring. Motion follows the foundation, so reduced-motion is already honoured (globals.css).
//
//   primary    the accent fill: THE action on a screen (a locked feature's screen).
//   secondary  accent border and text on a tinted ground: the same action inside a card or beside a sentence.
//   onDark     a white border and text: on the gradient upgrade card and the colored renew banners.
//
// A plan action also remembers where the person was (?from=<this page>), so that after upgrading they are taken back to what they were doing instead of
// being left on the subscription page. The subscription page validates the value; a link to anywhere else never carries it.
const BASE =
  "ringo-tactile inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-card border px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
const VARIANT = {
  primary: "ringo-cta border-ringo-accent focus-visible:ring-ringo-accent/60",
  secondary: "border-ringo-indigo bg-ringo-indigo/[0.06] text-ringo-indigo hover:bg-ringo-indigo/[0.12] focus-visible:ring-ringo-indigo/50",
  onDark: "border-white/80 bg-white/10 text-white hover:bg-white/20 focus-visible:ring-white/70 focus-visible:ring-offset-0",
} as const;

export const PLAN_HREF = "/dashboard/subscription";

export default function PlanCta({
  children,
  href = PLAN_HREF,
  variant = "secondary",
  className = "",
  ariaLabel,
}: {
  children: ReactNode;
  href?: string;
  variant?: keyof typeof VARIANT;
  className?: string;
  ariaLabel?: string;
}) {
  const pathname = usePathname();
  // only the plan page gets the return marker, and never from the plan page itself
  const target = href === PLAN_HREF && pathname && pathname.startsWith("/dashboard") && !pathname.startsWith(PLAN_HREF) ? `${PLAN_HREF}?from=${encodeURIComponent(pathname)}` : href;
  return (
    <Link href={target} aria-label={ariaLabel} className={`${BASE} ${VARIANT[variant]} ${className}`}>
      {children}
    </Link>
  );
}
