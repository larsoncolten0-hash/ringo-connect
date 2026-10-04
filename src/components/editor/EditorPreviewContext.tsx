"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { restoreKeys } from "./draftSync";

// A live, unsaved mirror of the profile being edited. Every editor card
// pushes its current value in here the moment it changes (on keystroke
// for text fields, immediately for swatches/toggles, on every list
// mutation for links/products/socials) — completely independent of when
// that same card actually persists to Supabase (on blur, debounced, on a
// Save button, whichever). This context only ever holds "what should be
// on screen right now," so LivePreviewPanel can render the exact same
// ProfileView the public page uses and have it update instantly as the
// creator types, before anything is even saved.
//
// The draft is seeded ONCE from the server snapshot (useState below) and never re-seeded from later
// props, so a router.refresh() can never overwrite unsaved work. Two additions (Phase 2):
//   - DraftScopeContext: an EditorSection provides one so it can learn which draft keys its own cards
//     changed (a section's cards all go through useEditorPreview().updateDraft).
//   - restoreFromServer(keys): on Discard, those keys are put back to the server's values the next time
//     fresh server props arrive (after the router.refresh() the section triggers). Only those keys.
type DraftProfile = Record<string, any>;

type EditorPreviewContextValue = {
  draft: DraftProfile;
  updateDraft: (patch: Partial<DraftProfile>) => void;
  /** Queue `keys` to be restored from the server snapshot when the next refresh lands. */
  restoreFromServer: (keys: string[]) => void;
  /** The owner's plan row (read-only), so previews and hints can apply the same entitlements as the public page. */
  plan: any;
};

const EditorPreviewContext = createContext<EditorPreviewContextValue | null>(null);

/** Records which draft keys the cards inside one section changed. */
export type DraftScope = { record: (keys: string[]) => void };
export const DraftScopeContext = createContext<DraftScope | null>(null);

export function EditorPreviewProvider({
  initialProfile,
  plan = null,
  children,
}: {
  initialProfile: DraftProfile;
  plan?: any;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<DraftProfile>(initialProfile);
  const serverRef = useRef(initialProfile);
  serverRef.current = initialProfile;
  const pendingRestore = useRef(new Set<string>());

  const restoreFromServer = useCallback((keys: string[]) => {
    for (const key of keys) pendingRestore.current.add(key);
  }, []);

  // Fresh server props arrived (a refresh finished). If a Discard queued keys, put exactly those back.
  useEffect(() => {
    if (pendingRestore.current.size === 0) return;
    const keys = [...pendingRestore.current];
    pendingRestore.current.clear();
    setDraft((prev) => restoreKeys(prev, serverRef.current, keys));
  }, [initialProfile]);

  const value = useMemo<EditorPreviewContextValue>(
    () => ({
      draft,
      updateDraft: (patch) => setDraft((prev) => ({ ...prev, ...patch })),
      restoreFromServer,
      plan,
    }),
    [draft, restoreFromServer, plan]
  );

  return <EditorPreviewContext.Provider value={value}>{children}</EditorPreviewContext.Provider>;
}

const NO_PREVIEW: EditorPreviewContextValue = { draft: {}, updateDraft: () => {}, restoreFromServer: () => {}, plan: null };

/** Safe to call even outside the provider — falls back to a no-op updater
 *  rather than throwing, so a card never breaks if it's ever rendered
 *  somewhere the preview doesn't apply. Inside an EditorSection, updateDraft also records
 *  which keys the section changed (see DraftScopeContext). */
export function useEditorPreview(): EditorPreviewContextValue {
  const ctx = useContext(EditorPreviewContext);
  const scope = useContext(DraftScopeContext);
  return useMemo(() => {
    const base = ctx ?? NO_PREVIEW;
    if (!scope) return base;
    return {
      ...base,
      updateDraft: (patch: Partial<DraftProfile>) => {
        scope.record(Object.keys(patch));
        base.updateDraft(patch);
      },
    };
  }, [ctx, scope]);
}
