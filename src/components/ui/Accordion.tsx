"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, type LucideIcon } from "lucide-react";

// A generic, reusable single-open-at-a-time dropdown/accordion — click a
// row, it opens; finish, it closes; open the next one. This file only
// knows about open/closed state and an optional per-item "guard" a caller
// can register to intercept a close (e.g. an unsaved-changes prompt) — it
// has no opinion about what's inside an item (see EditorSection.tsx for
// the Editor-specific save/dirty-tracking layer built on top of this).
//
// Only one row open at a time: opening a new one asks the currently-open
// row's own guard (if any) whether it's OK to close first, exactly like
// clicking that row's own header would.

type AccordionContextValue = {
  openId: string | null;
  requestOpen: (id: string) => void;
  requestClose: (id: string) => void;
  registerGuard: (id: string, guard: (() => boolean | Promise<boolean>) | null) => void;
};

const AccordionContext = createContext<AccordionContextValue | null>(null);

// Exported so a more opinionated wrapper (see EditorSection.tsx) can
// close its own item after an action completes — e.g. auto-collapsing a
// row once its "Save Changes" finishes — without reimplementing
// accordion state itself.
export function useAccordion() {
  const ctx = useContext(AccordionContext);
  if (!ctx) throw new Error("Accordion.Item/Link must be rendered inside <Accordion>");
  return ctx;
}

export function Accordion({
  children,
  defaultOpenId = null,
  className = "",
}: {
  children: React.ReactNode;
  defaultOpenId?: string | null;
  className?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenId);
  const guards = useRef(new Map<string, () => boolean | Promise<boolean>>());

  const registerGuard = useCallback((id: string, guard: (() => boolean | Promise<boolean>) | null) => {
    if (guard) guards.current.set(id, guard);
    else guards.current.delete(id);
  }, []);

  // The one place a row actually changes — always asks whichever row is
  // currently open (if any, and if it registered a guard) before
  // switching away from it.
  const switchTo = useCallback(
    async (nextId: string | null) => {
      const current = openId;
      if (current && current !== nextId) {
        const guard = guards.current.get(current);
        if (guard) {
          const ok = await guard();
          if (!ok) return;
        }
      }
      setOpenId(nextId);
    },
    [openId]
  );

  const requestOpen = useCallback((id: string) => {
    switchTo(id);
  }, [switchTo]);

  const requestClose = useCallback((id: string) => {
    // Used by an already-confirmed close (e.g. a successful Save) —
    // deliberately does not re-run the guard, the caller already knows
    // it's safe.
    setOpenId((prev) => (prev === id ? null : prev));
  }, []);

  return (
    <AccordionContext.Provider value={{ openId, requestOpen, requestClose, registerGuard }}>
      <div className={className}>{children}</div>
    </AccordionContext.Provider>
  );
}

// One collapsible row. `guard` (optional) is asked before this row closes
// for ANY reason — its own header re-clicked, or a different row opening
// — and can veto the close by resolving false (see EditorSection.tsx's
// unsaved-changes prompt).
export function AccordionItem({
  id,
  icon: Icon,
  title,
  subtitle,
  badge,
  guard,
  children,
}: {
  id: string;
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  guard?: () => boolean | Promise<boolean>;
  children: React.ReactNode;
}) {
  const { openId, requestOpen, requestClose, registerGuard } = useAccordion();
  const isOpen = openId === id;
  const panelId = useId();

  // Registered once via a stable wrapper that always reads the latest
  // `guard` through this ref — so a guard closing over fresh "dirty"
  // state is never stale, without needing to re-register (and risk a
  // mid-render side effect) on every render.
  const guardRef = useRef(guard);
  guardRef.current = guard;
  useEffect(() => {
    registerGuard(id, () => guardRef.current?.() ?? true);
    return () => registerGuard(id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const toggle = async () => {
    if (isOpen) {
      if (guard) {
        const ok = await guard();
        if (!ok) return;
      }
      requestClose(id);
    } else {
      requestOpen(id);
    }
  };

  return (
    <div className="border-b border-ringo-border/60 last:border-0 first:rounded-t-[19px] last:rounded-b-[19px] overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className={`w-full flex items-center justify-between gap-3 px-1 py-4 text-left transition-colors duration-200 active:scale-[0.995] ${
          isOpen ? "bg-ringo-indigo/[0.04]" : "hover:bg-ringo-muted/[0.04]"
        }`}
      >
        <span className="flex items-center gap-3 min-w-0">
          {Icon && (
            <span
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-200 ${
                isOpen ? "bg-ringo-indigo" : "bg-ringo-indigo/10"
              }`}
            >
              <Icon size={15} className={`transition-colors duration-200 ${isOpen ? "text-white" : "text-ringo-indigo"}`} strokeWidth={2.25} />
            </span>
          )}
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold text-ringo-text tracking-[-0.01em] truncate">{title}</span>
            {subtitle && <span className="block text-xs text-ringo-muted truncate mt-0.5">{subtitle}</span>}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {badge}
          <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ type: "spring", stiffness: 380, damping: 28 }}>
            <ChevronDown size={17} className={isOpen ? "text-ringo-indigo" : "text-ringo-muted"} />
          </motion.span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <motion.div
              initial={{ y: -6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.2, delay: 0.05 }}
              className="px-1 pb-5 pt-1"
            >
              {children}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// A row that looks identical to AccordionItem but navigates instead of
// expanding — for something like Tickets that already has its own full
// dedicated page rather than fields to fill in here.
export function AccordionLinkItem({
  icon: Icon,
  title,
  subtitle,
  href,
  external,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  href: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="group w-full flex items-center justify-between gap-3 px-1 py-4 text-left border-b border-ringo-border/60 last:border-0 first:rounded-t-[19px] last:rounded-b-[19px] transition-colors duration-200 hover:bg-ringo-muted/[0.04] active:scale-[0.995]"
    >
      <span className="flex items-center gap-3 min-w-0">
        {Icon && (
          <span className="w-8 h-8 rounded-xl bg-ringo-indigo/10 flex items-center justify-center shrink-0">
            <Icon size={15} className="text-ringo-indigo" strokeWidth={2.25} />
          </span>
        )}
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold text-ringo-text tracking-[-0.01em] truncate">{title}</span>
          {subtitle && <span className="block text-xs text-ringo-muted truncate mt-0.5">{subtitle}</span>}
        </span>
      </span>
      <ChevronDown
        size={17}
        className="text-ringo-muted shrink-0 -rotate-90 transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </a>
  );
}
