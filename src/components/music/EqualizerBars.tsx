"use client";

// Tiny "now playing" indicator — three bars bouncing at staggered speeds.
// Purely decorative (no audio-reactive analysis, just a CSS animation) —
// the honest signal is the Pause icon on the button right next to it;
// this is just the bit of visual life the design pass asked for.
export default function EqualizerBars({ color }: { color: string }) {
  return (
    <span className="flex items-end gap-[2px] h-3 w-3.5 shrink-0" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full animate-eq-bar"
          style={{
            backgroundColor: color,
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </span>
  );
}
