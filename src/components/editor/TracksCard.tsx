"use client";

import { useState } from "react";
import { Reorder } from "framer-motion";
import { Music } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getMusicRole } from "@/lib/categories";
import EditorCard from "./EditorCard";
import TrackRow from "./TrackRow";
import { useEditorPreview } from "./EditorPreviewContext";
import { useAutosavedRows } from "./useAutosavedRows";
import { isBlankTrack } from "./musicBlank";

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
  const { t, locale } = useLanguage();
  // add / remove / reorder / blur-saves all go through the section's auto-save engine (see
  // useAutosavedRows): failures are reported and rolled back or kept for a retry, never silent.
  const { rows: tracks, update: updateTrack, persist: persistTrack, add, remove: deleteTrack, reorder: handleReorder } = useAutosavedRows<any>("tracks", "tracks", initialTracks, {
    // a track added and never given ANY content (see musicBlank.ts) is removed when this section closes
    isBlank: isBlankTrack,
  });
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const { draft } = useEditorPreview();

  // Retitles with the creator's chosen role — "Latest Beats" for a
  // producer, "Latest Mixes" for a DJ, etc. — falling back to the generic
  // "Latest Music" when no role is set yet.
  const title = getMusicRole(draft.music_role)?.sectionLabel[locale] || t.music.tracksTitleFallback;

  const addTrack = async () => {
    const created = await add({ profile_id: profileId, title: "", sort_order: tracks.length });
    if (created) setJustAddedId(created.id);
  };

  return (
    <EditorCard
      icon={Music}
      title={title}
      // data-tour target for the onboarding tour's Music-branch step
      // (src/lib/onboardingTour.ts) — plain attribute, additive only.
      action={
        <button type="button" data-tour="add-track" onClick={addTrack} className="text-xs px-3 py-2.5 min-h-[44px] rounded-card bg-ringo-indigo text-white whitespace-nowrap transition hover:brightness-110 active:scale-[0.97]">
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
            releases={draft.music_releases || []}
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
