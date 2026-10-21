"use client";

import type { CSSProperties } from "react";
import { UserPlus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { buildVCard, vCardFileName, handleSaveContactClick, type SaveContactDeps } from "@/lib/vcard";

// The real browser behind lib/vcard.ts handleSaveContactClick. On Chrome for Android a tap tries to open the Contacts app's pre-filled "create contact" screen; if nothing opened
// and the page still has focus shortly after, the same vCard download as before runs (at most once). Everywhere else this returns false and the link behaves exactly as it always did.
// It never says a contact was saved: the visitor confirms in their Contacts app. One shared in-flight flag covers every Save Contact link on the page.
const inFlight = { current: false };

export function saveContactClick(event: { preventDefault: () => void }, profile: any): boolean {
  if (typeof window === "undefined") return false;
  const pageUrl = window.location.href;
  const deps: SaveContactDeps = {
    env: {
      userAgent: navigator.userAgent,
      userAgentDataPlatform: (navigator as any).userAgentData?.platform,
      userAgentDataBrands: ((navigator as any).userAgentData?.brands as { brand: string }[] | undefined)?.map((b) => b.brand),
    },
    inFlight,
    navigate: (url) => {
      window.location.href = url;
    },
    downloadVCard: () => {
      const a = document.createElement("a");
      a.href = `data:text/vcard;charset=utf-8,${encodeURIComponent(buildVCard(profile, pageUrl))}`;
      a.download = vCardFileName(profile);
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    isPageActive: () => document.visibilityState === "visible" && document.hasFocus(),
    onLeave: (cb) => {
      const onVisibility = () => {
        if (document.visibilityState === "hidden") cb();
      };
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pagehide", cb);
      window.addEventListener("blur", cb);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pagehide", cb);
        window.removeEventListener("blur", cb);
      };
    },
    setTimer: (cb, ms) => window.setTimeout(cb, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  };
  return handleSaveContactClick(event, profile, pageUrl, deps);
}

// Lets a visitor save this profile straight into their phone's own
// Contacts app. A vCard (.vcf) data URI is what reliably opens the
// native "Add Contact" screen on iOS Safari — Safari renders a vCard
// data: URI inline as a contact card, but it commonly just downloads a
// Blob URL of the same content as an opaque file instead.
export default function SaveContactButton({
  profile,
  radiusClass,
  buttonStyle,
  compact,
  onClick,
  className,
}: {
  profile: any;
  radiusClass?: string;
  buttonStyle?: CSSProperties;
  // Icon-only, shorter — same pattern as WhatsAppButton's own `compact`,
  // for a row of secondary contact actions that shouldn't compete with a
  // page's real primary buttons (e.g. Music's Book Now/Buy Now).
  compact?: boolean;
  onClick?: () => void;
  // Extra classes from the caller (e.g. a minimum height); nothing is set by default.
  className?: string;
}) {
  const { t } = useLanguage();
  if (!profile?.whatsapp_number && !profile?.about_phone) return null;

  const pageUrl = typeof window !== "undefined" ? window.location.href : undefined;
  const vcard = buildVCard(profile, pageUrl);
  const href = `data:text/vcard;charset=utf-8,${encodeURIComponent(vcard)}`;
  const radius = radiusClass || "rounded-card";
  const style: CSSProperties = buttonStyle || {
    backgroundColor: "transparent",
    border: "2px solid currentColor",
  };

  return (
    <a
      href={href}
      download={vCardFileName(profile)}
      onClick={(e) => {
        onClick?.();
        saveContactClick(e, profile);
      }}
      className={`flex items-center justify-center gap-2 transition hover:brightness-95 ${
        compact ? "flex-1 py-1.5" : "px-4 py-2.5 text-sm font-medium"
      } ${radius} ${className ?? ""}`}
      style={style}
    >
      <UserPlus size={compact ? 15 : 16} className="shrink-0" />
      {!compact && t.profilePage.saveContactButton}
    </a>
  );
}
