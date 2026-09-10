"use client";

import { createContext, useContext, useMemo, useState } from "react";

// A live, unsaved mirror of the profile being edited. Every editor card
// pushes its current value in here the moment it changes (on keystroke
// for text fields, immediately for swatches/toggles, on every list
// mutation for links/products/socials) — completely independent of when
// that same card actually persists to Supabase (on blur, debounced, on a
// Save button, whichever). This context only ever holds "what should be
// on screen right now," so LivePreviewPanel can render the exact same
// ProfileView the public page uses and have it update instantly as the
// creator types, before anything is even saved.
type DraftProfile = Record<string, any>;

type EditorPreviewContextValue = {
  draft: DraftProfile;
  updateDraft: (patch: Partial<DraftProfile>) => void;
  // "Is there a change on screen that a card's own save (on blur, on
  // click, debounced — whichever that card uses) hasn't confirmed yet?"
  // Every card already calls updateDraft the instant a field changes, so
  // piggybacking dirty-tracking on that one call gives the whole editor a
  // single "unsaved changes" signal for free, with no per-card wiring.
  // See SaveChangesBar.tsx, the only thing that reads this.
  dirty: boolean;
  markSaved: () => void;
};

const EditorPreviewContext = createContext<EditorPreviewContextValue | null>(null);

export function EditorPreviewProvider({
  initialProfile,
  children,
}: {
  initialProfile: DraftProfile;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<DraftProfile>(initialProfile);
  const [dirty, setDirty] = useState(false);

  const value = useMemo<EditorPreviewContextValue>(
    () => ({
      draft,
      updateDraft: (patch) => {
        setDraft((prev) => ({ ...prev, ...patch }));
        setDirty(true);
      },
      dirty,
      markSaved: () => setDirty(false),
    }),
    [draft, dirty]
  );

  return <EditorPreviewContext.Provider value={value}>{children}</EditorPreviewContext.Provider>;
}

/** Safe to call even outside the provider — falls back to a no-op updater
 *  rather than throwing, so a card never breaks if it's ever rendered
 *  somewhere the preview doesn't apply. */
export function useEditorPreview(): EditorPreviewContextValue {
  const ctx = useContext(EditorPreviewContext);
  return ctx ?? { draft: {}, updateDraft: () => {}, dirty: false, markSaved: () => {} };
}
