import { THREAD_LIMIT } from "./data";

// How many messages a conversation shows. 100 by default (THREAD_LIMIT); "Load earlier messages" asks for 100 more each time, up to THREAD_MAX. The number travels in the url
// (?n=200), so it is clamped here and never trusted: the browser cannot ask for an unbounded read.
export const THREAD_STEP = 100;
export const THREAD_MAX = 500;

export function clampThreadLimit(raw: unknown): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = typeof v === "string" && /^[0-9]{1,9}$/.test(v) ? Number(v) : THREAD_LIMIT;
  return Math.min(THREAD_MAX, Math.max(THREAD_LIMIT, Math.floor(n / THREAD_STEP) * THREAD_STEP));
}
