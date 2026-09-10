// Soft, blurred color-blob background — reused across sections so the
// page reads as one coherent, colorful system rather than a plain white
// page interrupted by a few icons. `tone` picks which two brand colors
// blend for that section, so each part of the story keeps its own color
// identity (gold for Artists, green for Restaurant, etc.) while staying
// visually related to the rest.
const TONES = {
  brand: ["#4F46E5", "#FF6B4A", "#14B8A6"],
  gold: ["#F2B705", "#4F46E5"],
  green: ["#1F9D55", "#14B8A6"],
  warm: ["#FF6B4A", "#F2B705"],
  violet: ["#7C3AED", "#4F46E5"],
} as const;

export default function GradientMesh({ tone = "brand", className = "" }: { tone?: keyof typeof TONES; className?: string }) {
  const colors = TONES[tone];
  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} aria-hidden="true">
      <div
        className="absolute -top-32 -left-24 w-[420px] h-[420px] rounded-full blur-[110px] opacity-[0.22] motion-safe:animate-[pulse_8s_ease-in-out_infinite]"
        style={{ backgroundColor: colors[0] }}
      />
      <div
        className="absolute -bottom-40 -right-20 w-[460px] h-[460px] rounded-full blur-[120px] opacity-[0.18] motion-safe:animate-[pulse_10s_ease-in-out_infinite]"
        style={{ backgroundColor: colors[1] }}
      />
      {colors[2] && (
        <div
          className="absolute top-1/3 right-1/4 w-[280px] h-[280px] rounded-full blur-[100px] opacity-[0.14]"
          style={{ backgroundColor: colors[2] }}
        />
      )}
    </div>
  );
}
