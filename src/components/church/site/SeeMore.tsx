import { ArrowRight } from "lucide-react";
import type { Translations } from "@/lib/i18n/translations";

// The "See more" link under a church section: it opens that section's landing page. A real link, at least 44px tall, named for what it opens ("See more: Announcements") so a screen reader hears more than
// "See more". Drawn only by the cards that were given a destination, so it never appears in the dashboard preview (which gives none).
export default function SeeMore({ t, href, subject, color, borderColor, className = "" }: { t: Translations; href: string; subject: string; color: string; borderColor: string; className?: string }) {
  const c = t.churchSite.public;
  return (
    <a
      href={href}
      aria-label={c.seeMoreAbout(subject)}
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-5 text-sm font-semibold transition-colors hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${className}`}
      style={{ color, borderColor, outlineColor: color }}
    >
      {c.seeMore}
      <ArrowRight size={15} aria-hidden="true" />
    </a>
  );
}
