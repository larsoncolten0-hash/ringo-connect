"use client";

import { useState } from "react";
import { Disc3, ChevronDown, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import EditorCard from "./EditorCard";
import ImageUploadField from "./ImageUploadField";
import { useEditorPreview } from "./EditorPreviewContext";

// Only ever rendered for a profile tagged Music & Entertainment. A
// release (EP or Album) is a bundle sold as one unit — tracks assigned to
// a release (see TracksCard's release picker) stop being individually
// purchasable and are unlocked together when the release is bought.
export default function MusicReleasesCard({
  profileId,
  userId,
  initialReleases,
}: {
  profileId: string;
  userId: string;
  initialReleases: any[];
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [releases, setReleases] = useState([...initialReleases].sort((a, b) => a.sort_order - b.sort_order));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { draft, updateDraft } = useEditorPreview();

  const syncDraft = (next: any[]) => updateDraft({ music_releases: next });

  const addRelease = async (releaseType: "ep" | "album") => {
    const { data } = await supabase
      .from("music_releases")
      .insert({ profile_id: profileId, title: "", release_type: releaseType, price: 0, sort_order: releases.length })
      .select()
      .single();
    if (data) {
      const next = [...releases, data];
      setReleases(next);
      syncDraft(next);
      setExpandedId(data.id);
    }
  };

  const changeRelease = (id: string, patch: any) => {
    const next = releases.map((r) => (r.id === id ? { ...r, ...patch } : r));
    setReleases(next);
    syncDraft(next);
  };

  const persistRelease = async (id: string, patch: any) => {
    await supabase.from("music_releases").update(patch).eq("id", id);
  };

  const deleteRelease = async (id: string) => {
    const trackCount = (draft.tracks || []).filter((tr: any) => tr.release_id === id).length;
    if (trackCount > 0 && !window.confirm(`Delete this release? Its ${trackCount} track(s) will become standalone singles again.`)) return;
    const next = releases.filter((r) => r.id !== id);
    setReleases(next);
    syncDraft(next);
    await supabase.from("music_releases").delete().eq("id", id);
  };

  const tracksInRelease = (releaseId: string) => (draft.tracks || []).filter((tr: any) => tr.release_id === releaseId);

  return (
    <EditorCard
      icon={Disc3}
      title={t.music.releasesTitle}
      action={
        <div className="flex gap-1.5">
          <button onClick={() => addRelease("ep")} className="text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white whitespace-nowrap transition hover:brightness-110 active:scale-[0.97]">
            {t.music.addEp}
          </button>
          <button onClick={() => addRelease("album")} className="text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-text whitespace-nowrap">
            {t.music.addAlbum}
          </button>
        </div>
      }
    >
      <p className="text-xs text-ringo-muted -mt-2 mb-3">{t.music.releasesHint}</p>

      {releases.length === 0 && <p className="text-sm text-ringo-muted">{t.music.noReleasesYet}</p>}

      <div className="flex flex-col gap-2">
        {releases.map((release) => {
          const expanded = expandedId === release.id;
          const tracks = tracksInRelease(release.id);
          return (
            <div key={release.id} className="border border-ringo-border rounded-card bg-ringo-bg overflow-hidden">
              <div className="flex items-center gap-2 p-2.5">
                <ImageUploadField
                  value={release.cover_image_url}
                  onChange={(url) => {
                    changeRelease(release.id, { cover_image_url: url });
                    persistRelease(release.id, { cover_image_url: url });
                  }}
                  userId={userId}
                  folder="releases"
                  size={38}
                  errorText={t.editor.upload}
                />
                <button onClick={() => setExpandedId(expanded ? null : release.id)} className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium text-ringo-text truncate">
                    {release.title || t.music.untitledRelease} <span className="text-xs text-ringo-muted uppercase">· {release.release_type}</span>
                  </p>
                  <p className="text-xs text-ringo-muted truncate">{tracks.length} {t.music.tracksCount}</p>
                </button>
                <ChevronDown size={16} className={`shrink-0 text-ringo-muted transition-transform ${expanded ? "rotate-180" : ""}`} onClick={() => setExpandedId(expanded ? null : release.id)} />
                <button onClick={() => deleteRelease(release.id)} className="shrink-0 text-ringo-muted hover:text-red-500 p-1">
                  <X size={14} />
                </button>
              </div>

              {expanded && (
                <div className="px-2.5 pb-2.5 pt-1 border-t border-ringo-border flex flex-col gap-2">
                  <input
                    value={release.title}
                    onChange={(e) => changeRelease(release.id, { title: e.target.value })}
                    onBlur={(e) => persistRelease(release.id, { title: e.target.value })}
                    placeholder={t.music.releaseTitlePlaceholder}
                    className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                  />
                  <textarea
                    value={release.description ?? ""}
                    onChange={(e) => changeRelease(release.id, { description: e.target.value })}
                    onBlur={(e) => persistRelease(release.id, { description: e.target.value })}
                    placeholder={t.restaurant.itemDescriptionPlaceholder}
                    rows={2}
                    className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text resize-none"
                  />
                  <div className="flex gap-2 items-center">
                    <input
                      value={release.price ?? ""}
                      onChange={(e) => changeRelease(release.id, { price: e.target.value.replace(/[^0-9.]/g, "") })}
                      onBlur={(e) => persistRelease(release.id, { price: Number(e.target.value) || 0 })}
                      placeholder={t.restaurant.itemPricePlaceholder}
                      inputMode="decimal"
                      className="w-28 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-ringo-text cursor-pointer">
                      <input
                        type="checkbox"
                        checked={release.available !== false}
                        onChange={(e) => {
                          changeRelease(release.id, { available: e.target.checked });
                          persistRelease(release.id, { available: e.target.checked });
                        }}
                        className="accent-ringo-indigo"
                      />
                      {t.restaurant.availableLabel}
                    </label>
                  </div>
                  <p className="text-xs text-ringo-muted">
                    {t.music.releaseTracksHint}
                  </p>
                  {tracks.length === 0 ? (
                    <p className="text-xs text-ringo-muted">{t.music.noTracksInRelease}</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {tracks.map((tr: any) => (
                        <li key={tr.id} className="text-xs text-ringo-text">
                          {tr.title || t.restaurant.untitledItem}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </EditorCard>
  );
}
