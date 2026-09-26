// Digital Products V1 — the ONE place file-type/size rules are defined, imported by both the
// seller's upload UI (client-side check, fast feedback) and the API route that actually writes
// products.digital_file_* (server-side check, the real gate — never trusts the browser alone).
// Pure, dependency-free: no Supabase/Next/browser APIs, so it is trivially unit-testable and safe
// to import from either side.
//
// V1 is PDF and ZIP only (see the Digital Products V1 spec) — do not add other types here.

export const DIGITAL_PRODUCT_MAX_BYTES = 25 * 1024 * 1024; // 25 MiB — matches the DB CHECK in
// 2026-11-14_digital_products_foundation.sql (products_digital_file_size_check) and the existing
// protected-audio upload precedent (ProtectedAudioUploadField.tsx's own 25MB cap).

export type DigitalFileMime = "application/pdf" | "application/zip";

/**
 * Normalizes whatever the browser/OS reports for a file's type down to exactly one of the two
 * canonical values the database CHECK constraint allows — or null if the file is not a PDF/ZIP.
 * Falls back to the extension when the reported MIME type is missing or one of the several
 * non-standard values real operating systems hand out for ZIP files (the same "some file providers
 * don't tag MIME types correctly" problem ProtectedAudioUploadField.tsx already documents and
 * works around for audio).
 */
export function normalizeDigitalFileType(file: { name: string; type: string | null | undefined }): DigitalFileMime | null {
  const type = (file.type || "").toLowerCase();
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  if (type === "application/pdf" || ext === "pdf") return "application/pdf";
  if (
    type === "application/zip" ||
    type === "application/x-zip-compressed" ||
    type === "application/x-zip" ||
    ext === "zip"
  ) {
    return "application/zip";
  }
  return null;
}

export type DigitalFileValidationError = "wrong_type" | "too_large";

export interface DigitalFileValidationOk {
  ok: true;
  mime: DigitalFileMime;
}
export interface DigitalFileValidationFail {
  ok: false;
  code: DigitalFileValidationError;
}

/** The single validation gate: PDF/ZIP only, 25 MiB max. Order matters: type is checked before
 *  size, so an oversized file of the WRONG type is reported as "wrong type" first (matching how a
 *  seller would want to fix things one problem at a time), exactly the priority
 *  ImageGalleryUploadField/ProtectedAudioUploadField already use for their own two checks. */
export function validateDigitalFile(file: { name: string; type: string | null | undefined; size: number }): DigitalFileValidationOk | DigitalFileValidationFail {
  const mime = normalizeDigitalFileType(file);
  if (!mime) return { ok: false, code: "wrong_type" };
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > DIGITAL_PRODUCT_MAX_BYTES) {
    return { ok: false, code: "too_large" };
  }
  return { ok: true, mime };
}

/** Human-readable file size for the seller dashboard's "file size" display (e.g. "3.2 MB"). */
export function formatFileSize(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
