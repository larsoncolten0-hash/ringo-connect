// Pure helpers for showing a stored WhatsApp media file inside a conversation (no React, no network).

/** m:ss (or h:mm:ss) for a playback position. Unknown / invalid values show as "--:--" so a missing duration never looks like 0:00. */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * WhatsApp voice notes arrive as audio/ogg with the Opus codec ("audio/ogg; codecs=opus"). The webhook's own "voice" flag is not stored by Ringo, so the stored type is the only
 * signal: an OGG/Opus audio message is shown as a voice note, any other audio (MP3, M4A, AAC, AMR...) as an audio file. Never claims more than the stored type says.
 */
export function isVoiceNote(kind: string, mimeType: string | null | undefined): boolean {
  if (kind !== "audio") return false;
  const m = (mimeType || "").toLowerCase();
  return m.includes("ogg") && m.includes("opus");
}

/** An image / video frame keeps a stable shape: the natural ratio once known, clamped so a very wide or very tall file cannot take over the conversation. */
export function clampRatio(width: number, height: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return fallback;
  return Math.min(max, Math.max(min, width / height));
}

/** Short, human label for a stored MIME type ("application/pdf" -> "PDF"); never throws. */
export function shortType(mimeType: string | null | undefined): string {
  const m = (mimeType || "").split(";")[0].trim().toLowerCase();
  if (!m) return "";
  const map: Record<string, string> = {
    "application/pdf": "PDF",
    "application/msword": "DOC",
    "application/vnd.ms-excel": "XLS",
    "application/vnd.ms-powerpoint": "PPT",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
    "text/plain": "TXT",
    "application/zip": "ZIP",
  };
  if (map[m]) return map[m];
  const sub = m.split("/")[1] || m;
  return sub.replace(/^x-/, "").replace(/\+.*$/, "").toUpperCase().slice(0, 12);
}
