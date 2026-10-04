"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAutosave } from "@/components/dashboard/sectionAutosave";
import { useEditorPreview } from "./EditorPreviewContext";

// The list behaviour shared by every editor card whose rows save on their own (tracks, releases,
// tables, and the add/remove/reorder part of links, products, menu, phones). Every database write goes
// through the section's auto-save engine, so a failure is never silent and the screen never keeps
// showing something the database does not have:
//
//   add        the row only appears once the database confirmed it (no phantom rows)
//   addLocal   a row on screen only (for cards whose Save button creates it); see swapIn
//   remove     disappears at once; if the delete fails the row comes back where it was
//   reorder    new order shows at once, saved after a short pause; if it fails the last saved order returns
//   persist    a field saved on blur: the typed value stays, a failure is kept for a retry
//   update     local-only edit (for fields saved later by a Save button, or before persist)
//
// Rows are mirrored into the live preview draft under `draftKey`, as the cards did before.
type Row = { id: string; sort_order?: number | null; [key: string]: any };

const bySort = (a: Row, b: Row) => (a.sort_order ?? 0) - (b.sort_order ?? 0);

// Rows created with addLocal() exist on screen only: no database row is made when someone taps "Add".
// They get a real row (swapIn) when the card's own Save finds real content in them, or are dropped if
// they stay empty. A temporary id can never reach the database.
export const TEMP_PREFIX = "new:";
export const isTempId = (id: unknown): boolean => typeof id === "string" && id.startsWith(TEMP_PREFIX);

export function useAutosavedRows<T extends Row>(
  table: string,
  draftKey: string,
  initial: T[],
  opts: {
    /**
     * For lists whose rows must exist in the database as soon as they are added (an upload needs the row's
     * id). When the card closes, rows THIS card added that are still blank by this test are deleted, so
     * tapping "Add" and walking away leaves no empty record behind. Rows that already had content are kept.
     */
    isBlank?: (row: T) => boolean;
  } = {}
) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const autosave = useAutosave();
  const { updateDraft } = useEditorPreview();
  const [rows, setRows] = useState<T[]>(() => [...initial].sort(bySort));
  const rowsRef = useRef(rows);
  // the sort_order the DATABASE has for each saved row (what a failed reorder rolls back to)
  const savedSort = useRef(new Map<string, number>(rows.map((r, i) => [r.id, r.sort_order ?? i] as const)));

  const commit = (next: T[]) => {
    rowsRef.current = next;
    setRows(next);
    updateDraft({ [draftKey]: next });
  };

  // ids of rows this card instance created with add(); only these are ever cleaned up
  const createdIds = useRef(new Set<string>());
  const isBlankRef = useRef(opts.isBlank);
  isBlankRef.current = opts.isBlank;
  useEffect(
    () => () => {
      const blank = isBlankRef.current;
      if (!blank) return;
      const doomed = rowsRef.current.filter((r) => createdIds.current.has(r.id) && blank(r));
      if (doomed.length === 0) return;
      // Fire and forget: the card is closing. A failure only leaves an empty row, which is never counted as
      // content. The section already re-fetched its snapshot when it closed, before these deletes landed, so
      // fetch once more when they are done; otherwise reopening could show an empty row that no longer exists.
      void Promise.all(doomed.map((r) => supabase.from(table).delete().eq("id", r.id))).then(() => router.refresh());
      updateDraft({ [draftKey]: rowsRef.current.filter((r) => !doomed.some((d) => d.id === r.id)) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** Edit a row on screen only. */
  const update = (id: string, patch: Partial<T>) => commit(rowsRef.current.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /**
   * Save fields of one row (typically on blur). By default the typed value stays and a failure is kept
   * for a retry; pass `rollback` for settings where showing an unsaved value would mislead (a switch, a QR code).
   */
  const persist = (id: string, patch: Record<string, any>, opts: { rollback?: () => void } = {}) =>
    isTempId(id)
      ? Promise.resolve(true) // not in the database yet: the card's Save will create it
      : autosave.run(() => supabase.from(table).update(patch).eq("id", id), {
          key: `${table}:${id}:${Object.keys(patch).sort().join(",")}`,
          rollback: opts.rollback,
        });

  /** Insert a row; resolves to it once the database confirmed, or null if it failed. */
  const add = async (payload: Record<string, any>): Promise<T | null> => {
    let created: T | null = null;
    const ok = await autosave.run(
      async () => {
        const res = await supabase.from(table).insert(payload).select().single();
        created = (res.data as T | null) ?? null;
        return res.error || !res.data ? { error: res.error ?? new Error("no row returned") } : res;
      },
      { rollback: () => {} } // nothing was shown yet, so there is nothing to undo
    );
    if (!ok || !created) return null;
    const row = created as T;
    commit([...rowsRef.current, row]);
    createdIds.current.add(row.id);
    savedSort.current.set(row.id, row.sort_order ?? rowsRef.current.length - 1);
    return row;
  };

  /** Remove a row now; put it back where it was if the delete fails. Resolves true if it is really gone. */
  const remove = async (id: string): Promise<boolean> => {
    const index = rowsRef.current.findIndex((r) => r.id === id);
    if (index < 0) return true;
    const removed = rowsRef.current[index];
    commit(rowsRef.current.filter((r) => r.id !== id));
    if (isTempId(id)) return true; // never saved: nothing to delete
    const ok = await autosave.run(() => supabase.from(table).delete().eq("id", id), {
      rollback: () => {
        if (rowsRef.current.some((r) => r.id === id)) return;
        const next = [...rowsRef.current];
        next.splice(Math.min(index, next.length), 0, removed);
        commit(next);
      },
    });
    if (ok) savedSort.current.delete(id);
    return ok;
  };

  /**
   * New order now; saved after a short pause. On failure the last saved order returns.
   * `newOrder` is the new order of the rows being reordered: the whole list, or (with `scopeKey`) just one
   * group of it, such as the items of one menu category. Rows outside the group are left alone.
   */
  const reorder = (newOrder: T[], scopeKey?: string) => {
    const reindexed = newOrder.map((r, i) => ({ ...r, sort_order: i })) as T[];
    const sortById = new Map(reindexed.map((r) => [r.id, r.sort_order as number] as const));
    const next =
      scopeKey === undefined
        ? reindexed
        : (rowsRef.current.map((r) => (sortById.has(r.id) ? { ...r, sort_order: sortById.get(r.id)! } : r)) as T[]);
    commit(next);
    const saved = reindexed.filter((r) => !isTempId(r.id)); // rows not in the database yet have no order to save
    autosave.schedule(
      `${table}:order${scopeKey === undefined ? "" : `:${scopeKey}`}`,
      async () => {
        const results = await Promise.all(saved.map((r) => supabase.from(table).update({ sort_order: r.sort_order }).eq("id", r.id)));
        const failed = results.find((r) => r.error);
        if (!failed) for (const r of saved) savedSort.current.set(r.id, r.sort_order as number);
        return failed ?? { error: null };
      },
      400,
      {
        rollback: () => {
          const inGroup = new Set(reindexed.map((r) => r.id));
          const back = rowsRef.current.map((r) =>
            inGroup.has(r.id) && savedSort.current.has(r.id) ? ({ ...r, sort_order: savedSort.current.get(r.id)! } as T) : r
          );
          commit(scopeKey === undefined ? [...back].sort(bySort) : back);
        },
      }
    );
  };

  /** Replace the whole list on screen (for cards with their own add flow). Does not touch the database. */
  const replace = (next: T[]) => commit(next);

  /** Put rows back (after a failed delete of something that owned them). Does not touch the database. */
  const restoreRows = (back: T[]) => {
    const missing = back.filter((b) => !rowsRef.current.some((r) => r.id === b.id));
    if (missing.length) commit([...rowsRef.current, ...missing]);
  };

  /** "Add" for cards that save with a Save button: a row on screen only, no database row yet. */
  const addLocal = (fields: Partial<T>): T => {
    const row = { sort_order: rowsRef.current.length, ...fields, id: `${TEMP_PREFIX}${crypto.randomUUID()}` } as T;
    commit([...rowsRef.current, row]);
    return row;
  };

  /** A temporary row was inserted: swap in the real row so a later Save cannot insert it twice. */
  const swapIn = (tempId: string, saved: T) => {
    commit(rowsRef.current.map((r) => (r.id === tempId ? saved : r)));
    savedSort.current.set(saved.id, saved.sort_order ?? rowsRef.current.length - 1);
  };

  return { rows, update, persist, add, remove, reorder, replace, restoreRows, addLocal, swapIn };
}
