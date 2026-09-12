"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useSound } from "@/components/SoundProvider";

// Call show() after a successful save; renders a brief checkmark that
// fades on its own. Cheap alternative to a toast library for this scale.
// Also the single choke point for every card that saves this way (16 of
// them, from WhatsAppCard to PixelsCard) to get the same subtle success
// sound — one change here instead of touching each card individually.
export function useSavedPulse() {
  const [visible, setVisible] = useState(false);
  const { play } = useSound();

  const show = () => {
    setVisible(true);
    play("success");
    setTimeout(() => setVisible(false), 1600);
  };

  return { visible, show };
}

export default function SavedPulse({ visible, label }: { visible: boolean; label: string }) {
  const [render, setRender] = useState(visible);

  useEffect(() => {
    if (visible) setRender(true);
    else {
      const t = setTimeout(() => setRender(false), 200);
      return () => clearTimeout(t);
    }
  }, [visible]);

  if (!render) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-ringo-teal transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <Check size={13} />
      {label}
    </span>
  );
}