"use client";

import { useEffect, useRef, useState } from "react";

// Shared by MusicSection and PinnedSpotlight, both of which can show a
// track's Play button — lifted up to ProfileView so only one instance of
// this hook (and therefore one real <audio> element) exists per page,
// meaning pinning a track that's also in the Latest Music list can never
// end up playing two overlapping copies of itself.
//
// `progress` (0–1) tracks the currently playing track's real position via
// the audio element's own timeupdate event — not a decorative/static bar,
// an actual "how far into this song are we" readout.
export function useTrackPlayback() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const togglePlay = (track: any) => {
    // A track with a protected_audio_path is a real purchase item — the
    // full file is never public, so playback here can only ever be the
    // short preview clip, regardless of whatever legacy audio_url the
    // track might also carry. This is the same rule the server route
    // enforces; this is just the player respecting it, not the boundary
    // itself.
    const isProtected = !!track.protected_audio_path;
    const src = isProtected ? track.preview_audio_url : track.audio_url;
    if (!src) {
      if (!isProtected && track.external_url) window.open(track.external_url, "_blank", "noopener,noreferrer");
      return;
    }
    if (playingId === track.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    audio.src = src;
    setProgress(0);
    audio.ontimeupdate = () => {
      setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    };
    audio.onended = () => {
      setPlayingId(null);
      setProgress(0);
    };
    audio.play().catch(() => setPlayingId(null));
    setPlayingId(track.id);
  };

  return { playingId, progress, togglePlay };
}
