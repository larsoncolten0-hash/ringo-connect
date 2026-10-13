"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Download, FileText, Mic, Music, Pause, Play, RotateCw } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { messageMediaUrl } from "@/lib/inbox/client";
import { clampRatio, formatDuration, isVoiceNote, shortType } from "@/lib/inbox/mediaView";
import type { MediaKind } from "@/lib/inbox/format";
import ImageLightbox from "./ImageLightbox";

// The media of ONE message, shown inside the conversation: images (with a full-screen viewer), voice notes and audio (a small player), videos (the browser's own player) and
// documents (a card with a download action). Every file is served by Ringo's own authenticated route (see the GET route under /media/<message id>): this component never sees a
// Meta url, a media id or a token, and an unavailable or expired file becomes a calm message with a retry, never a broken box.
//   * every frame has a RESERVED shape before anything loads, so media arriving late does not push the conversation around
//   * audio and video fetch their metadata only when they scroll into view; only one of them plays at a time
//   * no object urls are created here (the browser streams straight from the route), so there is nothing to revoke

type Props = {
  conversationId: string;
  messageId: string;
  media: MediaKind;
  mimeType: string | null;
  filename: string | null;
  caption: string | null;
  /** false when the file cannot exist yet (an outbound message still sending or failed): a plain note is shown instead of a request that would fail. */
  available: boolean;
  /** shown under the card when it is not available */
  unavailableNote: string | null;
};

type Problem = "expired" | "unavailable";

/** Asks the route about a file that failed to load, so the message can say WHY (no longer available vs. a temporary problem). */
async function probe(src: string): Promise<Problem> {
  try {
    const res = await fetch(src, { method: "HEAD", credentials: "same-origin" });
    return res.status === 410 || res.status === 404 ? "expired" : "unavailable";
  } catch {
    return "unavailable";
  }
}

function useInView<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") return setSeen(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && (setSeen(true), io.disconnect()), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

// Only one audio / video plays at a time: starting one pauses the others.
const PLAY_EVENT = "ringo-inbox-media-play";
function announcePlay(el: HTMLMediaElement) {
  window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: el }));
}
function usePauseOthers(el: React.RefObject<HTMLMediaElement>) {
  useEffect(() => {
    const on = (e: Event) => {
      const other = (e as CustomEvent).detail as HTMLMediaElement | undefined;
      if (el.current && other && other !== el.current && !el.current.paused) el.current.pause();
    };
    window.addEventListener(PLAY_EVENT, on);
    return () => window.removeEventListener(PLAY_EVENT, on);
  }, [el]);
}

function ProblemBox({ problem, onRetry, downloadHref, className = "" }: { problem: Problem; onRetry: () => void; downloadHref?: string; className?: string }) {
  const { t } = useLanguage();
  const u = t.inbox;
  return (
    <div role="status" className={`flex flex-col items-start gap-1.5 rounded-xl border border-ringo-border/70 bg-ringo-muted/10 p-3 text-xs text-ringo-muted ${className}`} data-media-problem={problem}>
      <span className="inline-flex items-center gap-1.5 text-ringo-text"><AlertCircle size={14} aria-hidden="true" />{problem === "expired" ? u.mediaExpired : u.mediaUnavailable}</span>
      <span className="flex items-center gap-3">
        {problem === "unavailable" && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-medium text-ringo-indigo hover:underline"><RotateCw size={12} aria-hidden="true" />{u.mediaRetry}</button>}
        {downloadHref && problem === "unavailable" && <a href={downloadHref} download className="inline-flex items-center gap-1 font-medium text-ringo-indigo hover:underline"><Download size={12} aria-hidden="true" />{u.mediaDownload}</a>}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------------ image
function ImageMedia({ p, alt }: { p: Props; alt: string }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState<Problem>("unavailable");
  const [ratio, setRatio] = useState(4 / 3);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const src = messageMediaUrl(p.conversationId, p.messageId) + (attempt ? `${"?"}r=${attempt}` : "");
  const sticker = p.media === "sticker";
  const [ref, inView] = useInView<HTMLButtonElement>();

  if (state === "error") {
    return <ProblemBox problem={problem} onRetry={() => { setState("loading"); setAttempt((n) => n + 1); }} downloadHref={messageMediaUrl(p.conversationId, p.messageId, true)} />;
  }
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => state === "ready" && setOpen(true)}
        aria-label={u.openImage}
        disabled={state !== "ready"}
        className="relative block overflow-hidden rounded-xl bg-ringo-muted/15 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ringo-indigo"
        style={{ aspectRatio: sticker ? "1 / 1" : String(ratio), width: sticker ? "8rem" : "min(100%, 18rem)", maxHeight: sticker ? undefined : "20rem" }}
        data-media-frame="image"
      >
        {state === "loading" && <span className="absolute inset-0 animate-pulse bg-ringo-muted/20 motion-reduce:animate-none" aria-hidden="true" />}
        {(inView || attempt > 0) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (!sticker) setRatio(clampRatio(img.naturalWidth, img.naturalHeight, 0.6, 1.8, 4 / 3));
              setState("ready");
            }}
            onError={() => {
              setState("error");
              void probe(src).then(setProblem);
            }}
            className={`h-full w-full ${sticker ? "object-contain" : "object-cover"} transition-opacity ${state === "ready" ? "opacity-100" : "opacity-0"}`}
          />
        )}
      </button>
      {open && <ImageLightbox src={src} downloadHref={messageMediaUrl(p.conversationId, p.messageId, true)} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

// ------------------------------------------------------------------------------------------------------------------------ audio / voice note
function AudioMedia({ p }: { p: Props }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const voice = isVoiceNote("audio", p.mimeType);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [wrap, inView] = useInView<HTMLDivElement>();
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [attempt, setAttempt] = useState(0);
  const src = messageMediaUrl(p.conversationId, p.messageId) + (attempt ? `${"?"}r=${attempt}` : "");
  usePauseOthers(audio as React.RefObject<HTMLMediaElement>);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      setLoading(true);
      announcePlay(el);
      void el.play().catch(() => {
        setLoading(false);
        setPlaying(false);
      });
    } else el.pause();
  }, []);

  if (problem) {
    return <ProblemBox problem={problem} onRetry={() => { setProblem(null); setAttempt((n) => n + 1); }} downloadHref={messageMediaUrl(p.conversationId, p.messageId, true)} />;
  }
  const known = duration !== null && Number.isFinite(duration) && duration > 0;
  const Icon = voice ? Mic : Music;
  return (
    <div ref={wrap} className="flex w-[min(100%,17rem)] flex-col gap-1" data-media-kind="audio" data-voice-note={voice ? "true" : undefined}>
      <div className="flex items-center gap-2.5 rounded-xl border border-ringo-border/70 bg-ringo-muted/10 p-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? u.audioPause : u.audioPlay}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ringo-indigo text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-indigo"
        >
          {loading && !playing ? <RotateCw size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} className="translate-x-px" aria-hidden="true" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] text-ringo-muted">
            <Icon size={12} aria-hidden="true" />
            <span className="truncate">{voice ? u.voiceNote : p.filename || u.audioFile}</span>
          </div>
          <input
            type="range"
            min={0}
            max={known ? Math.floor(duration as number) : 1}
            step={1}
            value={known ? Math.min(Math.floor(time), Math.floor(duration as number)) : 0}
            disabled={!known}
            onChange={(e) => {
              const el = audio.current;
              if (el) el.currentTime = Number(e.target.value);
              setTime(Number(e.target.value));
            }}
            aria-label={u.audioSeek}
            aria-valuetext={`${formatDuration(time)} / ${formatDuration(duration)}`}
            className="mt-1 block h-1.5 w-full cursor-pointer accent-ringo-indigo disabled:cursor-default"
          />
          <p className="mt-0.5 text-[10px] tabular-nums text-ringo-muted">{formatDuration(time)} / {formatDuration(duration)}</p>
        </div>
      </div>
      <audio
        ref={audio}
        src={src}
        preload={inView ? "metadata" : "none"}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlaying={() => { setPlaying(true); setLoading(false); }}
        onPause={() => setPlaying(false)}
        onWaiting={() => setLoading(true)}
        onCanPlay={() => setLoading(false)}
        onEnded={() => { setPlaying(false); setTime(0); }}
        onError={() => {
          setLoading(false);
          setPlaying(false);
          void probe(src).then(setProblem);
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------------ video
function VideoMedia({ p }: { p: Props }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const video = useRef<HTMLVideoElement | null>(null);
  const [frame, inView] = useInView<HTMLDivElement>();
  const [ratio, setRatio] = useState(16 / 9);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [attempt, setAttempt] = useState(0);
  const base = messageMediaUrl(p.conversationId, p.messageId) + (attempt ? `${"?"}r=${attempt}` : "");
  usePauseOthers(video as React.RefObject<HTMLMediaElement>);

  if (problem) {
    return <ProblemBox problem={problem} onRetry={() => { setProblem(null); setReady(false); setAttempt((n) => n + 1); }} downloadHref={messageMediaUrl(p.conversationId, p.messageId, true)} />;
  }
  return (
    <div
      ref={frame}
      className="relative overflow-hidden rounded-xl bg-black"
      style={{ aspectRatio: String(ratio), width: "min(100%, 20rem)", maxHeight: "22rem" }}
      data-media-frame="video"
    >
      {!ready && <span className="absolute inset-0 animate-pulse bg-ringo-muted/30 motion-reduce:animate-none" aria-hidden="true" />}
      {(inView || attempt > 0) && (
        <video
          ref={video}
          // #t=0.001 makes browsers paint the first frame as the preview without downloading the whole file
          src={`${base}#t=0.001`}
          controls
          playsInline
          preload="metadata"
          aria-label={p.caption || p.filename || u.mediaKinds.video}
          className="h-full w-full object-contain"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            setRatio(clampRatio(v.videoWidth, v.videoHeight, 0.56, 1.8, 16 / 9));
            setReady(true);
          }}
          onPlay={(e) => announcePlay(e.currentTarget)}
          onError={() => void probe(base).then(setProblem)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------------ document / anything else
function FileCard({ p }: { p: Props }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const [problem, setProblem] = useState<Problem | null>(null);
  const [checking, setChecking] = useState(false);
  const href = messageMediaUrl(p.conversationId, p.messageId, true);
  const type = shortType(p.mimeType);

  async function download() {
    if (checking) return;
    setChecking(true);
    setProblem(null);
    // one HEAD request tells whether the file is still there; only then is the download started
    try {
      const res = await fetch(href, { method: "HEAD", credentials: "same-origin" });
      setChecking(false);
      if (!res.ok) return setProblem(res.status === 410 || res.status === 404 ? "expired" : "unavailable");
    } catch {
      setChecking(false);
      return setProblem("unavailable");
    }
    const a = document.createElement("a");
    a.href = href;
    a.download = p.filename || "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="flex w-[min(100%,18rem)] flex-col gap-1.5" data-media-kind={p.media}>
      <div className="flex items-center gap-2.5 rounded-xl border border-ringo-border/70 bg-ringo-muted/10 p-2.5">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ringo-indigo/10 text-ringo-indigo"><FileText size={18} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="break-all text-xs font-medium">{p.filename || u.mediaKinds.document}</p>
          {type && <p className="text-[10px] uppercase tracking-wide text-ringo-muted">{type}</p>}
        </div>
        <button
          type="button"
          onClick={() => void download()}
          disabled={checking}
          aria-label={`${u.mediaDownload}${p.filename ? `: ${p.filename}` : ""}`}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ringo-border text-ringo-muted transition-colors hover:bg-ringo-surface hover:text-ringo-text disabled:opacity-60"
        >
          <Download size={16} aria-hidden="true" />
        </button>
      </div>
      {problem && <ProblemBox problem={problem} onRetry={() => void download()} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------------------------------ the entry point
export default function MessageMedia(p: Props) {
  const { t } = useLanguage();
  const u = t.inbox;
  if (!p.available) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-ringo-border/70 bg-ringo-muted/10 p-2.5" data-media-kind={p.media}>
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ringo-indigo/10 text-ringo-indigo"><FileText size={18} aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-xs font-medium">{u.mediaKinds[p.media]}</p>
          {p.filename && <p className="break-all text-[11px] text-ringo-muted">{p.filename}</p>}
          {p.unavailableNote && <p className="text-[11px] italic text-ringo-muted">{p.unavailableNote}</p>}
        </div>
      </div>
    );
  }
  const alt = p.caption || p.filename || u.mediaKinds[p.media];
  switch (p.media) {
    case "image":
    case "sticker":
      return <ImageMedia p={p} alt={alt} />;
    case "audio":
      return <AudioMedia p={p} />;
    case "video":
      return <VideoMedia p={p} />;
    default:
      return <FileCard p={p} />;
  }
}
