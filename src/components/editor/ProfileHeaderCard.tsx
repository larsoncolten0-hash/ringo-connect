"use client";

import { useState } from "react";
import { User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import EditorCard from "./EditorCard";
import ImageUploadField from "./ImageUploadField";
import SavedPulse, { useSavedPulse } from "./SavedPulse";

export default function ProfileHeaderCard({
  profileId,
  userId,
  initialAvatarUrl,
  initialName,
  initialBio,
}: {
  profileId: string;
  userId: string;
  initialAvatarUrl: string | null;
  initialName: string | null;
  initialBio: string | null;
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl || "");
  const [name, setName] = useState(initialName || "");
  const [bio, setBio] = useState(initialBio || "");
  const pulse = useSavedPulse();

  const persist = async (patch: Record<string, string>) => {
    await supabase.from("profiles").update(patch).eq("id", profileId);
    pulse.show();
  };

  return (
    <EditorCard icon={User} title={t.editor.profile.title} action={<SavedPulse visible={pulse.visible} label={t.editor.saved} />}>
      <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-left">
        <ImageUploadField
          value={avatarUrl}
          onChange={(url) => {
            setAvatarUrl(url);
            persist({ avatar_url: url });
          }}
          userId={userId}
          folder="avatar"
          shape="circle"
          size={64}
          errorText={t.editor.upload}
        />
        <div className="flex-1 w-full flex flex-col gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => persist({ name })}
            placeholder={t.editor.profile.namePlaceholder}
            className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
          <div>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 150))}
              onBlur={() => persist({ bio })}
              placeholder={t.editor.profile.bioPlaceholder}
              rows={2}
              className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text resize-none"
            />
            <p className="text-[11px] text-ringo-muted text-right mt-1">{t.editor.profile.bioCount(bio.length)}</p>
          </div>
        </div>
      </div>
    </EditorCard>
  );
}