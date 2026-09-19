"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { LibraryTrack } from "@/lib/customer/activity";
import { createPlayerEngine, type PlayerEngine, type PlayerSnapshot, type RepeatMode, type TimeSnapshot } from "./playerEngine";
import MiniPlayer from "./MiniPlayer";
import FullPlayer from "./FullPlayer";

// Mounted ONCE in the My Ringo layout, above every page, so the same audio
// element (and queue) survives navigating between Home / Connections /
// Activity / Me. It stops when the customer leaves My Ringo altogether or
// signs out. The interface is split across two contexts so the 4x-per-second
// time updates only re-render the player bars, not every page using the
// controls.

const EMPTY: PlayerSnapshot = {
  current: null,
  queue: [],
  order: [],
  pos: -1,
  playing: false,
  loading: false,
  error: false,
  shuffle: false,
  repeat: "off",
  volume: 1,
};

export type PlayerApi = PlayerSnapshot & {
  expanded: boolean;
  setExpanded: (open: boolean) => void;
  playQueue: (tracks: LibraryTrack[], startIndex: number, opts?: { shuffle?: boolean }) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  jumpToPos: (pos: number) => void;
  seek: (seconds: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setVolume: (v: number) => void;
};

const PlayerContext = createContext<PlayerApi | null>(null);
const TimeContext = createContext<TimeSnapshot>({ currentTime: 0, duration: 0 });

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside MusicPlayerProvider");
  return ctx;
}

export function usePlayerTime(): TimeSnapshot {
  return useContext(TimeContext);
}

export type { RepeatMode };

export default function MusicPlayerProvider({ children }: { children: React.ReactNode }) {
  const engineRef = useRef<PlayerEngine | null>(null);
  const [snap, setSnap] = useState<PlayerSnapshot>(EMPTY);
  const [time, setTime] = useState<TimeSnapshot>({ currentTime: 0, duration: 0 });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const engine: PlayerEngine = createPlayerEngine(
      () => setSnap(engine.snapshot()),
      () => setTime(engine.time())
    );
    engineRef.current = engine;
    setSnap(engine.snapshot());
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Stable command wrappers (the engine itself lives in a ref).
  const commands = useMemo(
    () => ({
      playQueue: (tracks: LibraryTrack[], startIndex: number, opts?: { shuffle?: boolean }) =>
        engineRef.current?.playQueue(tracks, startIndex, opts),
      toggle: () => engineRef.current?.toggle(),
      next: () => engineRef.current?.next(),
      prev: () => engineRef.current?.prev(),
      jumpToPos: (pos: number) => engineRef.current?.jumpToPos(pos),
      seek: (seconds: number) => engineRef.current?.seek(seconds),
      toggleShuffle: () => engineRef.current?.toggleShuffle(),
      cycleRepeat: () => engineRef.current?.cycleRepeat(),
      setVolume: (v: number) => engineRef.current?.setVolume(v),
    }),
    []
  );

  const value = useMemo<PlayerApi>(() => ({ ...snap, ...commands, expanded, setExpanded }), [snap, commands, expanded]);

  // A full-screen player with nothing loaded makes no sense.
  useEffect(() => {
    if (!snap.current) setExpanded(false);
  }, [snap.current]);

  return (
    <PlayerContext.Provider value={value}>
      <TimeContext.Provider value={time}>
        {children}
        {snap.current && <MiniPlayer />}
        <AnimatePresence>{expanded && snap.current && <FullPlayer key="full-player" />}</AnimatePresence>
      </TimeContext.Provider>
    </PlayerContext.Provider>
  );
}
