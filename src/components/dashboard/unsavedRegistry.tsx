"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

// Lets every EditorSection tell the editor page "I currently hold something that would be lost", so
// one guard (UnsavedNavigationGuard) can protect browser refresh/close and in-app navigation, and only
// when that is actually true. Sections that have nothing unsaved report false and cost nothing.

type Report = (sectionId: string, warn: boolean) => void;

const ReportCtx = createContext<Report | null>(null);
const AnyCtx = createContext(false);

export function UnsavedProvider({ children }: { children: React.ReactNode }) {
  const ids = useRef(new Set<string>());
  const [any, setAny] = useState(false);
  const report = useCallback<Report>((id, warn) => {
    if (warn) ids.current.add(id);
    else ids.current.delete(id);
    setAny(ids.current.size > 0);
  }, []);
  const memo = useMemo(() => report, [report]);
  return (
    <ReportCtx.Provider value={memo}>
      <AnyCtx.Provider value={any}>{children}</AnyCtx.Provider>
    </ReportCtx.Provider>
  );
}

const NOOP: Report = () => {};
/** Report this section's unsaved state. A no-op outside the editor. */
export function useUnsavedReport(): Report {
  return useContext(ReportCtx) ?? NOOP;
}
/** True while any section holds unsaved work. */
export function useAnyUnsaved(): boolean {
  return useContext(AnyCtx);
}
