"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import RingoAiPanel, { type AiStatus } from "./RingoAiPanel";

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
        if (cancelled || !data?.available) return;
        setStatus({ canSend: !!data.canSend, limitReason: data.limitReason ?? null, remainingToday: Number(data.remainingToday) || 0 });
      })
      .catch(() => {
        // Ringo AI simply stays hidden if its status can't be loaded.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
