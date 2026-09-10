"use client";

import { useRef, useState } from "react";
import { Loader2, Scissors, Check, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAndDecodeAudio, trimToMp3 } from "@/lib/audioTrim";

export const MAX_PREVIEW_SECONDS = 30;

function formatTime(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Replaces a separate "upload a 10-second preview file" step: the artist
// already uploaded the one full track (see ProtectedAudioUploadField,
// `protectedPath` here) — this lets them play it back (via a signed URL
// only they, as the owner, can request) and mark a start/end point on it,
// capped at MAX_PREVIEW_SECONDS. "Save" then trims and re-encodes just
// that window client-side (see ../../lib/audioTrim.ts) and uploads the
// small result as the public preview — nothing about the full file is
// ever exposed publicly.
export default function PreviewTrimField({
  protectedPath,
  value,
  onChange,
  pathPrefix,
  label,
}: {
  protectedPath?: string | null;
  value?: string | null;
  onChange: (url: string) => void;
  pathPrefix: string;
  label: {
    setPreview: string;
    change: string;
    remove: string;
    markStart: string;
    markEnd: string;
    selection: (start: string, end: string, seconds: number) => string;
    noSelection: string;
    save: string;
    saving: string;
    uploadFirst: string;
    loadFailed: string;
    trimFailed: string;
  };
}) {
  const supabase = createClient();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadForTrimming = async () => {
    if (!protectedPath) return;
    setError("");
    setLoading(true);
    setStart(null);
    setEnd(null);
    // Same "owner reading their own uploaded path via a signed URL" access
    // pattern as ProtectedAudioUploadField's own preview button — 10
    // minutes is plenty to scrub through and mark a window.
    const { data, error: signError } = await supabase.storage.from("protected-audio").createSignedUrl(protectedPath, 600);
    setLoading(false);
    if (signError || !data) {
      setError(label.loadFailed);
      return;
    }
    setSignedUrl(data.signedUrl);
  };

  const markStart = () => {
    if (!audioRef.current) return;
    const t = audioRef.current.currentTime;
    setStart(t);
    if (end != null && (end <= t || end - t > MAX_PREVIEW_SECONDS)) setEnd(null);
  };

  const markEnd = () => {
    if (!audioRef.current || start == null) return;
    const t = audioRef.current.currentTime;
    if (t <= start) return;
    setEnd(Math.min(t, start + MAX_PREVIEW_SECONDS));
  };

  const savePreview = async () => {
    if (!signedUrl || start == null || end == null) return;
    setError("");
    setSaving(true);
    try {
      const buffer = await fetchAndDecodeAudio(signedUrl);
      const blob = trimToMp3(buffer, start, end);
      const path = `${pathPrefix}/${crypto.randomUUID()}.mp3`;
      const { error: uploadError } = await supabase.storage.from("uploads").upload(path, blob, {
        upsert: true,
        cacheControl: "3600",
        contentType: "audio/mpeg",
      });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("uploads").getPublicUrl(path);
      onChange(data.publicUrl);
      setSignedUrl(null);
      setStart(null);
      setEnd(null);
    } catch {
      setError(label.trimFailed);
    } finally {
      setSaving(false);
    }
  };

  if (!protectedPath) {
    return <p className="text-xs text-ringo-muted">{label.uploadFirst}</p>;
  }

  // Already has a saved preview clip, and isn't mid-re-trim.
  if (value && !signedUrl) {
    return (
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio src={value} controls className="h-9 flex-1 min-w-0" />
        <button
          type="button"
          onClick={loadForTrimming}
          disabled={loading}
          className="shrink-0 text-xs font-medium text-ringo-indigo px-2 py-1.5 disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : label.change}
        </button>
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={label.remove}
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:text-red-500 hover:bg-red-500/10 transition"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <button
        type="button"
        onClick={loadForTrimming}
        disabled={loading}
        className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-card border border-dashed border-ringo-border text-ringo-muted hover:border-ringo-indigo hover:text-ringo-indigo transition disabled:opacity-60"
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />}
        {label.setPreview}
      </button>
    );
  }

  const validSelection = start != null && end != null && end > start && end - start <= MAX_PREVIEW_SECONDS;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-ringo-border p-2.5">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={signedUrl} controls className="w-full h-9" />
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={markStart}
          className="text-xs font-medium px-2.5 py-1.5 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo"
        >
          {label.markStart}
        </button>
        <button
          type="button"
          onClick={markEnd}
          disabled={start == null}
          className="text-xs font-medium px-2.5 py-1.5 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo disabled:opacity-40"
        >
          {label.markEnd}
        </button>
        <span className="text-xs text-ringo-muted">
          {start != null && end != null
            ? label.selection(formatTime(start), formatTime(end), Math.round(end - start))
            : label.noSelection}
        </span>
      </div>
      <button
        type="button"
        onClick={savePreview}
        disabled={!validSelection || saving}
        className="self-start flex items-center gap-1.5 text-xs font-semibold text-white bg-ringo-indigo px-3 py-2 rounded-card transition hover:brightness-110 active:scale-[0.97] disabled:opacity-40"
      >
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        {saving ? label.saving : label.save}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
