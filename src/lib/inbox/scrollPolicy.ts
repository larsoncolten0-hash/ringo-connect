// The scroll rules of a conversation, as pure functions (no DOM, no React) so they can be tested. ThreadScroller applies them.
//   * open on the newest message
//   * a new message at the bottom: follow it ONLY if the reader is already near the bottom, or it is a message THIS browser just sent (a local send). A message from the Sales Bot,
//     a colleague, another device or the background refresh never moves a reader who is looking at older ones: it is counted as unseen instead
//   * older messages added above: put the reader back on the message they were looking at (new scrollTop = old scrollTop + how much taller the content became)
//   * content that changes height while the reader is NOT at the bottom (an image that finishes loading above them): keep the message they are looking at where it was
//   * anything else (a status change, a re-read with nothing new): do nothing

export const NEAR_BOTTOM_PX = 96;
export const FAR_FROM_BOTTOM_PX = 320;

export interface ScrollSnapshot {
  firstId: string | null;
  lastId: string | null;
  count: number;
}

export type ScrollDecision =
  | { action: "bottom" }
  | { action: "restore"; top: number }
  | { action: "unseen"; added: number }
  | { action: "none" };

export const distanceFromBottom = (el: { scrollHeight: number; scrollTop: number; clientHeight: number }): number => el.scrollHeight - el.scrollTop - el.clientHeight;
export const isNearBottom = (gap: number): boolean => gap < NEAR_BOTTOM_PX;
export const isFarFromBottom = (gap: number): boolean => gap > FAR_FROM_BOTTOM_PX;

export function decideScroll(args: {
  prev: ScrollSnapshot | null;
  next: ScrollSnapshot;
  /** the reader was near the bottom when the content last changed */
  stick: boolean;
  /** this browser sent a message moments ago and the new last message is (presumably) it */
  localSend: boolean;
  /** recorded just before "Load earlier messages" navigated: the content height and scrollTop at that moment */
  anchor: { height: number; top: number } | null;
  scrollHeight: number;
}): ScrollDecision {
  const { prev, next } = args;
  if (!prev) return { action: "bottom" };
  if (args.anchor && prev.firstId !== next.firstId) return { action: "restore", top: args.anchor.top + (args.scrollHeight - args.anchor.height) };
  if (prev.lastId !== next.lastId) {
    if (args.stick || args.localSend) return { action: "bottom" };
    return { action: "unseen", added: Math.max(1, next.count - prev.count) };
  }
  return { action: "none" };
}

/**
 * How far the scroll position must move so the message the reader is looking at stays where it was, after the content changed height: the message's distance from the top of the
 * visible area before and after. 0 for sub-pixel noise.
 */
export function anchorDelta(offsetBefore: number, offsetAfter: number): number {
  const d = offsetAfter - offsetBefore;
  return Number.isFinite(d) && Math.abs(d) >= 1 ? d : 0;
}
