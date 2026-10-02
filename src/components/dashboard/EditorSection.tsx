"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { AccordionItem, useAccordion } from "@/components/ui/Accordion";
import SaveButton, { type SaveState } from "@/components/dashboard/SaveButton";
import UnsavedChangesDialog from "@/components/dashboard/UnsavedChangesDialog";
import { SectionSaveContext, type SectionSaveFn } from "@/components/dashboard/sectionSave";
import { useSound } from "@/components/SoundProvider";
import { useEditorPreview } from "@/components/editor/EditorPreviewContext";
import { createSyncTracker, saveOutcome, showSaveAction } from "@/components/dashboard/sectionSaveState";

// The Editor-specific dropdown row — each existing editor card (Profile,
// Category, Music & Entertainment, Brand color, WhatsApp, Social Links,
// Links, EPs & Albums, Latest Beats/Music, …) gets exactly one of these,
// one card per dropdown, not regrouped — so only the one someone is
// actively editing is ever expanded.
//
// Every field inside a card already persists itself the moment it loses
// focus (see e.g. ProfileHeaderCard/WhatsAppCard's own onBlur handlers) —
// there was never a buffered "apply on save" step to begin with, and
// LivePreviewPanel depends on that (it shows the live draft "saved or
// not", per Editor.tsx's own comment). This wraps that existing behavior
// with a dropdown + explicit Save button on top of it, without changing
// how the card persists its own fields:
//
// - "dirty" is detected generically, by listening for any change/input
//   bubbling up from inside this row (capture phase, so it can't be
//   blocked by a descendant calling stopPropagation) — no changes needed
//   to the card itself.
// - "Save Changes" is the ONE save for the dropdown: it blurs whatever's
//   focused, then runs the save of every card inside that buffers its edits
//   (they register through useSectionSave — see sectionSave.tsx — and hide
//   their own Save button). Only when all of them succeed does it show
//   success and close the row; if any fails it shows "Save failed" and stays
//   open so nothing is silently lost. Cards that persist per-field on blur
//   register nothing, so for them it behaves as before.
// - "Discard Changes" can't un-persist a field that already auto-saved on
//   blur — but it can (and does) throw away anything typed but never
//   blurred, by asking Next.js to re-fetch this route's server data
//   (router.refresh(), not a full page reload) and re-render the card
//   from the database's actual current state.
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
  const { requestClose, openId } = useAccordion();
  const { draft } = useEditorPreview();
  const { play } = useSound();
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
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

  // Keeps cards' initial values current. Cards initialise from the server snapshot (the `profile`
  // props) every time they mount, and a closed section unmounts, so after an edit the snapshot must be
  // re-fetched or a reopened section shows the old values. router.refresh() only swaps those server
  // props: EditorPreviewProvider keeps its draft in useState(initialProfile) (it ignores later prop
  // changes) and the accordion keeps its own open state, so neither is reset by it.
  //   - after a successful Save, refresh right away (the 900 ms close delay hides the latency);
  //   - when the section closes after anything changed while it was open (draft replaced, or any
  //     interaction inside it) refresh once. This covers cards that persist on their own, which never
  //     reach the Save path, and the immediate add/delete actions inside buffered cards.
  // The bookkeeping lives in createSyncTracker (sectionSaveState.ts) so it can be tested without React.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const syncRef = useRef<ReturnType<typeof createSyncTracker> | null>(null);
  if (!syncRef.current) syncRef.current = createSyncTracker();
  const sync = syncRef.current;
  const openHere = openId === id;
  useEffect(() => {
    if (openHere) {
      sync.opened(draftRef.current);
      return;
    }
    if (sync.closed(draftRef.current)) router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openHere]);

  const guard = () => {
    if (!dirty) return true;
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
      play("success");
      // Pull the just-saved values into the server snapshot so reopening shows them, not the old ones.
      sync.synced(draftRef.current);
      router.refresh();
      window.setTimeout(() => {
        setSaveState("idle");
        requestClose(id);
      }, 900);
    } else if (outcome === "error") {
      // Stay open with the edits still in place so the user can retry.
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
    sync.synced(draftRef.current); // the refresh below already re-syncs
    resolveGuardRef.current?.(true);
    resolveGuardRef.current = null;
    // Re-fetches this route's server data and re-renders every card from
    // the database's actual current state — the correct "discard" for an
    // architecture where the real persistence boundary is each field's
    // own onBlur, not a single buffered commit (see the comment above).
    router.refresh();
  };

  return (
    <>
      <AccordionItem id={id} icon={icon} title={title} subtitle={subtitle} badge={badge} guard={guard}>
        <SectionSaveContext.Provider value={sectionSave}>
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
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="flex items-center gap-3 overflow-hidden"
              >
                <div className="pt-1">
                  <SaveButton state={saveState} onClick={handleSave} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        </SectionSaveContext.Provider>
      </AccordionItem>

      {showUnsavedDialog && <UnsavedChangesDialog onKeepEditing={handleKeepEditing} onDiscard={handleDiscard} />}
    </>
  );
}
