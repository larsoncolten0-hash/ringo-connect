"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { AccordionItem, useAccordion } from "@/components/ui/Accordion";
import SaveButton, { type SaveState } from "@/components/dashboard/SaveButton";
import UnsavedChangesDialog from "@/components/dashboard/UnsavedChangesDialog";
import SectionFeedback, { type NextHint } from "@/components/dashboard/SectionFeedback";
import { nextStepAfterSave } from "@/components/dashboard/nextStep";
import { SectionSaveContext, type SectionSaveFn } from "@/components/dashboard/sectionSave";
import { AutosaveProvider, useAutosaveEngine } from "@/components/dashboard/sectionAutosave";
import { useUnsavedReport } from "@/components/dashboard/unsavedRegistry";
import { useSound } from "@/components/SoundProvider";
import { useMotionDuration } from "@/components/ui/useMotionDuration";
import { useLanguage } from "@/components/LanguageProvider";
import { DraftScopeContext, useEditorPreview } from "@/components/editor/EditorPreviewContext";
import { createSyncTracker, saveOutcome, sectionStatus, sectionWarnsOnLeave, showSaveAction } from "@/components/dashboard/sectionSaveState";

// The Editor-specific dropdown row — each existing editor card (Profile,
// Category, Music & Entertainment, Brand color, WhatsApp, Social Links,
// Links, EPs & Albums, Latest Beats/Music, …) gets exactly one of these,
// one card per dropdown, not regrouped — so only the one someone is
// actively editing is ever expanded.
//
// Two kinds of card live in a section, and the section treats them differently:
//
// - BUFFERED cards (WhatsApp, About, Category, Links/Catalog/Menu fields, …) keep their edits in local
//   state until "Save Changes". They register a save with useSectionSave (see sectionSave.tsx) and hide
//   their own Save button. "dirty" is detected generically from any change/input inside the row
//   (capture phase). Leaving with unsaved buffered edits asks first (UnsavedChangesDialog).
//   "Save Changes" blurs the focused field, runs every registered save, and only if ALL succeed shows
//   success and closes; otherwise it shows the failure, stays open and keeps the edits.
//
// - AUTO-SAVING cards (Social links, Theme, Pinned, Tracks, Pixels, add/delete/reorder inside any
//   card, …) write on their own. They send each write through the section's autosave engine
//   (sectionAutosave.tsx), which checks for errors, rolls the UI back or keeps the value for a retry,
//   and counts pending writes. Edits there are NOT "unsaved" (the typing is already being saved), so
//   they never trigger the discard dialog by themselves; a FAILED auto-save does, because the screen
//   then shows something the database does not have. A section with no registered save handler has no
//   Save button at all, so "Saved successfully" can never be shown for nothing.
//
// - Cards read their starting values from the server snapshot when they mount, and a closed section
//   unmounts, so the snapshot is re-fetched after a successful Save and when a section closes after
//   anything changed (router.refresh() only swaps those props; it cannot touch the preview draft or the
//   open accordion). "Discard" additionally restores, from the refreshed snapshot, exactly the preview
//   draft keys this section changed, so discarded edits do not linger in the preview.
export default function EditorSection({
  id,
  icon,
  title,
  subtitle,
  badge,
  children,
}: {
  id: string;
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const { requestClose, openId } = useAccordion();
  const preview = useEditorPreview();
  const draft = preview.draft;
  const reportUnsaved = useUnsavedReport();
  const { play } = useSound();
  const dur = useMotionDuration();
  const { engine, snapshot: auto } = useAutosaveEngine();
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveFailedNote, setSaveFailedNote] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [leaveReason, setLeaveReason] = useState<"buffered" | "autosave">("buffered");
  // "Next: …" shown under the section after a successful Save (see nextStepAfterSave)
  const [nextHint, setNextHint] = useState<NextHint | null>(null);
  // Saves registered by the cards inside this section (see sectionSave.tsx).
  const saversRef = useRef(new Set<SectionSaveFn>());
  const [saverCount, setSaverCount] = useState(0);
  const sectionSave = useMemo(
    () => ({
      register: (fn: SectionSaveFn) => {
        saversRef.current.add(fn);
        setSaverCount(saversRef.current.size);
        return () => {
          saversRef.current.delete(fn);
          setSaverCount(saversRef.current.size);
        };
      },
    }),
    []
  );
  // Resolved by whichever button the unsaved-changes dialog's own click
  // handler calls — "Keep Editing" (false, veto the close) or "Discard
  // Changes" (true, proceed).
  const resolveGuardRef = useRef<((keepOpen: boolean) => void) | null>(null);

  // Which preview-draft keys this section's cards changed during this visit (for Discard).
  const touchedKeysRef = useRef(new Set<string>());
  const draftScope = useMemo(() => ({ record: (keys: string[]) => keys.forEach((k) => touchedKeysRef.current.add(k)) }), []);

  // Keeps cards' initial values current (see the header comment). The bookkeeping lives in
  // createSyncTracker (sectionSaveState.ts) so it can be tested without React.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const syncRef = useRef<ReturnType<typeof createSyncTracker> | null>(null);
  if (!syncRef.current) syncRef.current = createSyncTracker();
  const sync = syncRef.current;
  const openHere = openId === id;
  useEffect(() => {
    if (openHere) {
      sync.opened(draftRef.current);
      touchedKeysRef.current.clear();
      setNextHint(null);
      return;
    }
    if (sync.closed(draftRef.current)) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openHere]);

  const status = sectionStatus({
    saverCount,
    dirty,
    saveState,
    autoPending: auto.pending,
    autoRetryable: auto.retryable,
    autoUndone: auto.undone,
  });
  const warn = sectionWarnsOnLeave({ saverCount, dirty, autoRetryable: auto.retryable, uncommitted: auto.uncommitted });
  // Tell the page so refresh / tab close / in-app links can protect real unsaved work (and only that).
  useEffect(() => {
    reportUnsaved(id, warn);
    return () => reportUnsaved(id, false);
  }, [id, warn, reportUnsaved]);

  // Asked before this row closes or another opens. Waits for in-flight / debounced auto-saves first, so
  // leaving never races them, then warns only if something would genuinely be lost.
  const guard = async () => {
    await engine.flush();
    const s = engine.snapshot();
    const mustWarn = sectionWarnsOnLeave({
      saverCount: saversRef.current.size,
      dirty: dirtyRef.current,
      autoRetryable: s.retryable,
      uncommitted: s.uncommitted,
    });
    if (!mustWarn) return true;
    setLeaveReason(s.retryable > 0 || s.uncommitted > 0 ? "autosave" : "buffered");
    return new Promise<boolean>((resolve) => {
      resolveGuardRef.current = (proceed) => resolve(proceed);
      setShowUnsavedDialog(true);
    });
  };

  const handleSave = async () => {
    if (saveState === "saving") return;
    // No card in this section registered a save handler: there is nothing for this button to persist,
    // so never run a "save" (and never report one). The button is hidden in that case anyway.
    if (saversRef.current.size === 0) return;
    setSaveFailedNote(false);
    // Commits whatever the user was mid-typing, then waits a tick so any
    // state update that blur triggers is rendered before the saves read it.
    (document.activeElement as HTMLElement | null)?.blur?.();
    setSaveState("saving");
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    const results = await Promise.all(
      Array.from(saversRef.current).map(async (save) => {
        try {
          return (await save()) !== false;
        } catch {
          return false;
        }
      })
    );

    const outcome = saveOutcome(results);
    if (outcome === "success") {
      setSaveState("success");
      setDirty(false);
      touchedKeysRef.current.clear();
      play("success");
      // Pull the just-saved values into the server snapshot so reopening shows them, not the old ones.
      sync.synced(draftRef.current);
      router.refresh();
      window.setTimeout(() => {
        setSaveState("idle");
        // Worked out from the same Profile Health engine Home uses, on the draft as it is now (after the
        // rows this Save created have been swapped in), so the suggestion matches what Home will show.
        setNextHint(nextStepAfterSave(draftRef.current, preview.plan, t, locale));
        requestClose(id);
      }, 900);
    } else if (outcome === "error") {
      // Stay open with the edits still in place so the user can retry. The button's own "failed" label
      // is brief, so the explanation stays below the section until the next attempt.
      setSaveFailedNote(true);
      setSaveState("error");
      window.setTimeout(() => setSaveState("idle"), 2500);
    }
  };

  const handleKeepEditing = () => {
    setShowUnsavedDialog(false);
    resolveGuardRef.current?.(false);
    resolveGuardRef.current = null;
  };

  const handleDiscard = () => {
    setShowUnsavedDialog(false);
    setDirty(false);
    setSaveFailedNote(false);
    // Anything still failing or typed-but-unsent is being thrown away with the card.
    engine.reset();
    // Put the preview draft back to what is saved for the keys THIS section changed (other sections'
    // unsaved work is untouched). Applied when the refreshed server snapshot below arrives.
    preview.restoreFromServer([...touchedKeysRef.current]);
    touchedKeysRef.current.clear();
    sync.synced(draftRef.current); // the refresh below already re-syncs
    resolveGuardRef.current?.(true);
    resolveGuardRef.current = null;
    // Re-fetches this route's server data so every card re-renders from the database's actual
    // current state (see the header comment).
    router.refresh();
  };

  return (
    <>
      <AccordionItem
        id={id}
        icon={icon}
        title={title}
        subtitle={subtitle}
        badge={badge}
        guard={guard}
        footer={
          <SectionFeedback
            status={status}
            saveFailedNote={saveFailedNote}
            onRetry={() => void engine.retry()}
            onDismissUndone={() => engine.dismiss()}
            nextHint={nextHint}
            onDismissHint={() => setNextHint(null)}
          />
        }
      >
        <SectionSaveContext.Provider value={sectionSave}>
          <AutosaveProvider value={engine}>
            <DraftScopeContext.Provider value={draftScope}>
              <div
                onChangeCapture={() => {
                  setDirty(true);
                  sync.touch();
                }}
                onInputCapture={() => {
                  setDirty(true);
                  sync.touch();
                }}
                onClickCapture={() => sync.touch()}
                className="flex flex-col gap-5"
              >
                {children}
                {/* Only appears when a card in this section registered a save handler (or a save is in
                    flight). Cards that persist on their own never get a Save that would save nothing.
                    Stays mounted through the saving → success sequence so that moment is never cut off
                    mid-animation. */}
                <AnimatePresence>
                  {showSaveAction({ saverCount, saveState }) && (
                    <motion.div
                      initial={{ opacity: 0, y: 6, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      exit={{ opacity: 0, y: 6, height: 0 }}
                      transition={{ duration: dur(0.2), ease: "easeOut" }}
                      className="flex items-center gap-3 overflow-hidden"
                    >
                      <div className="pt-1">
                        <SaveButton state={saveState} onClick={handleSave} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </DraftScopeContext.Provider>
          </AutosaveProvider>
        </SectionSaveContext.Provider>
      </AccordionItem>

      {showUnsavedDialog && (
        <UnsavedChangesDialog
          onKeepEditing={handleKeepEditing}
          onDiscard={handleDiscard}
          body={leaveReason === "autosave" ? t.editor.autosave.leaveBodyAutosave : undefined}
        />
      )}
    </>
  );
}
