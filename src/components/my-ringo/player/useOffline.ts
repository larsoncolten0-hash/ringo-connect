"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import type { LibraryTrack } from "@/lib/customer/activity";
import * as store from "./offlineStore";

// React view of the offline store. The store itself is a module singleton, so
// a download keeps running (and its progress keeps showing) if the customer
// navigates away from the Music page and back.
export function useOffline() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [supported, setSupported] = useState(false);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<"failed" | "quota" | null>(null);

  useEffect(() => {
    setSupported(store.isOfflineSupported());
    setOnline(navigator.onLine);
    void store.loadSaved();
    const unsubscribe = store.subscribe(bump);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      unsubscribe();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const track = useCallback(async (t: LibraryTrack) => {
    setError(null);
    const result = await store.save({ key: t.key, trackId: t.trackId, orderId: t.orderId });
    if (result === "failed" || result === "quota") setError(result);
    return result;
  }, []);

  // One at a time — gentle on the connection and on storage; stops if the
  // device runs out of space.
  const trackAll = useCallback(
    async (tracks: LibraryTrack[]) => {
      for (const t of tracks) {
        if (!t.canDownload || store.getSavedMeta(t.key)) continue;
        const result = await track(t);
        if (result === "quota") break;
      }
    },
    [track]
  );

  return {
    supported,
    online,
    error,
    isSaved: (key: string) => store.getSavedMeta(key) !== null,
    progress: (key: string) => store.getProgress(key),
    savedCount: store.savedCount(),
    totalBytes: store.totalSavedBytes(),
    save: track,
    saveAll: trackAll,
    cancel: store.cancel,
    remove: (key: string) => store.remove(key),
    removeAll: async (tracks: LibraryTrack[]) => {
      for (const t of tracks) if (store.getSavedMeta(t.key)) await store.remove(t.key);
    },
    prune: store.prune,
  };
}
