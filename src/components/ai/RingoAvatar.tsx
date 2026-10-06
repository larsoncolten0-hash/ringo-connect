import Ring from "@/components/brand/Ring";

// Ringo's face in the chat surfaces (Ringo AI and Ask Help): the Ring in white on a Ringo-indigo disc, with an optional small presence dot
// that pulses once every few seconds (never continuously fast; flat under reduced motion). Decorative: the surrounding title carries the name.
export default function RingoAvatar({ size = 36, live = false, className = "" }: { size?: number; live?: boolean; className?: string }) {
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <span
        className="flex h-full w-full items-center justify-center rounded-full bg-ringo-indigo text-white shadow-[0_6px_16px_-6px_rgb(var(--ringo-accent)/0.6)]"
        style={{ backgroundImage: "linear-gradient(145deg, rgb(255 255 255 / 0.18), transparent 55%)" }}
      >
        <Ring size={Math.round(size * 0.64)} state="idle" color="#FFFFFF" />
      </span>
      {live && (
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-ringo-teal text-ringo-teal ring-2 ring-ringo-surface ringo-presence" />
      )}
    </span>
  );
}
