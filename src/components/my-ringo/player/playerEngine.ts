import type { LibraryTrack } from "@/lib/customer/activity";
import { getObjectUrl, peekObjectUrl } from "./offlineStore";

// The My Ringo music engine — plain TypeScript, no React. One <audio> element
// for the whole app, a play queue, shuffle/repeat, background-friendly track
// changes and the OS Media Session (lock-screen / headphone controls).
//
// ACCESS: every track's audio comes from the EXISTING paid-order route
// (/api/music/tracks/[id]/audio?order=…), which re-verifies on the server that
// the order is PAID and contains the track and returns a short-lived signed
// URL. This file never builds or stores a permanent audio URL, and the 10-second
// preview mechanism on artist pages is not involved.

// Silent, zero-length WAV. Started inside the user's tap it "unlocks" the audio
// element (Safari / every iOS browser only allow playback started from a tap);
// after that, changing the source and playing programmatically is allowed —
// which is also what lets the NEXT track start while the screen is off.
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

// Signed URLs live 10 minutes; treat them as stale a minute early.
const URL_TTL_MS = 9 * 60 * 1000;
const PREFS_KEY = "ringo-player-prefs";

export type RepeatMode = "off" | "all" | "one";

// Where a saved-for-offline copy of a track comes from (injectable for tests).
export type OfflineSource = {
  peek: (key: string) => string | null;
  get: (key: string) => Promise<string | null>;
};
const defaultOffline: OfflineSource = { peek: peekObjectUrl, get: getObjectUrl };

export type PlayerSnapshot = {
  current: LibraryTrack | null;
  queue: LibraryTrack[];
  // Indices into `queue` in PLAY order (shuffled when shuffle is on), and the
  // position of the current track within it.
  order: number[];
  pos: number;
  playing: boolean;
  loading: boolean;
  error: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
};

export type TimeSnapshot = { currentTime: number; duration: number };

function loadPrefs(): { shuffle: boolean; repeat: RepeatMode; volume: number } {
  const defaults = { shuffle: false, repeat: "off" as RepeatMode, volume: 1 };
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    if (!parsed) return defaults;
    return {
      shuffle: parsed.shuffle === true,
      repeat: parsed.repeat === "all" || parsed.repeat === "one" ? parsed.repeat : "off",
      volume: typeof parsed.volume === "number" ? Math.min(1, Math.max(0, parsed.volume)) : 1,
    };
  } catch {
    return defaults;
  }
}

function fisherYates<T>(items: T[]) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function createPlayerEngine(onChange: () => void, onTime: () => void, offline: OfflineSource = defaultOffline) {
  const audio = new Audio();
  audio.preload = "auto";
  const prefs = loadPrefs();
  audio.volume = prefs.volume;

  const s = {
    queue: [] as LibraryTrack[],
    order: [] as number[],
    pos: -1,
    shuffle: prefs.shuffle,
    repeat: prefs.repeat,
    playing: false,
    loading: false,
    error: false,
  };
  let token = 0; // bumps on every load; stale async work checks it and bails
  let loadedAt = 0;
  let refreshed = false; // one automatic fresh-URL retry per load
  let unlocked = false;
  let usingOffline = false; // the loaded source is a saved (blob:) copy, which never expires
  let pendingSeek: (() => void) | null = null; // resume-position listener of the load in flight
  const urls = new Map<string, { url: string; at: number }>();

  const savePrefs = () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ shuffle: s.shuffle, repeat: s.repeat, volume: audio.volume }));
    } catch {
      // storage unavailable (private mode) — preferences just don't persist
    }
  };

  const isSilent = () => audio.src.startsWith("data:");
  const currentTrack = (): LibraryTrack | null => (s.pos >= 0 ? s.queue[s.order[s.pos]] ?? null : null);
  const freshUrl = (key: string) => {
    const e = urls.get(key);
    return e && Date.now() - e.at < URL_TTL_MS ? e.url : null;
  };

  async function fetchUrl(track: LibraryTrack): Promise<string | null> {
    const cached = freshUrl(track.key);
    if (cached) return cached;
    try {
      const res = await fetch(`/api/music/tracks/${track.trackId}/audio?order=${encodeURIComponent(track.orderId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || typeof data?.url !== "string") {
        console.error("Player: audio access refused:", res.status, data?.error);
        return null;
      }
      urls.set(track.key, { url: data.url, at: Date.now() });
      return data.url as string;
    } catch (err) {
      console.error("Player: audio request failed:", err);
      return null;
    }
  }

  function peekNext(): number | null {
    if (s.order.length === 0) return null;
    if (s.pos + 1 < s.order.length) return s.pos + 1;
    return s.repeat === "all" ? 0 : null;
  }

  // Fetch the NEXT track's signed URL ahead of time, so when the current one ends
  // (possibly with the screen off, where a network round trip may not be allowed)
  // the next can start synchronously from the cache.
  function prefetchNext() {
    const np = peekNext();
    if (np == null) return;
    const track = s.queue[s.order[np]];
    if (!track || offline.peek(track.key) || freshUrl(track.key)) return;
    // A saved copy needs no network; otherwise get the signed URL ready.
    void offline.get(track.key).then((u) => {
      if (!u && !freshUrl(track.key)) void fetchUrl(track);
    });
  }

  // ---- OS media controls -------------------------------------------------
  function updateMediaMetadata(track: LibraryTrack) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artistName,
        album: "My Ringo",
        artwork: [{ src: track.coverUrl || "/icon-512.png", sizes: "512x512" }],
      });
    } catch {
      // unsupported artwork/metadata shape — controls still work without it
    }
  }

  function updatePositionState() {
    if (!("mediaSession" in navigator) || !("setPositionState" in navigator.mediaSession)) return;
    if (!isFinite(audio.duration) || audio.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate,
        position: Math.min(audio.currentTime, audio.duration),
      });
    } catch {
      // position out of range while seeking — ignore
    }
  }

  function bindMediaSession() {
    if (!("mediaSession" in navigator)) return;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // action not supported on this browser
      }
    };
    set("play", () => void toggle());
    set("pause", () => audio.pause());
    set("previoustrack", () => prev());
    set("nexttrack", () => next());
    set("seekto", (d) => {
      if (d.seekTime != null) audio.currentTime = d.seekTime;
    });
    set("seekbackward", (d) => {
      audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10));
    });
    set("seekforward", (d) => {
      audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (d.seekOffset || 10));
    });
  }

  // ---- loading & playback --------------------------------------------------
  // IMPORTANT: when triggered by a tap, everything up to the first `await` runs
  // synchronously inside that tap — the cached path calls audio.play() there, and
  // the uncached path unlocks the element there — which is what mobile Safari needs.
  async function loadAt(pos: number, opts: { startAt?: number; isRefresh?: boolean; skipOffline?: boolean } = {}) {
    const myToken = ++token;
    if (pendingSeek) {
      audio.removeEventListener("loadedmetadata", pendingSeek);
      pendingSeek = null;
    }
    if (!opts.isRefresh) refreshed = false;
    s.pos = pos;
    s.error = false;
    s.loading = true;
    const track = currentTrack();
    if (!track) return;
    updateMediaMetadata(track);
    onChange();

    // Prefer a copy saved on this device (works with no connection); fall back
    // to the paid-order signed URL. `skipOffline` is used when a saved copy
    // failed to play, so a bad file can't trap the track.
    let url = (!opts.skipOffline && offline.peek(track.key)) || freshUrl(track.key);
    if (!url) {
      if (!unlocked) {
        audio.src = SILENT_WAV;
        audio.play().catch(() => {});
        unlocked = true;
      }
      url = (!opts.skipOffline ? await offline.get(track.key) : null) || (await fetchUrl(track));
      if (myToken !== token) return;
      if (!url) {
        s.loading = false;
        s.playing = false;
        s.error = true;
        onChange();
        return;
      }
    }

    audio.src = url;
    usingOffline = url.startsWith("blob:");
    loadedAt = Date.now();
    const startAt = opts.startAt || 0;
    if (startAt > 0) {
      const seekOnce = () => {
        audio.currentTime = startAt;
        audio.removeEventListener("loadedmetadata", seekOnce);
        if (pendingSeek === seekOnce) pendingSeek = null;
      };
      pendingSeek = seekOnce;
      audio.addEventListener("loadedmetadata", seekOnce);
    }

    try {
      await audio.play();
    } catch (err: any) {
      if (myToken !== token) return;
      console.error("Player: playback failed:", err?.name, err?.message);
      s.loading = false;
      s.playing = false;
      // NotAllowedError = the browser wants a tap; the track stays loaded so
      // pressing play starts it. Anything else is a real failure.
      s.error = err?.name !== "NotAllowedError" && err?.name !== "AbortError";
      onChange();
      return;
    }
    if (myToken !== token) return;
    prefetchNext();
  }

  function handleEnded() {
    if (isSilent()) return;
    if (s.repeat === "one") {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    const np = peekNext();
    if (np == null) {
      s.playing = false;
      onChange();
      return;
    }
    void loadAt(np);
  }

  function handleError() {
    if (isSilent() || !audio.src) return;
    const track = currentTrack();
    if (!track) return;
    console.error("Player: media error code:", audio.error?.code);
    // A signed URL expires after 10 minutes; a failed range request after a long
    // pause looks like a media error. Fetch a fresh URL and resume in place, once.
    if (!refreshed) {
      refreshed = true;
      urls.delete(track.key);
      void loadAt(s.pos, { startAt: audio.currentTime, isRefresh: true, skipOffline: usingOffline });
      return;
    }
    s.loading = false;
    s.playing = false;
    s.error = true;
    onChange();
  }

  audio.addEventListener("playing", () => {
    if (isSilent()) return;
    s.playing = true;
    s.loading = false;
    s.error = false;
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    onChange();
  });
  audio.addEventListener("pause", () => {
    if (isSilent() || audio.ended) return;
    s.playing = false;
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
    onChange();
  });
  audio.addEventListener("waiting", () => {
    if (isSilent()) return;
    s.loading = true;
    onChange();
  });
  audio.addEventListener("canplay", () => {
    if (isSilent()) return;
    s.loading = false;
    onChange();
  });
  audio.addEventListener("timeupdate", () => {
    if (isSilent()) return;
    onTime();
    updatePositionState();
  });
  audio.addEventListener("loadedmetadata", () => {
    if (isSilent()) return;
    onTime();
    updatePositionState();
  });
  audio.addEventListener("durationchange", () => {
    if (!isSilent()) onTime();
  });
  audio.addEventListener("ended", handleEnded);
  audio.addEventListener("error", handleError);
  bindMediaSession();

  // ---- controls ------------------------------------------------------------
  function buildOrder(startIndex: number, shuffle: boolean) {
    const indices = s.queue.map((_, i) => i);
    if (!shuffle) return indices;
    return [startIndex, ...fisherYates(indices.filter((i) => i !== startIndex))];
  }

  function playQueue(tracks: LibraryTrack[], startIndex: number, opts?: { shuffle?: boolean }) {
    if (tracks.length === 0) return;
    s.queue = tracks.slice();
    if (opts?.shuffle !== undefined) {
      s.shuffle = opts.shuffle;
      savePrefs();
    }
    const start = Math.min(Math.max(startIndex, 0), tracks.length - 1);
    s.order = buildOrder(start, s.shuffle);
    void loadAt(s.shuffle ? 0 : start);
  }

  function toggle() {
    const track = currentTrack();
    if (!track) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    // Nothing loaded yet, a failed load, or a URL that has likely expired while
    // paused: fetch a fresh one and resume where we were.
    if (isSilent() || !audio.src || s.error || (!usingOffline && Date.now() - loadedAt > URL_TTL_MS)) {
      void loadAt(s.pos, { startAt: isSilent() ? 0 : audio.currentTime });
      return;
    }
    audio.play().catch((err) => console.error("Player: play failed:", err?.name, err?.message));
  }

  function next() {
    const np = peekNext();
    if (np == null) {
      audio.pause();
      audio.currentTime = 0;
      s.playing = false;
      onChange();
      return;
    }
    void loadAt(np);
  }

  function prev() {
    // Past the first seconds of a track, "previous" restarts it (standard behaviour).
    if (audio.currentTime > 3 || (s.pos === 0 && s.repeat !== "all")) {
      audio.currentTime = 0;
      return;
    }
    void loadAt(s.pos > 0 ? s.pos - 1 : s.order.length - 1);
  }

  function jumpToPos(pos: number) {
    if (pos >= 0 && pos < s.order.length) void loadAt(pos);
  }

  function seek(seconds: number) {
    if (isFinite(seconds) && !isSilent()) audio.currentTime = Math.max(0, seconds);
  }

  function toggleShuffle() {
    const cur = s.order[s.pos];
    s.shuffle = !s.shuffle;
    if (s.pos >= 0) {
      s.order = buildOrder(cur, s.shuffle);
      s.pos = s.shuffle ? 0 : cur; // the current track keeps playing, uninterrupted
    }
    savePrefs();
    onChange();
    prefetchNext();
  }

  function cycleRepeat() {
    s.repeat = s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off";
    savePrefs();
    onChange();
    prefetchNext();
  }

  function setVolume(v: number) {
    audio.volume = Math.min(1, Math.max(0, v));
    savePrefs();
    onChange();
  }

  function destroy() {
    token++;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      } catch {
        // ignore
      }
      for (const action of ["play", "pause", "previoustrack", "nexttrack", "seekto", "seekbackward", "seekforward"] as MediaSessionAction[]) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // ignore
        }
      }
    }
  }

  return {
    snapshot: (): PlayerSnapshot => ({
      current: currentTrack(),
      queue: s.queue,
      order: s.order,
      pos: s.pos,
      playing: s.playing,
      loading: s.loading,
      error: s.error,
      shuffle: s.shuffle,
      repeat: s.repeat,
      volume: audio.volume,
    }),
    time: (): TimeSnapshot => ({
      currentTime: isSilent() ? 0 : audio.currentTime || 0,
      duration: !isSilent() && isFinite(audio.duration) ? audio.duration : 0,
    }),
    playQueue,
    toggle,
    next,
    prev,
    jumpToPos,
    seek,
    toggleShuffle,
    cycleRepeat,
    setVolume,
    destroy,
  };
}

export type PlayerEngine = ReturnType<typeof createPlayerEngine>;
