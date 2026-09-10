"use client";

import { useRef, useState } from "react";
import { Loader2, Lock, X, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { decodeAudioFile, trimToPreviewMp3, MAX_PREVIEW_SECONDS } from "@/lib/audioTrim";

const MAX_SIZE_BYTES = 25 * 1024 * 1024; // ~25MB — a full-length track at a reasonable bitrate

// One upload panel for a track sold as a real purchase: the artist
// uploads exactly one audio file. It goes into the PRIVATE `protected-
// audio` bucket (only ever reachable by the owner, or a fan after a
// verified purchase — see /api/music/tracks/[id]/audio) — but before that
// upload even finishes, the same local file is also decoded right here in
// the browser, trimmed down to its first MAX_PREVIEW_SECONDS, and
// re-encoded as a small MP3 that's uploaded to the normal public bucket.
// That short public clip is the only thing a fan ever gets to hear before
// buying — nothing about the full file is ever exposed. No manual
// start/end picking, no second upload: one file in, both fields come out.
export default function ProtectedAudioUploadField({
  protectedPath,
  previewUrl,
  onChange,
  pathPrefix,
  previewPathPrefix,
  label,
}: {
  protectedPath?: string | null;
  previewUrl?: string | null;
  onChange: (patch: { protected_audio_path: string; preview_audio_url: string }) => void;
  pathPrefix: string;
  previewPathPrefix: string;
  label: {
    upload: string;
    hint: string;
    uploading: string;
    generatingPreview: string;
    protectedBadge: (seconds: number) => string;
    remove: string;
    previewFailed: string;
    retryPreview: string;
    wrongType: string;
    tooLarge: string;
    uploadFailed: string;
  };
}) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFile = useRef<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "trimming">("idle");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [error, setError] = useState("");

  const buildPreviewClip = async (source: File | Blob): Promise<string> => {
    const buffer = await decodeAudioFile(source);
    const blob = trimToPreviewMp3(buffer);
    const clipPath = `${previewPathPrefix}/${crypto.randomUUID()}.mp3`;
    const { error: uploadError } = await supabase.storage.from("uploads").upload(clipPath, blob, {
      upsert: true,
      cacheControl: "3600",
      contentType: "audio/mpeg",
    });
    if (uploadError) throw uploadError;
    return supabase.storage.from("uploads").getPublicUrl(clipPath).data.publicUrl;
  };

  const handleFile = async (file: File) => {
    setError("");
    setPreviewFailed(false);

    if (!file.type.startsWith("audio/")) {
      setError(label.wrongType);
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError(label.tooLarge);
      return;
    }

    lastFile.current = file;
    setStatus("uploading");
    try {
      const ext = file.name.split(".").pop() || "mp3";
      const path = `${pathPrefix}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("protected-audio").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      setStatus("trimming");
      try {
        const clipUrl = await buildPreviewClip(file);
        onChange({ protected_audio_path: path, preview_audio_url: clipUrl });
      } catch {
        // The full track is safely uploaded either way — only the
        // automatic preview step failed, and that's retryable on its own
        // without asking the artist to re-upload the whole song.
        setPreviewFailed(true);
        onChange({ protected_audio_path: path, preview_audio_url: "" });
      }
    } catch {
      setError(label.uploadFailed);
    } finally {
      setStatus("idle");
    }
  };

  const retryPreview = async () => {
    if (!protectedPath) return;
    setError("");
    setStatus("trimming");
    try {
      let source: File | Blob | null = lastFile.current;
      if (!source) {
        // Page was reloaded since the upload — re-fetch the artist's own
        // file via the same owner-only signed-URL access the manual
        // "Preview" button used to use.
        const { data, error: signError } = await supabase.storage.from("protected-audio").createSignedUrl(protectedPath, 300);
        if (signError || !data) throw signError || new Error("no signed url");
        const res = await fetch(data.signedUrl);
        if (!res.ok) throw new Error("download failed");
        source = await res.blob();
      }
      const clipUrl = await buildPreviewClip(source);
      setPreviewFailed(false);
      onChange({ protected_audio_path: protectedPath, preview_audio_url: clipUrl });
    } catch {
      setError(label.previewFailed);
    } finally {
      setStatus("idle");
    }
  };

  const remove = () => {
    lastFile.current = null;
    setPreviewFailed(false);
    onChange({ protected_audio_path: "", preview_audio_url: "" });
  };

  return (
    <div className="flex flex-col gap-1.5">
      {protectedPath ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-ringo-text">
              <Lock size={12} className="text-ringo-indigo" />
              {label.protectedBadge(MAX_PREVIEW_SECONDS)}
            </span>
            <button
              type="button"
              onClick={remove}
              aria-label={label.remove}
              className="ml-auto shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:text-red-500 hover:bg-red-500/10 transition"
            >
              <X size={14} />
            </button>
          </div>

          {status === "trimming" ? (
            <p className="flex items-center gap-1.5 text-xs text-ringo-muted">
              <Loader2 size={12} className="animate-spin" /> {label.generatingPreview}
            </p>
          ) : previewUrl ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio src={previewUrl} controls className="h-9 w-full" />
          ) : previewFailed ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-ringo-coral">{label.previewFailed}</p>
              <button
                type="button"
                onClick={retryPreview}
                className="shrink-0 flex items-center gap-1 text-xs font-medium text-ringo-indigo"
              >
                <RefreshCw size={11} /> {label.retryPreview}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={status !== "idle"}
          className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-card border border-dashed border-ringo-border text-ringo-muted hover:border-ringo-indigo hover:text-ringo-indigo transition disabled:opacity-60"
        >
          {status !== "idle" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Lock size={13} />
          )}
          {status === "uploading" ? label.uploading : status === "trimming" ? label.generatingPreview : label.upload}
        </button>
      )}

      {!protectedPath && <p className="text-xs text-ringo-muted">{label.hint}</p>}
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
