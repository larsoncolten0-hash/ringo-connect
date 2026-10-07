"use client";

import Link from "next/link";
import { ArrowLeft, Disc3, ShoppingBag, Ticket, User } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import PublicLanguageSelector from "@/components/PublicLanguageSelector";
import { MICRO, MP } from "./musicTheme";

// The artist's destinations: Profile (home) -> Music -> Merch -> Tickets. One language for the profile's quick links and for the bar on every destination page, so a visitor
// always knows where they are and the way back is one tap. Pure navigation: it links to pages that already exist, and only to the ones that have something to show.

export type DestinationKey = "profile" | "music" | "merch" | "tickets";
export type DestinationAvailability = { music: boolean; merch: boolean; tickets: boolean };

const RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--mp-accent)]";

function hrefFor(username: string, key: DestinationKey) {
  return key === "profile" ? `/${username}` : `/m/${username}/${key}`;
}

function iconFor(key: DestinationKey, size: number) {
  const props = { size, "aria-hidden": true as const };
  return key === "profile" ? <User {...props} /> : key === "music" ? <Disc3 {...props} /> : key === "merch" ? <ShoppingBag {...props} /> : <Ticket {...props} />;
}

function useLabels() {
  const { t } = useLanguage();
  return { profile: t.musicProfile.navProfile, music: t.musicProfile.navMusic, merch: t.musicProfile.navMerch, tickets: t.musicProfile.navTickets } as Record<DestinationKey, string>;
}

/** On the artist profile: quick links to the pages that have content. Renders nothing when there are none. */
export function DestinationPills({ username, has, preview = false }: { username: string; has: DestinationAvailability; preview?: boolean }) {
  const { t } = useLanguage();
  const labels = useLabels();
  const keys = (["music", "merch", "tickets"] as const).filter((k) => has[k]);
  if (keys.length === 0) return null;
  return (
    <nav aria-label={t.musicProfile.navLabel} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}>
      {keys.map((k) => (
        <Link
          key={k}
          href={hrefFor(username, k)}
          onClick={preview ? (e) => e.preventDefault() : undefined}
          className={`ringo-tactile flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border px-2 text-[14px] font-semibold ${RING}`}
          style={{ background: MP.surface, borderColor: MP.border, color: MP.fg }}
        >
          <span style={{ color: "var(--mp-accent)" }}>{iconFor(k, 16)}</span>
          {labels[k]}
        </Link>
      ))}
    </nav>
  );
}

/** On a destination page: the way back to the profile, and where the visitor is among the artist's pages. */
export function DestinationBar({ username, name, active, has, accent }: { username: string; name: string; active: Exclude<DestinationKey, "profile">; has: DestinationAvailability; accent: string }) {
  const { t } = useLanguage();
  const labels = useLabels();
  const keys: DestinationKey[] = ["profile", ...((["music", "merch", "tickets"] as const).filter((k) => has[k] || k === active))];
  return (
    <div className="sticky top-0 z-30 border-b backdrop-blur-md" style={{ background: "rgba(18,11,16,.86)", borderColor: MP.line }}>
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-2 px-4 pb-2.5 pt-2.5">
        <div className="flex items-center justify-between gap-3">
          <Link href={hrefFor(username, "profile")} className={`inline-flex min-h-[44px] min-w-0 items-center gap-2 rounded-full pr-3 text-[13.5px] font-semibold ${RING}`} style={{ color: MP.fg }} aria-label={`${t.musicProfile.backToProfile}: ${name}`}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: MP.border, background: MP.surface }}>
              <ArrowLeft size={16} aria-hidden="true" />
            </span>
            <span className="truncate">{name}</span>
          </Link>
          <PublicLanguageSelector variant="glass" accent={accent} />
        </div>
        <nav aria-label={t.musicProfile.navLabel} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}>
          {keys.map((k) => {
            const on = k === active;
            return (
              <Link
                key={k}
                href={hrefFor(username, k)}
                aria-current={on ? "page" : undefined}
                className={`${MICRO} inline-flex min-h-[44px] min-w-0 items-center justify-center gap-1.5 rounded-full border px-2 text-[11.5px] font-semibold uppercase tracking-[.06em] ${RING}`}
                style={on ? { background: "var(--mp-accent)", color: "var(--mp-on-accent)", borderColor: "var(--mp-accent)" } : { background: "transparent", color: MP.fg, borderColor: MP.border }}
              >
                <span className="hidden min-[400px]:inline-flex">{iconFor(k, 14)}</span>
                <span className="truncate">{labels[k]}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
