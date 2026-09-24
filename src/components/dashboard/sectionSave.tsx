"use client";

import { createContext, useContext, useEffect, useRef } from "react";

// Lets a card that buffers its edits (nothing reaches Supabase until "save")
// hand its save function to the EditorSection dropdown that wraps it, so the
// dropdown's single "Save Changes" button is the one real save — the card
// hides its own. A save returns false (or throws) when it failed.
export type SectionSaveFn = () => Promise<boolean | void> | boolean | void;

type SectionSaveContextValue = { register: (fn: SectionSaveFn) => () => void };

export const SectionSaveContext = createContext<SectionSaveContextValue | null>(null);

/** Registers `save` with the enclosing EditorSection. Returns true when there
 *  is one (the card should then NOT render its own Save button); false when the
 *  card is rendered on its own, where it keeps its button. */
export function useSectionSave(save: SectionSaveFn): boolean {
  const ctx = useContext(SectionSaveContext);
  const latest = useRef(save);
  latest.current = save;
  const register = ctx?.register;

  useEffect(() => {
    if (!register) return;
    return register(() => latest.current());
  }, [register]);

  return !!ctx;
}
