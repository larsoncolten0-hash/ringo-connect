// Waveform data for the My Ringo player: a small array of normalised
// amplitudes (0–1), one per bar. The real peaks are read ONCE per track from
// the file the player already resolved (a saved offline copy, or the signed
// URL), then cached in memory and in localStorage — so a track is never
// analysed twice. Until (or if) the real peaks arrive, a stable shape seeded
// from the track key is shown so the bars never jump around or sit empty.
//
// Decoding uses an OfflineAudioContext on purpose: unlike a normal
// AudioContext it never touches the device's audio session, so it cannot
// interfere with background / lock-screen playback on iOS.

export const BAR_COUNT = 72;
// Very long files are skipped (decoding needs the whole file in memory).
const MAX_BYTES = 30 * 1024 * 1024;
const STORAGE_PREFIX = "ringo-peaks:v1:";

const memory = new Map<string, number[]>();

export function cachedPeaks(key: string): number[] | null {
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === BAR_COUNT && parsed.every((n) => typeof n === "number")) {
      memory.set(key, parsed);
      return parsed;
    }
  } catch {
    // storage unavailable — the in-memory cache still works
  }
  return null;
}

function remember(key: string, peaks: number[]) {
  memory.set(key, peaks);
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(peaks));
  } catch {
    // quota / private mode — not needed for correctness
  }
}

// A pleasant, stable placeholder shape (slow swell + light texture).
export function seededPeaks(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  const rnd = () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const phase = rnd() * Math.PI * 2;
  const out: number[] = [];
  let prev = 0.5;
  for (let i = 0; i < BAR_COUNT; i++) {
    const swell = 0.5 + 0.28 * Math.sin(phase + (i / BAR_COUNT) * Math.PI * 3.2);
    prev = prev * 0.45 + rnd() * 0.55; // smoothed noise so neighbours relate
    out.push(Math.min(1, Math.max(0.14, swell * 0.7 + prev * 0.5)));
  }
  return out;
}

function toPeaks(data: Float32Array): number[] {
  const bucket = Math.max(1, Math.floor(data.length / BAR_COUNT));
  const stride = Math.max(1, Math.floor(bucket / 240));
  const raw: number[] = [];
  for (let b = 0; b < BAR_COUNT; b++) {
    let sum = 0;
    let max = 0;
    let n = 0;
    const end = Math.min(data.length, (b + 1) * bucket);
    for (let i = b * bucket; i < end; i += stride) {
      const v = Math.abs(data[i]);
      sum += v * v;
      if (v > max) max = v;
      n++;
    }
    raw.push(n ? 0.65 * Math.sqrt(sum / n) + 0.35 * max : 0);
  }
  const top = Math.max(...raw, 1e-6);
  return raw.map((v) => Math.round(Math.min(1, Math.max(0.08, Math.pow(v / top, 0.8))) * 100) / 100);
}

const inflight = new Map<string, Promise<number[] | null>>();

// Resolves to real peaks, or null if this device/file can't be analysed
// (the caller keeps the seeded shape). Aborts cleanly on track change.
export function loadPeaks(key: string, url: string, signal: AbortSignal): Promise<number[] | null> {
  const known = cachedPeaks(key);
  if (known) return Promise.resolve(known);
  const running = inflight.get(key);
  if (running) return running;

  const job = (async () => {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) return null;
      if (Number(res.headers.get("content-length") || 0) > MAX_BYTES) {
        void res.body?.cancel();
        return null;
      }
      const buf = await res.arrayBuffer();
      if (signal.aborted || buf.byteLength > MAX_BYTES) return null;
      const Offline: typeof OfflineAudioContext | undefined =
        window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
      if (!Offline) return null;
      const ctx = new Offline(1, 1, 44100);
      const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
        const maybe = ctx.decodeAudioData(buf, resolve, reject); // callback form for older Safari
        if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
      });
      const peaks = toPeaks(decoded.getChannelData(0));
      remember(key, peaks);
      return peaks;
    } catch {
      return null; // aborted, CORS, undecodable — fall back to the seeded shape
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}
