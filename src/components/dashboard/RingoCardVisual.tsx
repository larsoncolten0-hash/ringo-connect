import { Nfc } from "lucide-react";

// The Ringo Card's UI illustration — a stylized representation of the
// physical card, never a claim about the card's actual printed design
// (see product brief section 39: "Do not imply that the actual physical
// card design must change"). Reuses the exact pulsing-rings motif from
// AuthShell.tsx ("the ring in Ringo," see globals.css's
// animate-ring-pulse-1/2/3 — already reduced-motion safe) rather than
// inventing a second animation language for this one feature.
export default function RingoCardVisual({ pulsing = false }: { pulsing?: boolean }) {
  return (
    <div className="relative flex items-center justify-center py-6" aria-hidden="true">
      {pulsing && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-[220px] h-[220px]">
            <span className="absolute inset-0 rounded-full border border-ringo-indigo animate-ring-pulse-1" />
            <span className="absolute inset-0 rounded-full border border-ringo-teal animate-ring-pulse-2" />
            <span className="absolute inset-0 rounded-full border border-ringo-coral animate-ring-pulse-3" />
          </div>
        </div>
      )}

      <div
        className="relative w-[220px] h-[138px] rounded-[18px] p-4 flex flex-col justify-between shadow-[0_16px_40px_-16px_rgba(79,70,229,0.5)] text-white"
        style={{
          background: "linear-gradient(135deg, #4F46E5 0%, #6D5BEA 55%, #FF6B4A 130%)",
        }}
      >
        <div className="flex items-center justify-between">
          <span className="font-display text-sm font-semibold tracking-[0.08em]">RINGO</span>
          <Nfc size={20} strokeWidth={2} className="opacity-90" />
        </div>
        <p className="text-[11px] leading-snug opacity-90">
          Your Ringo.
          <br />
          One tap away.
        </p>
      </div>
    </div>
  );
}
