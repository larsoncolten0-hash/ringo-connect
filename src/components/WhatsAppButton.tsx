"use client";

export default function WhatsAppButton({
  number,
  message,
  compact,
  radiusClass,
  onClick,
}: {
  number: string;
  message?: string;
  compact?: boolean;
  // Shape follows the creator's chosen button radius (square/rounded/pill)
  // for shape consistency with the rest of the page, even though the
  // WhatsApp CTA deliberately keeps its own fixed coral color rather than
  // adopting the brand accent — a distinct, recognizable "start a chat"
  // color is worth more than full brand matching here.
  radiusClass?: string;
  onClick?: () => void;
}) {
  if (!number) return null;

  const cleanNumber = number.replace(/[^0-9]/g, "");
  const href = `https://wa.me/${cleanNumber}${
    message ? `?text=${encodeURIComponent(message)}` : ""
  }`;
  const radius = radiusClass || "rounded-card";

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={
        compact
          ? `flex-1 text-center text-xs py-1.5 bg-ringo-coral text-white ${radius}`
          : `px-4 py-2 bg-ringo-coral text-white text-sm font-medium ${radius}`
      }
    >
      Chat on WhatsApp
    </a>
  );
}