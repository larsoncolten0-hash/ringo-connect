"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useSound } from "@/components/SoundProvider";

// A compact mute switch living directly in the scanner's own header,
// alongside ScannerAddToHomeScreen — a gate guard has no access to the
// artist dashboard's Settings, so the same global sound preference needs
// a way to be flipped from right here too. Reads/writes the exact same
// "ringo-sound" preference as everywhere else in the app (same origin,
// same localStorage), so turning it off here also silences it in the
// dashboard on this device, and vice versa.
export default function ScannerSoundToggle() {
  const { enabled, setEnabled } = useSound();

  return (
    <button
      onClick={() => setEnabled(!enabled)}
      aria-label={enabled ? "Mute scan sounds" : "Unmute scan sounds"}
      aria-pressed={enabled}
      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
      style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
    >
      {enabled ? <Volume2 size={14} className="text-white" /> : <VolumeX size={14} className="text-white/60" />}
    </button>
  );
}
