"use client";

import { useState, useRef } from "react";
import { Reorder, useDragControls, AnimatePresence, motion } from "framer-motion";
import { GripVertical, ChevronDown, Lock } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import ImageUploadField from "./ImageUploadField";
import AudioUploadField from "./AudioUploadField";
import ProtectedAudioUploadField from "./ProtectedAudioUploadField";

export default function TrackRow({
  track,
  userId,
  audioPathPrefix,
  releases,
  onChange,
  onPersist,
  onDelete,
  startExpanded,
}: {
  track: any;
  userId: string;
  audioPathPrefix: string;
  releases: any[];
  onChange: (patch: any) => void;
  onPersist: (patch: any) => void;
  onDelete: () => void;
  startExpanded?: boolean;
}) {
  const { t } = useLanguage();
  const controls = useDragControls();
  const [expanded, setExpanded] = useState(!!startExpanded);
  const titleRef = useRef<HTMLInputElement>(null);
  const isProtected = !!track.protected_audio_path;

  return (
    <Reorder.Item
      value={track}
      dragListener={false}
      dragControls={controls}
      className="border border-ringo-border rounded-card bg-ringo-bg overflow-hidden"
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 28px -8px rgba(0,0,0,0.25)", zIndex: 10 }}
    >
      <div className="flex items-center gap-2 p-2.5">
        <div
          onPointerDown={(e) => controls.start(e)}
          className="touch-none cursor-grab active:cursor-grabbing text-ringo-muted p-1.5 -m-1.5 shrink-0"
          aria-label={t.editor.dragHint}
        >
          <GripVertical size={16} />
        </div>

        <ImageUploadField
          value={track.cover_image_url}
          onChange={(url) => {
            onChange({ cover_image_url: url });
            onPersist({ cover_image_url: url });
          }}
          userId={userId}
          folder="tracks"
          size={38}
          errorText={t.editor.upload}
        />

        <button
          type="button"
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next) setTimeout(() => titleRef.current?.focus(), 150);
          }}
          className="flex-1 min-w-0 text-left"
        >
          <p className="text-sm font-medium text-ringo-text truncate flex items-center gap-1.5">
            {track.title || t.music.untitledTrack}
            {isProtected && <Lock size={11} className="text-ringo-indigo shrink-0" />}
          </p>
          <p className="text-xs text-ringo-muted truncate">{track.duration || ""}</p>
        </button>

        <ChevronDown
          size={16}
          className={`shrink-0 text-ringo-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          onClick={() => setExpanded((v) => !v)}
        />
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-2.5 pb-2.5 pt-1 border-t border-ringo-border flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  ref={titleRef}
                  value={track.title}
                  onChange={(e) => onChange({ title: e.target.value })}
                  onBlur={(e) => onPersist({ title: e.target.value })}
                  placeholder={t.music.trackTitlePlaceholder}
                  className="flex-1 min-w-0 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                />
                <input
                  value={track.duration ?? ""}
                  onChange={(e) => onChange({ duration: e.target.value })}
                  onBlur={(e) => onPersist({ duration: e.target.value })}
                  placeholder={t.music.durationPlaceholder}
                  className="w-28 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                />
              </div>

              <div className="flex gap-2">
                <input
                  value={track.artist_name ?? ""}
                  onChange={(e) => onChange({ artist_name: e.target.value })}
                  onBlur={(e) => onPersist({ artist_name: e.target.value })}
                  placeholder={t.music.artistNamePlaceholder}
                  className="flex-1 min-w-0 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                />
                <input
                  value={track.genre ?? ""}
                  onChange={(e) => onChange({ genre: e.target.value })}
                  onBlur={(e) => onPersist({ genre: e.target.value })}
                  placeholder={t.music.genrePlaceholder}
                  className="w-28 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                />
              </div>

              {releases.length > 0 && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ringo-muted">{t.music.assignToReleaseLabel}</span>
                  <select
                    value={track.release_id || ""}
                    onChange={(e) => {
                      const value = e.target.value || null;
                      onChange({ release_id: value });
                      onPersist({ release_id: value });
                    }}
                    className="text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                  >
                    <option value="">{t.music.standaloneSingle}</option>
                    {releases.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title || t.music.untitledRelease} ({r.release_type})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {!track.release_id && (
                <>
                  <div>
                    <p className="text-xs text-ringo-muted mb-1">{t.music.uploadAudio}</p>
                    <AudioUploadField
                      value={track.audio_url}
                      onChange={(url) => {
                        onChange({ audio_url: url });
                        onPersist({ audio_url: url });
                      }}
                      pathPrefix={audioPathPrefix}
                      label={{ upload: t.music.uploadAudio, replace: t.music.replaceAudio, remove: t.music.removeAudio }}
                    />
                  </div>

                  <div>
                    <p className="text-xs text-ringo-muted mb-1">{t.music.orExternalLink}</p>
                    <input
                      value={track.external_url ?? ""}
                      onChange={(e) => onChange({ external_url: e.target.value })}
                      onBlur={(e) => onPersist({ external_url: e.target.value })}
                      placeholder={t.music.externalLinkPlaceholder}
                      inputMode="url"
                      className="w-full text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                    />
                  </div>

                  <div className="flex gap-2">
                    <input
                      value={track.price ?? ""}
                      onChange={(e) => onChange({ price: e.target.value })}
                      onBlur={(e) => onPersist({ price: e.target.value })}
                      placeholder={t.editor.price}
                      inputMode="decimal"
                      className="w-24 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                    />
                    <input
                      value={track.buy_url ?? ""}
                      onChange={(e) => onChange({ buy_url: e.target.value })}
                      onBlur={(e) => onPersist({ buy_url: e.target.value })}
                      placeholder={t.music.buyUrlPlaceholder}
                      inputMode="url"
                      className="flex-1 min-w-0 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
                    />
                  </div>

                  <div>
                    <p className="text-xs text-ringo-muted mb-1">{t.music.protectedAudioLabel}</p>
                    <ProtectedAudioUploadField
                      protectedPath={track.protected_audio_path}
                      previewUrl={track.preview_audio_url}
                      onChange={(patch) => {
                        onChange(patch);
                        onPersist(patch);
                      }}
                      pathPrefix={`${userId}/tracks-protected`}
                      previewPathPrefix={`${audioPathPrefix}-preview`}
                      label={{
                        upload: t.music.uploadProtected,
                        hint: t.music.protectedAudioHint,
                        uploading: t.music.uploadingTrack,
                        generatingPreview: t.music.generatingPreview,
                        protectedBadge: t.music.protectedBadgeWithSeconds,
                        remove: t.music.removeAudio,
                        previewFailed: t.music.previewTrimFailed,
                        retryPreview: t.music.previewRetry,
                        wrongType: t.editor.upload.wrongType,
                        tooLarge: t.music.protectedTooLarge,
                        uploadFailed: t.editor.upload.failed,
                      }}
                    />
                  </div>

                  <label className="flex items-center gap-1.5 text-xs text-ringo-text cursor-pointer">
                    <input
                      type="checkbox"
                      checked={track.download_enabled !== false}
                      onChange={(e) => {
                        onChange({ download_enabled: e.target.checked });
                        onPersist({ download_enabled: e.target.checked });
                      }}
                      className="accent-ringo-indigo"
                    />
                    {t.music.downloadEnabledLabel}
                  </label>
                </>
              )}

              <label className="flex items-center gap-1.5 text-xs text-ringo-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={track.available !== false}
                  onChange={(e) => {
                    onChange({ available: e.target.checked });
                    onPersist({ available: e.target.checked });
                  }}
                  className="accent-ringo-indigo"
                />
                {t.restaurant.availableLabel}
              </label>

              <button onClick={onDelete} className="self-start text-xs text-red-500 px-1 py-1">
                {t.editor.delete}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  );
}
