"use client";

import { useState, useRef } from "react";
import { Reorder } from "framer-motion";
import { Music } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { getMusicRole } from "@/lib/categories";
import EditorCard from "./EditorCard";
import TrackRow from "./TrackRow";
import { useEditorPreview } from "./EditorPreviewContext";

// Only ever rendered for a profile tagged Music & Entertainment — see
// Editor.tsx. "Latest Music" / "Latest Beats" — a handful of featured
// tracks, not a streaming catalog (see the migration's comment on the
// tracks table).
export default function TracksCard({
  profileId,
  userId,
  initialTracks,
}: {
  profileId: string;
  userId: string;
  initialTracks: any[];
}) {
  const supabase = createClient();
  const { t, locale } = useLanguage();
  const [tracks, setTracks] = useState([...initialTracks].sort((a, b) => a.sort_order - b.sort_order));
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout>>();
  const { draft, updateDraft } = useEditorPreview();

  // Retitles with the creator's chosen role — "Latest Beats" for a
  // producer, "Latest Mixes" for a DJ, etc. — falling back to the generic
  // "Latest Music" when no role is set yet.
  const title = getMusicRole(draft.music_role)?.sectionLabel[locale] || t.music.tracksTitleFallback;

  const addTrack = async () => {
    const { data } = await supabase
      .from("tracks")
      .insert({ profile_id: profileId, title: "", sort_order: tracks.length })
      .select()
      .single();
    if (data) {
      const next = [...tracks, data];
      setTracks(next);
      updateDraft({ tracks: next });
      setJustAddedId(data.id);
    }
  };

  const updateTrack = (id: string, patch: any) => {
    setTracks((prev) => {
      const next = prev.map((tr) => (tr.id === id ? { ...tr, ...patch } : tr));
      updateDraft({ tracks: next });
      return next;
    });
  };

  const persistTrack = async (id: string, patch: any) => {
    await supabase.from("tracks").update(patch).eq("id", id);
  };

  const deleteTrack = async (id: string) => {
    setTracks((prev) => {
      const next = prev.filter((tr) => tr.id !== id);
      updateDraft({ tracks: next });
      return next;
    });
    await supabase.from("tracks").delete().eq("id", id);
  };

  const handleReorder = (newOrder: any[]) => {
    const reindexed = newOrder.map((tr, i) => ({ ...tr, sort_order: i }));
    setTracks(reindexed);
    updateDraft({ tracks: reindexed });
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      Promise.all(reindexed.map((tr) => supabase.from("tracks").update({ sort_order: tr.sort_order }).eq("id", tr.id)));
    }, 400);
  };

  return (
    <EditorCard
      icon={Music}
      title={title}
      action={
        <button onClick={addTrack} className="text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white whitespace-nowrap">
          {t.music.addTrack}
        </button>
      }
    >
      <p className="text-xs text-ringo-muted -mt-2 mb-3">{t.music.tracksHint}</p>

      {tracks.length === 0 && <p className="text-sm text-ringo-muted">{t.music.noTracksYet}</p>}

      <Reorder.Group axis="y" values={tracks} onReorder={handleReorder} className="flex flex-col gap-2">
        {tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            userId={userId}
            audioPathPrefix={`${userId}/tracks-audio`}
            startExpanded={track.id === justAddedId}
            onChange={(patch) => updateTrack(track.id, patch)}
            onPersist={(patch) => persistTrack(track.id, patch)}
            onDelete={() => deleteTrack(track.id)}
          />
        ))}
      </Reorder.Group>
    </EditorCard>
  );
}
