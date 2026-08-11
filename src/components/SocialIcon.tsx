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

export default function SocialIcon({
  platform,
  url,
  themed = false,
}: {
  platform: string;
  url: string;
  themed?: boolean;
}) {
  const Icon = ICONS[platform?.toLowerCase()] || FaLink;

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