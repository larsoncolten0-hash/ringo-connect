"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import UnsavedChangesDialog from "./UnsavedChangesDialog";
import { useAnyUnsaved } from "./unsavedRegistry";
import { guardedNavigationTarget, isSamePath } from "./navigationGuard";

// Protects genuinely unsaved work (buffered edits never saved, a failed auto-save, typed input never
// submitted) from being lost by LEAVING the editor:
//   - closing the tab / refreshing / typing another address: the browser's own confirmation
//     (`beforeunload`; its wording is the browser's, not ours),
//   - clicking any in-app link (sidebar, mobile dock, More menu, Home, …): our dialog first.
// While nothing is unsaved it does nothing at all, and it never intercepts new-tab or modified
// clicks, downloads, mailto:/tel:/external links, in-page anchors or links to the current page.
// It cannot intercept the browser's Back button (browsers do not allow it for in-app routing).
export default function UnsavedNavigationGuard() {
  const any = useAnyUnsaved();
  const router = useRouter();
  const { t } = useLanguage();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!any) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [any]);

  useEffect(() => {
    if (!any) return;
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const dest = guardedNavigationTarget({
        href: anchor.getAttribute("href"),
        target: anchor.getAttribute("target"),
        download: anchor.hasAttribute("download"),
        button: e.button,
        modified: e.ctrlKey || e.metaKey || e.shiftKey || e.altKey,
        currentUrl: window.location.href,
      });
      if (!dest) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(dest);
    };
    // capture phase: runs before Next's <Link> handler
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [any]);

  if (!target) return null;
  return (
    <UnsavedChangesDialog
      body={t.editor.autosave.leaveBodyNavigate}
      discardLabel={t.editor.autosave.leaveAnyway}
      onKeepEditing={() => setTarget(null)}
      onDiscard={() => {
        const dest = target;
        setTarget(null);
        // ?section= links rely on a full load (Accordion reads its default only on mount)
        if (isSamePath(dest, window.location.href)) window.location.assign(dest);
        else router.push(dest);
      }}
    />
  );
}
