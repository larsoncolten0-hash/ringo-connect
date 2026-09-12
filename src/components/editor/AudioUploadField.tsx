"use client";

import { useRef, useState } from "react";
import { Loader2, Music, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Same upload mechanism as ImageUploadField (same "uploads" storage
// bucket, same per-profile path scheme) — just accepting audio instead of
// images, so a track's Play button can play the creator's own file
// natively instead of only ever linking out.
const MAX_SIZE_BYTES = 15 * 1024 * 1024; // ~15MB — a few minutes of mp3 at a reasonable bitrate

export default function AudioUploadField({
  value,
  onChange,
  pathPrefix,
  label,
  errorText,
  maxDurationSeconds,
}: {
  value?: string | null;
  onChange: (url: string) => void;
  pathPrefix: string;
  label: { upload: string; replace: string; remove: string };
  errorText?: { tooLarge: string; wrongType: string; failed: string; tooLong?: string };
  // Used for the 10-second preview-clip upload — rejects the file
  // client-side before it ever uploads. This is a courtesy check on the
  // ARTIST's own upload of their OWN preview, not a security boundary (the
  // real boundary is that the full/protected file is never sent to a fan
  // who hasn't purchased — see ProtectedAudioUploadField).
  maxDurationSeconds?: number;
}) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const checkDuration = (file: File): Promise<number> =>
    new Promise((resolve, reject) => {
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(audio.src);
        resolve(audio.duration);
      };
      audio.onerror = () => reject(new Error("Could not read audio file"));
      audio.src = URL.createObjectURL(file);
    });

  const handleFile = async (file: File) => {
    setError("");

    if (!file.type.startsWith("audio/")) {
      setError(errorText?.wrongType || "Please choose an audio file.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError(errorText?.tooLarge || "Audio files must be under 15MB.");
      return;
    }
    if (maxDurationSeconds) {
      try {
        const duration = await checkDuration(file);
        if (duration > maxDurationSeconds + 0.5) {
          setError(errorText?.tooLong || `This clip must be ${maxDurationSeconds} seconds or shorter.`);
          return;
        }
      } catch {
        // If duration can't be read, fall through and let the upload
        // proceed rather than blocking on a browser quirk.
      }
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "mp3";
      const path = `${pathPrefix}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("uploads").upload(path, file, {
        upsert: true,
        cacheControl: "3600",
      });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("uploads").getPublicUrl(path);
      onChange(data.publicUrl);
    } catch {
      setError(errorText?.failed || "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {value ? (
          <>
            <audio src={value} controls className="h-9 flex-1 min-w-0" />
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label={label.remove}
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:text-red-500 hover:bg-red-500/10 transition"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-card border border-dashed border-ringo-border text-ringo-muted hover:border-ringo-indigo hover:text-ringo-indigo transition disabled:opacity-60"
          >
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Music size={13} />}
            {label.upload}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
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
