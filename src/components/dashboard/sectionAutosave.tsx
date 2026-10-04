"use client";

import { createContext, useContext, useRef, useState } from "react";
import { createAutosaveEngine, type AutosaveEngine, type AutosaveSnapshot } from "./autosaveEngine";

// React wiring for autosaveEngine.ts. An EditorSection owns one engine and provides it to the cards
// inside it; a card calls useAutosave() to send a write through it:
//
//   const autosave = useAutosave();
//   await autosave.run(() => supabase.from("links").delete().eq("id", id), { rollback: () => restore() });
//
// Used outside a section (a card rendered on its own) it falls back to a private engine: writes still
// run and still report success/failure to the caller, there is just no section to show a status in.

const AutosaveContext = createContext<AutosaveEngine | null>(null);
export const AutosaveProvider = AutosaveContext.Provider;

const EMPTY: AutosaveSnapshot = { pending: 0, retryable: 0, undone: false, uncommitted: 0 };

/** Creates the section's engine once and re-renders the section when its status changes. */
export function useAutosaveEngine(): { engine: AutosaveEngine; snapshot: AutosaveSnapshot } {
  const [snapshot, setSnapshot] = useState<AutosaveSnapshot>(EMPTY);
  const ref = useRef<AutosaveEngine | null>(null);
  if (!ref.current) ref.current = createAutosaveEngine(setSnapshot);
  return { engine: ref.current, snapshot };
}

let fallback: AutosaveEngine | null = null;
export function useAutosave(): AutosaveEngine {
  const ctx = useContext(AutosaveContext);
  if (ctx) return ctx;
  if (!fallback) fallback = createAutosaveEngine();
  return fallback;
}
