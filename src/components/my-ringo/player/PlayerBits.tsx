/* eslint-disable @next/next/no-img-element */
import { Music } from "lucide-react";

export function formatTime(seconds: number) {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Cover art with a tasteful fallback — shared by the mini-player, the full
// player and the queue.
export function Cover({ url, className }: { url: string | null; className: string }) {
  if (url) return <img src={url} alt="" className={`${className} object-cover bg-ringo-muted/10`} />;
  return (
    <span className={`${className} flex items-center justify-center bg-gradient-to-br from-ringo-indigo/25 to-ringo-indigo/5 text-ringo-indigo`}>
      <Music className="h-1/3 w-1/3" />
    </span>
  );
}

export function formatBytes(bytes: number) {
  if (!isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
