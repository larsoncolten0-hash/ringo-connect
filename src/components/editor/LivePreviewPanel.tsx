"use client";

import { useMemo, useState } from "react";
import { Eye, X, Smartphone } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import ProfileView from "@/components/ProfileView";
import { useModalA11y } from "@/components/ui/useModalA11y";
import { applyPlanToPreview } from "@/lib/previewPlan";
import { useEditorPreview } from "./EditorPreviewContext";

// What the preview shows is what the PUBLIC page will show for this plan: the same link / product limits and
// the same fixed theme when custom themes are not allowed (see src/lib/previewPlan.ts). It also shows edits
// that are not saved yet, and says so.
function usePlanPreview() {
  const { draft, plan } = useEditorPreview();
  return useMemo(() => applyPlanToPreview(draft, plan), [draft, plan]);
}

// Small notes under the preview explaining anything the public page will NOT show, in the same words the
// editor already uses for plan limits.
function PreviewNotes() {
  const { t } = useLanguage();
  const preview = usePlanPreview();
  const notes: string[] = [];
  if (preview.hiddenLinks > 0 && preview.maxLinks != null) notes.push(t.editor.linksHiddenByPlan(preview.hiddenLinks, preview.maxLinks));
  if (preview.hiddenProducts > 0 && preview.maxProducts != null) notes.push(t.editor.productsHiddenByPlan(preview.hiddenProducts, preview.maxProducts));
  if (preview.themeLocked) notes.push(t.editor.previewThemeNote);
  return (
    <div className="flex flex-col gap-1.5 w-full max-w-sm shrink-0">
      <p className="text-xs text-ringo-muted">{t.editor.previewUnsavedNote}</p>
      {notes.map((n) => (
        <p key={n} className="text-xs text-ringo-coral">
          {n}
        </p>
      ))}
    </div>
  );
}

// The actual phone-shaped screen — a fixed, real phone width (not scaled)
// so ProfileView's own "sm:" breakpoints never kick in here: what's shown
// is exactly the mobile layout the overwhelming majority of visitors will
// actually see, not a shrunken desktop one.
function PhoneFrame() {
  const preview = usePlanPreview();

  // Bezel is a fixed near-black regardless of light/dark mode — a real
  // phone frame doesn't flip color with the dashboard's theme.
  return (
    <div className="w-[340px] shrink-0 rounded-[2.3rem] border-[10px] border-[#161616] bg-[#161616] shadow-[0_24px_60px_-20px_rgba(15,23,42,0.4)]">
      <div className="relative rounded-[1.6rem] overflow-hidden bg-black" style={{ height: 640 }}>
        <div className="absolute top-0 inset-x-0 h-6 flex items-center justify-center z-30 pointer-events-none">
          <div className="w-24 h-5 bg-black rounded-b-xl" />
        </div>
        <div className="no-scrollbar w-full h-full overflow-y-auto">
          <ProfileView profile={preview.profile} preview />
        </div>
      </div>
    </div>
  );
}

// The mobile preview sheet: a real modal dialog. Focus moves into it, Tab stays inside, Escape closes it,
// and focus goes back to the Preview button.
function PreviewSheet({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const ref = useModalA11y<HTMLDivElement>(onClose);
  const preview = usePlanPreview();

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={t.editor.livePreview}
      tabIndex={-1}
      className="lg:hidden fixed inset-0 z-50 bg-ringo-bg flex flex-col animate-dropdown-in motion-reduce:animate-none focus:outline-none"
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-ringo-border shrink-0">
        <p className="text-sm font-medium text-ringo-text flex items-center gap-1.5">
          <Eye size={14} aria-hidden="true" />
          {t.editor.livePreview}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.editor.closePreview}
          className="w-11 h-11 -mr-2 flex items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="no-scrollbar flex-1 overflow-y-auto flex flex-col items-center gap-3 p-4">
        {/* shrink-0: this wrapper clips its corners (overflow-hidden), and a flex item that clips is allowed to shrink below its content. Without
            shrink-0 the profile was squeezed to the sheet's height and the sheet had nothing to scroll. */}
        <div className="w-full max-w-sm shrink-0 rounded-2xl overflow-hidden border border-ringo-border">
          <ProfileView profile={preview.profile} preview />
        </div>
        <PreviewNotes />
      </div>
    </div>
  );
}

export default function LivePreviewPanel() {
  const { t } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop / large screens — a persistent, sticky side-by-side
          preview. Sticky rather than fixed so it scrolls away naturally
          with the page on very short viewports instead of ever
          overlapping content. */}
      <div className="hidden lg:flex flex-col items-center gap-3 sticky top-6 self-start">
        <PhoneFrame />
        <p className="text-xs text-ringo-muted flex items-center gap-1.5">
          <Eye size={12} aria-hidden="true" />
          {t.editor.livePreview}
        </p>
        <div className="w-[340px]">
          <PreviewNotes />
        </div>
      </div>

      {/* Small screens — no room for a permanent side panel, so a
          floating button opens the same live preview as a full-screen
          sheet instead. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-haspopup="dialog"
        className="lg:hidden fixed bottom-20 right-4 z-40 flex items-center gap-2 pl-4 pr-5 min-h-[44px] py-3 rounded-full bg-ringo-indigo text-white text-sm font-medium shadow-[0_8px_24px_-6px_rgba(79,70,229,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50 focus-visible:ring-offset-2"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <Smartphone size={16} aria-hidden="true" />
        {t.editor.previewButton}
      </button>

      {mobileOpen && <PreviewSheet onClose={() => setMobileOpen(false)} />}
    </>
  );
}
