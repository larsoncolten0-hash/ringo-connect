"use client";

import { displayHref } from "@/lib/linkUrl";
import {
  FaInstagram,
  FaTiktok,
  FaXTwitter,
  FaYoutube,
  FaFacebook,
  FaLinkedin,
  FaWhatsapp,
  FaThreads,
  FaPinterest,
  FaSnapchat,
  FaTelegram,
  FaGithub,
  FaLink,
} from "react-icons/fa6";

const ICONS: Record<string, any> = {
  instagram: FaInstagram,
  tiktok: FaTiktok,
  x: FaXTwitter,
  twitter: FaXTwitter,
  youtube: FaYoutube,
  facebook: FaFacebook,
  linkedin: FaLinkedin,
  whatsapp: FaWhatsapp,
  threads: FaThreads,
  pinterest: FaPinterest,
  snapchat: FaSnapchat,
  telegram: FaTelegram,
  github: FaGithub,
};

// Each platform's real brand color, always visible on the public page —
// not just revealed on hover. Snapchat is the one deliberate exception
// to white icon-on-color: its yellow is too light for a white glyph to
// read against, so that one uses a dark icon instead.
const BRAND_STYLES: Record<string, { background: string; color: string }> = {
  instagram: { background: "linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)", color: "#fff" },
  tiktok: { background: "#000000", color: "#fff" },
  x: { background: "#000000", color: "#fff" },
  twitter: { background: "#000000", color: "#fff" },
  youtube: { background: "#FF0000", color: "#fff" },
  facebook: { background: "#1877F2", color: "#fff" },
  linkedin: { background: "#0A66C2", color: "#fff" },
  whatsapp: { background: "#25D366", color: "#fff" },
  threads: { background: "#000000", color: "#fff" },
  pinterest: { background: "#E60023", color: "#fff" },
  snapchat: { background: "#FFFC00", color: "#000" },
  telegram: { background: "#26A5E4", color: "#fff" },
  github: { background: "#181717", color: "#fff" },
};

// The Music profile's quiet treatment keeps each platform recognisable without turning the page into a rainbow: the glyph in the platform's own colour, on a faint tint of
// that colour with a hairline of it. (Colours that vanish on a dark ground are lifted a little: X and TikTok read as white with TikTok's cyan / pink edge.)
const GHOST_COLORS: Record<string, string> = {
  instagram: "#F2557F",
  tiktok: "#25F4EE",
  x: "#F5F5F5",
  twitter: "#F5F5F5",
  youtube: "#FF3B3B",
  facebook: "#4C97FF",
  linkedin: "#4A9BE8",
  whatsapp: "#25D366",
  threads: "#F5F5F5",
  pinterest: "#F0384F",
  snapchat: "#FFFC00",
  telegram: "#3DB4F0",
  github: "#F5F5F5",
};

export default function SocialIcon({
  platform,
  url,
  themed = false,
  ghost = false,
}: {
  platform: string;
  url: string;
  themed?: boolean;
  // The Music profile's quiet treatment: an outlined 48px circle in the surrounding text colour (the page decides the colours), instead of the brand-coloured chip.
  ghost?: boolean;
}) {
  const key = platform?.toLowerCase();
  const Icon = ICONS[key] || FaLink;
  const brand = BRAND_STYLES[key];

  if (ghost) {
    const ghostHref = displayHref(url);
    const tint = GHOST_COLORS[key] || "currentColor";
    return (
      <a
        href={ghostHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={platform}
        className="inline-flex h-12 w-12 items-center justify-center rounded-full border transition hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ color: tint, background: `color-mix(in srgb, ${tint} 13%, transparent)`, borderColor: `color-mix(in srgb, ${tint} 42%, transparent)` }}
      >
        <Icon size={19} aria-hidden="true" style={key === "tiktok" ? { filter: "drop-shadow(1px 1px 0 rgba(254,44,85,.85))" } : undefined} />
      </a>
    );
  }

  // Public page (themed=true) with a recognized platform: real brand
  // color, always on. Editor use (themed=false), or an unrecognized
  // platform anywhere: neutral chip that only picks up the page's accent
  // color on hover — there's no "brand color" for a generic link.
  if (themed && brand) {
    return (
      <a
        href={displayHref(url)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={platform}
        className="w-11 h-11 flex items-center justify-center rounded-full transition hover:brightness-95 hover:-translate-y-0.5"
        style={{ background: brand.background, color: brand.color }}
      >
        <Icon size={17} />
      </a>
    );
  }

  return (
    <a
      href={displayHref(url)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={platform}
      className={`w-9 h-9 flex items-center justify-center rounded-full bg-ringo-muted/10 text-ringo-text transition ${
        themed ? "hover:bg-[var(--theme)] hover:text-white" : "hover:bg-ringo-indigo hover:text-white"
      }`}
    >
      <Icon size={16} />
    </a>
  );
}