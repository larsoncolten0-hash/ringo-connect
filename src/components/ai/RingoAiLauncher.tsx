"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Lock, Sparkles } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import RingoAiPanel, { type AiStatus } from "./RingoAiPanel";
import AiLockedPanel from "./AiLockedPanel";

// Ringo AI's entry point on the dashboard. Renders NOTHING until
// /api/ai/status says this signed-in owner is allowed (kill switch on,
// beta access, own workspace, not a demo) — so for everyone else the
// dashboard is exactly as before. Sits just above the existing "Ask help"
// button (HelpWidget) and one layer below it, so opening the help chat
// still covers it.
export default function RingoAiLauncher() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [open, setOpen] = useState(false);
  // true for an account whose plan does not include Ringo AI: the assistant is shown, locked, so it can be discovered (the chat API still refuses it)
  const [locked, setLocked] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // closing the panel hands focus back to the launcher button that opened it
  useEffect(() => {
    if (wasOpen.current && !open) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const [initialMessage, setInitialMessage] = useState<string | null>(null);

  // A small, reusable "open Ringo AI with a prefilled message" hook other
  // dashboard features can use without any routing/URL-param plumbing —
  // e.g. the Content Calendar's "Plan My Month" button. Both components
  // are already mounted in the same page (RingoAiLauncher lives in
  // DashboardShell, present on every /dashboard/* page), so a plain
  // window CustomEvent is enough; no navigation needed.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ prompt?: string }>).detail;
      setInitialMessage(detail?.prompt || null);
      setOpen(true);
    };
    window.addEventListener("ringo-ai:open", onOpen);
    return () => window.removeEventListener("ringo-ai:open", onOpen);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.locked === "plan") {
          setLocked(true);
          return;
        }
        if (!data?.available) return;
        setStatus({ canSend: !!data.canSend, limitReason: data.limitReason ?? null, remainingToday: Number(data.remainingToday) || 0 });
      })
      .catch(() => {
        // Ringo AI simply stays hidden if its status can't be loaded.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status && !locked) return null;

  if (locked) {
    return (
      <>
        {open && (
          <>
            <div onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px]" aria-hidden="true" />
            <AiLockedPanel onClose={() => setOpen(false)} />
          </>
        )}
        {!open && (
          <button
            ref={launcherRef}
            onClick={() => setOpen(true)}
            aria-label={`${t.ringoAi.open}. ${t.ringoAi.locked.badge}`}
            className="ringo-tactile fixed z-30 bottom-[13.5rem] right-4 lg:bottom-[6.25rem] lg:right-6 w-16 h-14 rounded-2xl border border-ringo-indigo/60 bg-ringo-surface text-ringo-indigo flex flex-col items-center justify-center gap-0.5 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50 focus-visible:ring-offset-2"
          >
            <span className="relative">
              <Sparkles size={19} aria-hidden="true" />
              <Lock size={9} className="absolute -right-1.5 -top-1 rounded-full bg-ringo-surface" aria-hidden="true" />
            </span>
            <span className="text-[9px] font-semibold leading-none">{t.ringoAi.launcherLabel}</span>
          </button>
        )}
      </>
    );
  }
  if (!status) return null;

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="ringo-ai-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px]"
              aria-hidden="true"
            />
            <RingoAiPanel
              key="ringo-ai-panel"
              status={status}
              onStatusChange={setStatus}
              onClose={() => setOpen(false)}
              initialMessage={initialMessage}
              onInitialMessageSent={() => setInitialMessage(null)}
            />
          </>
        )}
      </AnimatePresence>

      {!open && (
        <button
          ref={launcherRef}
          onClick={() => setOpen(true)}
          aria-label={t.ringoAi.open}
          className="ringo-tactile ringo-cta fixed z-30 bottom-[13.5rem] right-4 lg:bottom-[6.25rem] lg:right-6 w-16 h-14 rounded-2xl flex flex-col items-center justify-center gap-0.5"
        >
          <Sparkles size={19} />
          <span className="text-[9px] font-semibold leading-none">{t.ringoAi.launcherLabel}</span>
        </button>
      )}
    </>
  );
}
