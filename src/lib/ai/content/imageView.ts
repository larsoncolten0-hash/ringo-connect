// Ringo AI generated image (Phase: Image Generation). Unlike a draft, a
// generated image is never applied to a Ringo record — it's a direct
// result the owner can view/download themselves, same non-applying
// posture as ContentView (content/view.ts), but backed by a REAL stored
// file (not ephemeral text), since the underlying bytes can't be
// regenerated from the model afterward.

export interface ImageView {
  id: string;
  /** Durable public URL in Supabase Storage — never a raw base64 payload sent to the client. */
  imageUrl: string;
  prompt: string;
  model: string;
  size: string;
  quality: string;
}
