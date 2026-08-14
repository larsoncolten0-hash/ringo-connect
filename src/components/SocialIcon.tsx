"use client";

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

export default function SocialIcon({
  platform,
  url,
  themed = false,
}: {
  platform: string;
  url: string;
  themed?: boolean;
}) {
  const key = platform?.toLowerCase();
  const Icon = ICONS[key] || FaLink;
  const brand = BRAND_STYLES[key];

  // Public page (themed=true) with a recognized platform: real brand
  // color, always on. Editor use (themed=false), or an unrecognized
  // platform anywhere: neutral chip that only picks up the page's accent
  // color on hover — there's no "brand color" for a generic link.
  if (themed && brand) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={platform}
        className="w-10 h-10 flex items-center justify-center rounded-full transition hover:brightness-95 hover:-translate-y-0.5"
        style={{ background: brand.background, color: brand.color }}
      >
        <Icon size={17} />
      </a>
    );
  }

  return (
    <a
      href={url}
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