"use client";

import { useRef, useState } from "react";
import { Loader2, FileText, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { validateDigitalFile, formatFileSize } from "@/lib/digitalProducts/validation";

// One upload panel for a Digital Product's single downloadable file (PDF or ZIP, V1 — see
// src/lib/digitalProducts/validation.ts). Goes into the PRIVATE `digital-products` bucket (owner-
// scoped RLS, no public/anon read policy at all — see 2026-11-14_digital_products_foundation.sql),
// the exact same "private bucket + owner-only storage policies" shape ProtectedAudioUploadField.tsx
// already uses for protected-audio. A customer's actual download never touches this bucket from the
// client — it always goes through /api/products/download, which independently re-verifies the order
// before minting a short-lived signed URL.
//
// Every upload (first upload or a replace) gets a BRAND-NEW random path — never overwrites an
// existing object — so an existing purchaser's product_order_items.digital_file_path_snapshot
// always keeps pointing at a real, still-downloadable file even after the seller replaces it.
export default function DigitalFileUploadField({
  path,
  fileName,
  fileSizeBytes,
  onChange,
  userId,
  label,
}: {
  path?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
  onChange: (patch: {
    digital_file_path: string | null;
    digital_file_name: string | null;
    digital_file_size_bytes: number | null;
    digital_file_mime: string | null;
  }) => void;
  userId: string;
  label: {
    fileLabel: string;
    acceptedFiles: string;
    maxSize: string;
    upload: string;
    uploading: string;
    replace: string;
    remove: string;
    wrongType: string;
    tooLarge: string;
    uploadFailed: string;
  };
}) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleFile = async (file: File) => {
    setError("");
    const validated = validateDigitalFile(file);
    if (!validated.ok) {
      setError(validated.code === "wrong_type" ? label.wrongType : label.tooLarge);
      return;
    }

    setUploading(true);
    try {
      const ext = validated.mime === "application/pdf" ? "pdf" : "zip";
      const objectPath = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("digital-products").upload(objectPath, file, {
        upsert: false, // brand-new path every time — never overwrite an existing object
        contentType: validated.mime,
      });
      if (uploadError) throw uploadError;

      onChange({
        digital_file_path: objectPath,
        digital_file_name: file.name.slice(0, 300),
        digital_file_size_bytes: file.size,
        digital_file_mime: validated.mime,
      });
    } catch {
      setError(label.uploadFailed);
    } finally {
      setUploading(false);
    }
  };

  // Only ever clears the DB pointer — the storage object itself is never deleted (see the migration's
  // "do not delete a digital file existing customers still need" reasoning; the same rule applies to
  // a plain removal, not just a replace, since we have no cheap way to know client-side whether some
  // past order's snapshot still points at this exact path).
  const remove = () => onChange({ digital_file_path: null, digital_file_name: null, digital_file_size_bytes: null, digital_file_mime: null });

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-ringo-muted">{label.fileLabel}</p>
      {path ? (
        <div className="flex items-center gap-2 rounded-card border border-ringo-border px-3 py-2">
          <FileText size={16} className="shrink-0 text-ringo-indigo" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ringo-text">{fileName || path}</p>
            {typeof fileSizeBytes === "number" && <p className="text-xs text-ringo-muted">{formatFileSize(fileSizeBytes)}</p>}
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="shrink-0 text-xs font-medium text-ringo-indigo px-2 py-1"
          >
            {uploading ? <Loader2 size={13} className="animate-spin" /> : label.replace}
          </button>
          <button type="button" onClick={remove} aria-label={label.remove} className="shrink-0 text-ringo-muted hover:text-red-500 p-1">
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-card border border-dashed border-ringo-border text-ringo-muted hover:border-ringo-indigo hover:text-ringo-indigo transition disabled:opacity-60"
        >
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
          {uploading ? label.uploading : label.upload}
        </button>
      )}
      {!path && (
        <p className="text-xs text-ringo-muted">
          {label.acceptedFiles} · {label.maxSize}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf,application/zip,application/x-zip-compressed,.zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
