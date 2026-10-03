/**
 * Which item a menu's keyboard navigation lands on. `key` is a KeyboardEvent.key; the list wraps at both
 * ends. Returns null for keys that do not move the selection, so the caller can leave them alone.
 */
export function nextMenuIndex(key: string, current: number, length: number): number | null {
  if (length <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % length;
  if (key === "ArrowUp") return current < 0 ? length - 1 : (current - 1 + length) % length;
  return null;
}

/** The target size, in pixels, public controls are brought up to (the editor's standard from Phase 2). */
export const MIN_TAP_TARGET_PX = 44;

/**
 * Grows a control's tappable area to the minimum without changing how it looks: an invisible layer
 * extends 4px past each side of a 36px control. Add to a `relative` (or this class makes it relative)
 * button whose visible size is 36px.
 */
export const TAP_AREA_36 = "relative before:absolute before:-inset-1 before:content-['']";
