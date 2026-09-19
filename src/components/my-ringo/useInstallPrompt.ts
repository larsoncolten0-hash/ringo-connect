"use client";

import { useCallback, useEffect, useState } from "react";

// "Install My Ringo" via the browser's STANDARD PWA install mechanism — no
// faking. Chrome/Edge/Android fire `beforeinstallprompt`; we keep that event
// and replay it from a real button click. iOS Safari has no such event, so
// there we can only explain Share → Add to Home Screen. Anything else gets a
// plain explanation instead of a dead button.
//
// The listener is attached at MODULE load (imported by PwaInstallCapture in
// the My Ringo layout), because the browser can fire the event before any
// page-level component has mounted — a hook that only listened after mount
// would miss it.

type Deferred = { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: Deferred | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as unknown as Deferred;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    notify();
  });
}

export type InstallState = "checking" | "installed" | "available" | "ios" | "unavailable";

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true);

const isIos = () =>
  typeof navigator !== "undefined" &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

// How long to wait for a `beforeinstallprompt` before concluding installation
// isn't offered here (already installed elsewhere, unsupported browser,
// criteria not met yet).
const GRACE_MS = 3000;

export function useInstallPrompt() {
  const [state, setState] = useState<InstallState>("checking");

  const compute = useCallback((graceOver: boolean): InstallState => {
    if (installed || isStandalone()) return "installed";
    if (deferred) return "available";
    if (isIos()) return "ios";
    return graceOver ? "unavailable" : "checking";
  }, []);

  useEffect(() => {
    let graceOver = false;
    const update = () => setState(compute(graceOver));
    listeners.add(update);
    update();
    const timer = setTimeout(() => {
      graceOver = true;
      update();
    }, GRACE_MS);
    return () => {
      listeners.delete(update);
      clearTimeout(timer);
    };
  }, [compute]);

  const install = useCallback(async () => {
    if (!deferred) return;
    const prompt = deferred;
    deferred = null; // a prompt event can only be used once
    await prompt.prompt();
    await prompt.userChoice.catch(() => null);
    notify();
  }, []);

  return { state, install };
}
