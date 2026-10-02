"use client";

import { useEffect, useRef } from "react";

/** Next index of a Tab-key focus trap over `length` focusable items; null = let the browser move focus. */
export function nextTrapIndex(current: number, length: number, shift: boolean): number | null {
  if (length <= 0) return null;
  if (current < 0) return shift ? length - 1 : 0; // focus is outside the dialog: pull it in
  if (shift && current === 0) return length - 1;
  if (!shift && current === length - 1) return 0;
  return null;
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal behaviour the editor's dialogs and sheets were missing: focus moves into the dialog, Tab
 * stays inside it, Escape closes it, and focus returns to what had it before. Attach the returned ref
 * to the dialog element (which should also carry role="dialog" aria-modal and tabIndex={-1}).
 */
export function useModalA11y<T extends HTMLElement = HTMLDivElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previous = document.activeElement as HTMLElement | null;
    const items = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    (items()[0] ?? node).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = items();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const idx = node.contains(document.activeElement) ? list.indexOf(document.activeElement as HTMLElement) : -1;
      const target = nextTrapIndex(idx, list.length, e.shiftKey);
      if (target !== null) {
        e.preventDefault();
        list[target].focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, []);

  return ref;
}
