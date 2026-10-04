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

// ---------------------------------------------------------------------------------------------------
// Phase 2B: one vocabulary for "what state is this section in?" and "does leaving lose something?".

export type SectionStatus =
  | "none" // no Save handler and nothing auto-saving: nothing to show
  | "idle" // has a Save handler, nothing edited
  | "dirty" // buffered edits waiting for Save
  | "saving" // the section Save is running
  | "saved" // the section Save just succeeded
  | "failed" // the section Save failed (edits are still in place)
  | "autosaving" // an auto-saving write is in flight / debouncing
  | "autosave_failed" // an auto-save failed and can be retried
  | "autosave_undone"; // an auto-save failed and was rolled back

export function sectionStatus(o: {
  saverCount: number;
  dirty: boolean;
  saveState: SectionSaveState;
  autoPending: number;
  autoRetryable: number;
  autoUndone: boolean;
}): SectionStatus {
  if (o.saveState === "saving") return "saving";
  if (o.saveState === "success") return "saved";
  if (o.saveState === "error") return "failed";
  if (o.autoRetryable > 0) return "autosave_failed";
  if (o.autoPending > 0) return "autosaving";
  if (o.autoUndone) return "autosave_undone";
  if (o.saverCount > 0 && o.dirty) return "dirty";
  if (o.saverCount > 0) return "idle";
  return "none";
}

/**
 * Whether leaving this section (or the page) would lose something:
 *  - buffered edits that were never saved (only sections with a Save handler can have these),
 *  - an auto-save that failed and still shows a value the database does not have,
 *  - typed input that was never submitted.
 * Edits in a section that saves on its own are NOT unsaved, so they never warn on their own.
 */
export function sectionWarnsOnLeave(o: { saverCount: number; dirty: boolean; autoRetryable: number; uncommitted: number }): boolean {
  return (o.saverCount > 0 && o.dirty) || o.autoRetryable > 0 || o.uncommitted > 0;
}
