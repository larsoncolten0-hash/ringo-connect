"use client";

import { ExternalLink, Mail } from "lucide-react";
import type { CSSProperties } from "react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import type { HeroAction } from "@/lib/heroAction";
import WhatsAppButton from "./WhatsAppButton";
import CallButton from "./CallButton";
import SaveContactButton from "./SaveContactButton";
import BookingButton from "./BookingButton";

// The top actions of a GENERIC profile (every category except Restaurant and Music, which keep their own hero
// buttons): ONE clear primary action, full width and in the page's own button style, with the remaining contact
// shortcuts underneath as quiet outline buttons that never repeat it. What the primary IS is decided by the pure
// resolver in lib/heroAction.ts; this file only draws that decision. When the answer is "Connect" there is
// nothing to draw here: Connect is rendered once, by ProfileView, inside the page content.
const PRIMARY = "w-full min-h-[48px]";
const SECONDARY = "min-h-[44px]";

export default function GenericHeroActions({
  t,
  hero,
  profile,
  accent,
  textColor,
  radiusClass,
  buttonStyle,
  onWhatsappClick,
  onLinkClick,
}: {
  t: Translations;
  hero: HeroAction;
  profile: any;
  accent: string;
  textColor: string;
  radiusClass: string;
  buttonStyle: CSSProperties;
  onWhatsappClick: () => void;
  onLinkClick: (id: string, title: string) => void;
}) {
  const { primary, secondary, callNumber } = hero;
  if (primary.kind === "connect" && secondary.length === 0) return null;

  const quiet: CSSProperties = { backgroundColor: "transparent", color: textColor, border: `2px solid ${hexToRgba(textColor, 0.35)}` };
  const row = `flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition hover:brightness-95 ${radiusClass}`;

  return (
    <div className="flex flex-col items-center gap-3 mt-5 w-full max-w-sm animate-fade-up" style={{ animationDelay: "260ms" }}>
      {primary.kind === "booking" && (
        <BookingButton profile={profile} accent={accent} className={`${row} ${PRIMARY}`} style={buttonStyle} />
      )}
      {primary.kind === "whatsapp" && (
        <WhatsAppButton
          number={primary.number}
          message={profile.default_whatsapp_message}
          radiusClass={radiusClass}
          buttonStyle={buttonStyle}
          onClick={onWhatsappClick}
          className={PRIMARY}
        />
      )}
      {primary.kind === "phone" && <CallButton number={primary.number} radiusClass={radiusClass} buttonStyle={buttonStyle} className={PRIMARY} />}
      {primary.kind === "email" && (
        <a href={`mailto:${primary.address}`} className={`${row} ${PRIMARY}`} style={buttonStyle}>
          <Mail size={16} className="shrink-0" />
          {t.profilePage.emailButton}
        </a>
      )}
      {primary.kind === "link" && (
        <a
          href={primary.href}
          target={primary.label === "website" ? "_blank" : undefined}
          rel="noopener noreferrer"
          onClick={() => onLinkClick(primary.id, primary.title)}
          className={`${row} ${PRIMARY}`}
          style={buttonStyle}
        >
          <ExternalLink size={16} className="shrink-0" />
          {primary.label === "website" ? t.profilePage.visitWebsite : t.profilePage.visitLink}
        </a>
      )}

      {secondary.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2 w-full">
          {secondary.includes("whatsapp") && (
            <WhatsAppButton
              number={profile.whatsapp_number}
              message={profile.default_whatsapp_message}
              radiusClass={radiusClass}
              buttonStyle={quiet}
              onClick={onWhatsappClick}
              className={SECONDARY}
            />
          )}
          {secondary.includes("call") && callNumber && <CallButton number={callNumber} radiusClass={radiusClass} buttonStyle={quiet} className={SECONDARY} />}
          {secondary.includes("save") && <SaveContactButton profile={profile} radiusClass={radiusClass} buttonStyle={quiet} className={SECONDARY} />}
        </div>
      )}
    </div>
  );
}
