"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { AccordionItem, useAccordion } from "@/components/ui/Accordion";
import SaveButton, { type SaveState } from "@/components/dashboard/SaveButton";
import UnsavedChangesDialog from "@/components/dashboard/UnsavedChangesDialog";
import { useSound } from "@/components/SoundProvider";

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
// - "Save Changes" blurs whatever's currently focused (committing any
//   in-flight edit that hasn't fired its own onBlur yet), shows a brief
//   saving/success sequence, then closes the row automatically — even
//   though the actual persistence already happened per-field, not in one
//   batch here.
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
  const { requestClose } = useAccordion();
  const { play } = useSound();
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  // Resolved by whichever button the unsaved-changes dialog's own click
  // handler calls — "Keep Editing" (false, veto the close) or "Discard
  // Changes" (true, proceed).
  const resolveGuardRef = useRef<((keepOpen: boolean) => void) | null>(null);

  const guard = () => {
    if (!dirty) return true;
    return new Promise<boolean>((resolve) => {
      resolveGuardRef.current = (proceed) => resolve(proceed);
      setShowUnsavedDialog(true);
    });
  };

  const handleSave = () => {
    // Commits whatever the user was mid-typing — a normal field's own
    // onBlur already fires the moment focus leaves it, this just makes
    // sure that happens before the "saved" message shows.
    (document.activeElement as HTMLElement | null)?.blur?.();
    setSaveState("saving");
    window.setTimeout(() => {
      setSaveState("success");
      setDirty(false);
      play("success");
      window.setTimeout(() => {
        setSaveState("idle");
        requestClose(id);
      }, 900);
    }, 350);
  };

  const handleKeepEditing = () => {
    setShowUnsavedDialog(false);
    resolveGuardRef.current?.(false);
    resolveGuardRef.current = null;
  };

  const handleDiscard = () => {
    setShowUnsavedDialog(false);
    setDirty(false);
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
        <div onChangeCapture={() => setDirty(true)} onInputCapture={() => setDirty(true)} className="flex flex-col gap-5">
          {children}
          {/* Only appears once there's actually something to save. Stays
              mounted through the saving → success sequence (dirty clears
              the instant success starts) so that moment is never cut off
              mid-animation. */}
          <AnimatePresence>
            {(dirty || saveState !== "idle") && (
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
      </AccordionItem>

      {showUnsavedDialog && <UnsavedChangesDialog onKeepEditing={handleKeepEditing} onDiscard={handleDiscard} />}
    </>
  );
}
