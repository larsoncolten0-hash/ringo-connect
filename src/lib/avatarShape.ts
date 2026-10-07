// The shape of a profile owner's own picture on their public pages: round (the default, what every profile has always had) or a soft rounded square. A DISPLAY preference only:
// the stored image is never cropped or changed by it. One tiny module so the editor and every public surface agree on the same two values, the same fallback and the same radii.
export type AvatarShape = "round" | "square";
export type AvatarSize = "hero" | "large" | "medium" | "small";

/** Anything other than "square" (a missing column, null, an old row, a typo) is round: nobody's profile changes unless they choose it. */
export function normalizeAvatarShape(value: unknown): AvatarShape {
  return value === "square" ? "square" : "round";
}

// Square uses Ringo's own radius tokens (tailwind rounded-ringo-*): the bigger the picture, the softer the corner, never a sharp one. (Literal class names so Tailwind sees them.)
const SQUARE_RADIUS: Record<AvatarSize, string> = {
  hero: "rounded-ringo-lg",
  large: "rounded-ringo-lg",
  medium: "rounded-ringo-md",
  small: "rounded-ringo-sm",
};

/** The radius class for a picture of the given shape and size. Round is always `rounded-full`, so a profile that never chose square renders exactly as before. */
export function avatarRadius(shape: AvatarShape, size: AvatarSize): string {
  return shape === "square" ? SQUARE_RADIUS[size] : "rounded-full";
}
