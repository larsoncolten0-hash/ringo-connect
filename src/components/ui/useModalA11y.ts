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
 *
 * "What had it before" (the opener) is read DURING THE FIRST RENDER, i.e. before React commits the dialog.
 * Reading it in the effect below would be too late: a dialog with an `autoFocus` field has already moved
 * focus into itself by then, so the field - which is removed with the dialog - would be remembered and focus
 * would be lost to <body> on close. The opener is only restored if it is still on the page.
 */
export function useModalA11y<T extends HTMLElement = HTMLDivElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const openerRef = useRef<HTMLElement | null>(null);
  if (openerRef.current === null && typeof document !== "undefined") openerRef.current = document.activeElement as HTMLElement | null;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
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
      const opener = openerRef.current;
      if (opener && opener !== document.body && opener.isConnected) opener.focus?.();
    };
  }, []);

  return ref;
}
