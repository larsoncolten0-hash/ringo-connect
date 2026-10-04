// When is a freshly added track / release still an abandoned, empty row? Such a row is removed when its
// section closes, so this must be conservative: ANY user-entered content that the row can persist keeps it.
// Toggles that start switched on (available, download_enabled, email_delivery_enabled) and fields set at
// creation (release_type, sort_order, profile_id) are not content.

const typed = (v: unknown) => typeof v === "string" ? v.trim() !== "" : v != null && v !== false;
// A price is content only when it is a real amount: "", null and 0 (the value a release is created with) are not.
const hasAmount = (v: unknown) => {
  if (v == null || (typeof v === "string" && v.trim() === "")) return false;
  const n = Number(v);
  return Number.isNaN(n) ? true : n !== 0;
};

export function isBlankTrack(tr: any): boolean {
  return !(
    typed(tr?.title) ||
    typed(tr?.artist_name) ||
    typed(tr?.genre) ||
    typed(tr?.duration) ||
    typed(tr?.description) ||
    typed(tr?.release_id) ||
    typed(tr?.audio_url) ||
    typed(tr?.protected_audio_path) ||
    typed(tr?.preview_audio_url) ||
    typed(tr?.external_url) ||
    typed(tr?.buy_url) ||
    typed(tr?.cover_image_url) ||
    hasAmount(tr?.price)
  );
}

export function isBlankRelease(r: any): boolean {
  return !(typed(r?.title) || typed(r?.description) || typed(r?.cover_image_url) || hasAmount(r?.price));
}
