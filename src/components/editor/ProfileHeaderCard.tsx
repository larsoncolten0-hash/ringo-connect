"use client";

import { useState } from "react";
import { User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import EditorCard from "./EditorCard";
import ImageUploadField from "./ImageUploadField";
import AvatarCropperField from "./AvatarCropperField";
import SavedPulse, { useSavedPulse } from "./SavedPulse";
import { useEditorPreview } from "./EditorPreviewContext";

export default function ProfileHeaderCard({
  profileId,
  userId,
  initialAvatarUrl,
  initialCoverUrl,
  initialName,
  initialBio,
  initialIcon192Url,
  initialIcon512Url,
  initialIconMaskable512Url,
}: {
  profileId: string;
  userId: string;
  initialAvatarUrl: string | null;
  initialCoverUrl: string | null;
  initialName: string | null;
  initialBio: string | null;
  // Fan-facing profile PWA icon derivatives (see
  // /api/profile/avatar-icons and 2026-10-09_profile_pwa_icons.sql) —
  // preloaded so an unrelated Save (editing just name/bio, say) doesn't
  // blank out already-generated icons for an avatar that hasn't changed.
  initialIcon192Url?: string | null;
  initialIcon512Url?: string | null;
  initialIconMaskable512Url?: string | null;
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl || "");
  const [coverUrl, setCoverUrl] = useState(initialCoverUrl || "");
  const [name, setName] = useState(initialName || "");
  const [bio, setBio] = useState(initialBio || "");
  const [icon192Url, setIcon192Url] = useState(initialIcon192Url || "");
  const [icon512Url, setIcon512Url] = useState(initialIcon512Url || "");
  const [iconMaskable512Url, setIconMaskable512Url] = useState(initialIconMaskable512Url || "");
  const [generatingIcons, setGeneratingIcons] = useState(false);
  const pulse = useSavedPulse();
  const { updateDraft } = useEditorPreview();

  // Fires right after ImageUploadField's own direct-to-storage upload
  // completes — generates the three PWA icon derivatives server-side
  // (sharp can't run in the browser) and stages their URLs alongside
  // avatarUrl, so they all commit together on the next explicit Save.
  // Best-effort: a failure here just leaves the previous (or no)
  // derivatives in place — the manifest route already falls back to the
  // raw avatar_url, then the platform's generic icons, so a fan can still
  // install the profile either way.
  const generateAvatarIcons = async (newAvatarUrl: string) => {
    setGeneratingIcons(true);
    try {
      const res = await fetch("/api/profile/avatar-icons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: newAvatarUrl }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setIcon192Url(data.icon192Url || "");
      setIcon512Url(data.icon512Url || "");
      setIconMaskable512Url(data.iconMaskable512Url || "");
    } catch {
      // Network error — leave whatever icons were already staged alone.
    } finally {
      setGeneratingIcons(false);
    }
  };

  // One explicit save for the whole card — mirrors WhatsAppCard: uploading
  // a photo or typing only updates local state (and the live preview)
  // above, nothing reaches Supabase until this is clicked.
  const save = async () => {
    await supabase
      .from("profiles")
      .update({
        cover_image_url: coverUrl || null,
        avatar_url: avatarUrl || null,
        name,
        bio,
        avatar_icon_192_url: icon192Url || null,
        avatar_icon_512_url: icon512Url || null,
        avatar_icon_maskable_512_url: iconMaskable512Url || null,
      })
      .eq("id", profileId);
    pulse.show();
  };

  return (
    <EditorCard icon={User} title={t.editor.profile.title} action={<SavedPulse visible={pulse.visible} label={t.editor.saved} />}>
      {/* Cover photo — the banner image behind the avatar on the public
          page. Wide/rectangular, so it uses a "square" shape upload
          rather than the circular avatar treatment. */}
      <div className="mb-4">
        <label className="text-xs text-ringo-muted mb-1.5 block">{t.editor.profile.coverPhoto}</label>
        <ImageUploadField
          value={coverUrl}
          onChange={(url) => {
            setCoverUrl(url);
            updateDraft({ cover_image_url: url });
          }}
          userId={userId}
          folder="cover"
          shape="square"
          size={96}
          errorText={t.editor.upload}
        />
      </div>

      {/* data-tour target for the onboarding tour's "add your profile
          photo" step (src/lib/onboardingTour.ts) — a plain HTML attribute
          with no behavior of its own, additive only. */}
      <div data-tour="profile-photo" className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-left">
        <AvatarCropperField
          value={avatarUrl}
          onChange={(url) => {
            setAvatarUrl(url);
            updateDraft({ avatar_url: url });
            generateAvatarIcons(url);
          }}
          userId={userId}
          size={64}
          errorText={t.editor.upload}
        />
        <div className="flex-1 w-full flex flex-col gap-3">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              updateDraft({ name: e.target.value });
            }}
            placeholder={t.editor.profile.namePlaceholder}
            className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
          <div>
            <textarea
              value={bio}
              onChange={(e) => {
                const next = e.target.value.slice(0, 150);
                setBio(next);
                updateDraft({ bio: next });
              }}
              placeholder={t.editor.profile.bioPlaceholder}
              rows={2}
              className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text resize-none"
            />
            <p className="text-[11px] text-ringo-muted text-right mt-1">{t.editor.profile.bioCount(bio.length)}</p>
          </div>
        </div>
      </div>

      <button
        onClick={save}
        disabled={generatingIcons}
        title={generatingIcons ? "Preparing your home-screen icon…" : undefined}
        className="self-start mt-4 px-4 py-2 rounded-card bg-ringo-indigo text-white text-sm font-medium transition hover:brightness-110 active:scale-[0.97] disabled:opacity-60"
      >
        {t.editor.save}
      </button>
    </EditorCard>
  );
}