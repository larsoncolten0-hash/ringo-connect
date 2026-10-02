"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Shares the owner's own public profile link: the device share sheet where there is one, otherwise
// copy to the clipboard. Deliberately tiny. The full share menu (WhatsApp, QR, …) already lives on
// the public page (ShareButton.tsx); this only gives the dashboard a one-tap way to get that link out.
export function useShareProfile(url: string, title: string) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const flash = (next: "copied" | "failed") => {
    setStatus(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2500);
  };

  const share = useCallback(async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      flash("copied");
    } catch (err) {
      // Closing the share sheet is not an error.
      if ((err as { name?: string })?.name === "AbortError") return;
      flash("failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, title]);

  return { share, status };
}
