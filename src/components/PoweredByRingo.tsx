"use client";

import { useLanguage } from "@/components/LanguageProvider";

/** Where the attribution points. */
export const RINGO_CONNECT_URL = "https://ringoconnectltd.com";

// "Powered by Ringo Connect" / "Propulsé par Ringo Connect" — the small platform
// attribution shown once, at the very bottom of a public profile page. One shared
// component so every category and sub-page shows the same thing, in the
// visitor's chosen language. It inherits the page's own text colour and stays
// quiet (reduced opacity) so the owner's content and branding remain the focus;
// hover/focus makes it clearly clickable. It opens in the same tab. The link
// text itself is the accessible name, so nothing extra is needed for screen readers.
export default function PoweredByRingo({ className = "" }: { className?: string }) {
  const { t } = useLanguage();
  return (
    <p className={`text-center text-xs ${className}`}>
      <a
        href={RINGO_CONNECT_URL}
        className="inline-block rounded px-1 py-1.5 underline-offset-2 opacity-60 transition hover:underline hover:opacity-100 focus-visible:underline focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      >
        {t.profilePage.poweredBy}
      </a>
    </p>
  );
}
