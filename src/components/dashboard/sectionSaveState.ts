// The small, pure decisions behind EditorSection's Save flow, kept separate so they can be tested
// without rendering React.

export type SectionSaveState = "idle" | "saving" | "success" | "error";
export type SaveOutcome = "none" | "success" | "error";

/** What a Save run amounted to. No registered handlers means NOTHING was persisted, which is never "success". */
export function saveOutcome(results: boolean[]): SaveOutcome {
  if (results.length === 0) return "none";
  return results.every(Boolean) ? "success" : "error";
}

/**
 * Whether the section shows its Save action. Only when a card inside registered a save handler
 * (useSectionSave) or a save is in flight/just finished. Edits to a card that persists on its own
 * (immediate or on blur) must not offer a Save that would save nothing.
 */
export function showSaveAction(o: { saverCount: number; saveState: SectionSaveState }): boolean {
  return o.saverCount > 0 || o.saveState !== "idle";
}

/**
 * Decides when a section must re-fetch the server snapshot (router.refresh()).
 *
 * Cards read their initial values from the server snapshot every time they MOUNT, and a closed section
 * unmounts, so any change made while a section was open must be followed by a refresh before it is
 * reopened, otherwise it shows the old values (or a deleted row comes back). Three things count as a change:
 *  - a successful Save / Discard already refreshed ("synced"), which resets the baseline;
 *  - the preview draft was replaced while the section was open (cards that call updateDraft);
 *  - the user interacted inside the section (change / input / click). This is the only signal for cards
 *    that persist on their own without touching the draft (Pixels, Tables).
 */
export function createSyncTracker() {
  let openedWith: unknown = null;
  let touched = false;
  return {
    /** The section just opened with this draft as its baseline. */
    opened(draft: unknown) {
      openedWith = draft;
      touched = false;
    },
    /** The user interacted inside the open section. */
    touch() {
      touched = true;
    },
    /** A refresh was just requested (Save succeeded / Discard): everything so far is already synced. */
    synced(draft: unknown) {
      if (openedWith != null) openedWith = draft;
      touched = false;
    },
    /** The section closed. Returns true when a refresh is needed. */
    closed(draft: unknown): boolean {
      const need = openedWith != null && (touched || openedWith !== draft);
      openedWith = null;
      touched = false;
      return need;
    },
  };
}
