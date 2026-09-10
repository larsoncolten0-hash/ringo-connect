"use client";

import { useRef, useState } from "react";
import { Loader2, Lock, Play, Pause, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const MAX_SIZE_BYTES = 25 * 1024 * 1024; // ~25MB — a full-length track at a reasonable bitrate

// Uploads to the PRIVATE `protected-audio` bucket (see the migration) and
// stores only the storage PATH, never a public URL — there isn't one; the
// bucket has no public-read policy. Once a track has a path here, it
// becomes a real gated purchase (see TrackRow) — a fan only ever gets a
// short-lived signed URL to it, minted server-side after their purchase
// is verified (/api/music/tracks/[id]/audio). The "preview" button here
// is for the ARTIST's own use while managing their catalog — it works
// because the storage policy lets an owner read their own uploaded path,
// via a signed URL generated with their own session, not a public one.
export default function ProtectedAudioUploadField({
  value,
  onChange,
  pathPrefix,
  label,
}: {
  value?: string | null;
  onChange: (path: string) => void;
  pathPrefix: string;
  label: { upload: string; remove: string; preview: string; protected: string };
}) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  const handleFile = async (file: File) => {
    setError("");
    if (!file.type.startsWith("audio/")) {
      setError("Please choose an audio file.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError("Audio files must be under 25MB.");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "mp3";
      const path = `${pathPrefix}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("protected-audio").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      onChange(path);
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const togglePreview = async () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    if (!value) return;
    const { data, error: signError } = await supabase.storage.from("protected-audio").createSignedUrl(value, 300);
    if (signError || !data) {
      setError("Could not load preview.");
      return;
    }
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = data.signedUrl;
    audioRef.current.onended = () => setPlaying(false);
    await audioRef.current.play();
    setPlaying(true);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {value ? (
          <>
            <button
              type="button"
              onClick={togglePreview}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-card border border-ringo-border text-ringo-text"
            >
              {playing ? <Pause size={13} /> : <Play size={13} />}
              {label.preview}
            </button>
            <span className="flex items-center gap-1 text-xs text-ringo-muted">
              <Lock size={11} /> {label.protected}
            </span>
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label={label.remove}
              className="ml-auto shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:text-red-500 hover:bg-red-500/10 transition"
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
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
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
