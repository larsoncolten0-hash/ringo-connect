// "Save for offline" — purchased tracks kept in the browser's own storage
// (IndexedDB) so they play with no connection and without re-downloading.
//
// ACCESS: a track is only ever saved by fetching it through the EXISTING
// paid-order route (/api/music/tracks/[id]/audio?order=…) — the server still
// verifies the order is PAID and contains the track before returning the
// short-lived signed URL. Nothing here reaches around that check, and an
// offline copy is only ever OFFERED for tracks the artist allows to be
// downloaded (the caller passes only those).
//
// PRIVACY: the store never lists anything by itself — the My Ringo UI shows a
// saved track only if it is ALSO in the signed-in customer's own server-side
// library, and prune() deletes everything else, so a second customer on the same
// device never sees or plays the first one's saved files. Sign-out clears it all.

const DB_NAME = "ringo-offline";
const DB_VERSION = 1;
const AUDIO = "audio"; // { key, blob }   — the file
const META = "meta"; //   { key, size, savedAt } — small, listed without loading blobs

export type OfflineTrackRef = { key: string; trackId: string; orderId: string };
export type SaveResult = "saved" | "failed" | "aborted" | "quota";

type SavedMeta = { size: number; savedAt: number };
type Active = { progress: number; controller: AbortController };

const saved = new Map<string, SavedMeta>();
const active = new Map<string, Active>();
const objectUrls = new Map<string, string>();
const listeners = new Set<() => void>();
let loaded = false;
let persistAsked = false;

const notify = () => listeners.forEach((l) => l());

export const isOfflineSupported = () => typeof indexedDB !== "undefined" && typeof fetch !== "undefined";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO, { keyPath: "key" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

const request = <T,>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

// ---- reading state ---------------------------------------------------------

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSavedMeta(key: string): SavedMeta | null {
  return saved.get(key) ?? null;
}
export function getProgress(key: string): number | null {
  return active.get(key)?.progress ?? null;
}
export function totalSavedBytes(): number {
  let total = 0;
  saved.forEach((m) => (total += m.size));
  return total;
}
export function savedCount(): number {
  return saved.size;
}

/** Loads the list of saved tracks (metadata only — no audio is read). */
export async function loadSaved(): Promise<void> {
  if (!isOfflineSupported() || loaded) return;
  try {
    const db = await openDb();
    const rows = await request(db.transaction(META).objectStore(META).getAll());
    db.close();
    saved.clear();
    for (const r of rows as any[]) saved.set(r.key, { size: r.size, savedAt: r.savedAt });
    loaded = true;
    notify();
  } catch (err) {
    console.error("Offline: could not read saved tracks:", err);
  }
}

// ---- playback access -------------------------------------------------------

/** Already-created blob URL for a saved track, if we have one in memory. */
export function peekObjectUrl(key: string): string | null {
  return objectUrls.get(key) ?? null;
}

/** A playable blob: URL for a saved track, or null if it isn't saved. */
export async function getObjectUrl(key: string): Promise<string | null> {
  const existing = objectUrls.get(key);
  if (existing) return existing;
  if (!isOfflineSupported()) return null;
  try {
    const db = await openDb();
    const row = (await request(db.transaction(AUDIO).objectStore(AUDIO).get(key))) as { blob?: Blob } | undefined;
    db.close();
    if (!row?.blob) return null;
    const url = URL.createObjectURL(row.blob);
    objectUrls.set(key, url);
    return url;
  } catch (err) {
    console.error("Offline: could not read saved audio:", err);
    return null;
  }
}

// ---- saving ----------------------------------------------------------------

async function signedUrl(ref: OfflineTrackRef, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(`/api/music/tracks/${ref.trackId}/audio?order=${encodeURIComponent(ref.orderId)}`, { signal });
  const data = await res.json().catch(() => null);
  if (!res.ok || typeof data?.url !== "string") {
    console.error("Offline: audio access refused:", res.status, data?.error);
    return null;
  }
  return data.url as string;
}

export async function save(ref: OfflineTrackRef): Promise<SaveResult> {
  if (!isOfflineSupported() || active.has(ref.key) || saved.has(ref.key)) return saved.has(ref.key) ? "saved" : "failed";

  const controller = new AbortController();
  active.set(ref.key, { progress: 0, controller });
  notify();

  // Ask the browser not to evict our storage under pressure (best effort; a
  // no-op where unsupported or when it declines).
  if (!persistAsked) {
    persistAsked = true;
    try {
      void navigator.storage?.persist?.();
    } catch {
      // ignore
    }
  }

  try {
    const url = await signedUrl(ref, controller.signal);
    if (!url) return "failed";

    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) return "failed";
    const total = Number(res.headers.get("content-length")) || 0;

    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let received = 0;
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      chunks.push(value as BlobPart);
      received += value.byteLength;
      const entry = active.get(ref.key);
      if (entry && total > 0) {
        entry.progress = Math.min(0.99, received / total);
        notify();
      }
    }
    if (received === 0) return "failed";

    const blob = new Blob(chunks, { type: res.headers.get("content-type") || "audio/mpeg" });
    const meta = { key: ref.key, size: blob.size, savedAt: Date.now() };

    const db = await openDb();
    try {
      const tx = db.transaction([AUDIO, META], "readwrite");
      tx.objectStore(AUDIO).put({ key: ref.key, blob });
      tx.objectStore(META).put(meta);
      await done(tx);
    } finally {
      db.close();
    }
    saved.set(ref.key, { size: meta.size, savedAt: meta.savedAt });
    return "saved";
  } catch (err: any) {
    if (err?.name === "AbortError") return "aborted";
    console.error("Offline: save failed:", err?.name, err?.message);
    return err?.name === "QuotaExceededError" ? "quota" : "failed";
  } finally {
    active.delete(ref.key);
    notify();
  }
}

export function cancel(key: string) {
  active.get(key)?.controller.abort();
}

// ---- removing --------------------------------------------------------------

function forget(key: string) {
  const url = objectUrls.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(key);
  }
  saved.delete(key);
}

export async function remove(key: string): Promise<void> {
  if (!isOfflineSupported()) return;
  try {
    const db = await openDb();
    const tx = db.transaction([AUDIO, META], "readwrite");
    tx.objectStore(AUDIO).delete(key);
    tx.objectStore(META).delete(key);
    await done(tx);
    db.close();
  } catch (err) {
    console.error("Offline: remove failed:", err);
  }
  forget(key);
  notify();
}

/** Deletes every saved track NOT in `validKeys` (e.g. another customer's files). */
export async function prune(validKeys: Set<string>): Promise<void> {
  await loadSaved();
  for (const key of [...saved.keys()]) {
    if (!validKeys.has(key)) await remove(key);
  }
}

/** Wipes everything (sign-out). Also cancels downloads in flight. */
export async function clearAll(): Promise<void> {
  active.forEach((a) => a.controller.abort());
  if (isOfflineSupported()) {
    try {
      const db = await openDb();
      const tx = db.transaction([AUDIO, META], "readwrite");
      tx.objectStore(AUDIO).clear();
      tx.objectStore(META).clear();
      await done(tx);
      db.close();
    } catch (err) {
      console.error("Offline: clear failed:", err);
    }
  }
  for (const key of [...saved.keys()]) forget(key);
  saved.clear();
  notify();
}
