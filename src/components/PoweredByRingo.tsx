"use client";

import { ArrowUpRight } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

/** Where the attribution points. */
export const RINGO_CONNECT_URL = "https://ringoconnectltd.com";

// "Powered by [ Ringo Connect ↗ ]" — the small platform attribution shown once, at the very bottom
// of a public profile page. One shared component so every category and sub-page shows the same
// thing, in the visitor's chosen language. The WHOLE bordered label is one link (a comfortable
// 40px-tall touch target). "Powered by" is quieter than the brand name; the border and text take
// the page's own colour (currentColor), so contrast follows whatever light or dark background the
// owner chose. Hover/focus only change opacity and a faint tint — no movement. It opens in the same
// tab. The full phrase is the accessible name; the arrow is decorative.
export default function PoweredByRingo({ className = "" }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <p className={`text-center text-xs ${className}`}>
      <a
        href={RINGO_CONNECT_URL}
        aria-label={t.profilePage.poweredBy}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-current px-3.5 py-1.5 opacity-80 transition hover:opacity-100 hover:[background-color:color-mix(in_srgb,currentColor_10%,transparent)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      >
        <span aria-hidden="true" className="font-normal opacity-70">{t.profilePage.poweredByPrefix}</span>
        <span aria-hidden="true" className="inline-flex items-center gap-0.5 font-semibold">
          {t.profilePage.poweredByName}
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </a>
    </p>
  );
}
