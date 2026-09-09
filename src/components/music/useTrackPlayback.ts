"use client";

import { useEffect, useRef, useState } from "react";

// Shared by MusicSection and PinnedSpotlight, both of which can show a
// track's Play button — lifted up to ProfileView so only one instance of
// this hook (and therefore one real <audio> element) exists per page,
// meaning pinning a track that's also in the Latest Music list can never
// end up playing two overlapping copies of itself.
export function useTrackPlayback() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const togglePlay = (track: any) => {
    if (!track.audio_url) {
      if (track.external_url) window.open(track.external_url, "_blank", "noopener,noreferrer");
      return;
    }
    if (playingId === track.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = track.audio_url;
    audioRef.current.onended = () => setPlayingId(null);
    audioRef.current.play().catch(() => setPlayingId(null));
    setPlayingId(track.id);
  };

  return { playingId, togglePlay };
}
