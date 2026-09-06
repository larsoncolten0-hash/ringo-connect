"use client";

import { useState } from "react";
import { Eye, X, Smartphone } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import ProfileView from "@/components/ProfileView";
import { useEditorPreview } from "./EditorPreviewContext";

// The actual phone-shaped screen — a fixed, real phone width (not scaled)
// so ProfileView's own "sm:" breakpoints never kick in here: what's shown
// is exactly the mobile layout the overwhelming majority of visitors will
// actually see, not a shrunken desktop one.
function PhoneFrame() {
  const { draft } = useEditorPreview();

  // Bezel is a fixed near-black regardless of light/dark mode — a real
  // phone frame doesn't flip color with the dashboard's theme.
  return (
    <div className="w-[340px] shrink-0 rounded-[2.3rem] border-[10px] border-[#161616] bg-[#161616] shadow-[0_24px_60px_-20px_rgba(15,23,42,0.4)]">
      <div className="relative rounded-[1.6rem] overflow-hidden bg-black" style={{ height: 640 }}>
        <div className="absolute top-0 inset-x-0 h-6 flex items-center justify-center z-30 pointer-events-none">
          <div className="w-24 h-5 bg-black rounded-b-xl" />
        </div>
        <div className="no-scrollbar w-full h-full overflow-y-auto">
          <ProfileView profile={draft} preview />
        </div>
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
          <Eye size={12} />
          {t.editor.livePreview}
        </p>
      </div>

      {/* Small screens — no room for a permanent side panel, so a
          floating button opens the same live preview as a full-screen
          sheet instead. */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed bottom-20 right-4 z-40 flex items-center gap-2 pl-4 pr-5 py-3 rounded-full bg-ringo-indigo text-white text-sm font-medium shadow-[0_8px_24px_-6px_rgba(79,70,229,0.5)]"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <Smartphone size={16} />
        {t.editor.previewButton}
      </button>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-ringo-bg flex flex-col animate-dropdown-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-ringo-border shrink-0">
            <p className="text-sm font-medium text-ringo-text flex items-center gap-1.5">
              <Eye size={14} />
              {t.editor.livePreview}
            </p>
            <button
              onClick={() => setMobileOpen(false)}
              aria-label={t.editor.closePreview}
              className="w-8 h-8 flex items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-muted/10"
            >
              <X size={16} />
            </button>
          </div>
          <div className="no-scrollbar flex-1 overflow-y-auto flex justify-center items-start p-4">
            <PreviewFullBleed />
          </div>
        </div>
      )}
    </>
  );
}

// Full-width (not phone-framed) version for the mobile sheet — the sheet
// IS the phone here, so a decorative frame inside it would just waste
// space that matters a lot more on a small screen.
function PreviewFullBleed() {
  const { draft } = useEditorPreview();
  return (
    <div className="w-full max-w-sm rounded-2xl overflow-hidden border border-ringo-border">
      <ProfileView profile={draft} preview />
    </div>
  );
}
