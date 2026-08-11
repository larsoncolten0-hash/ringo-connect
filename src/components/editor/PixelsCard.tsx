"use client";

import { useState } from "react";
import { Radar } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import EditorCard from "./EditorCard";
import SavedPulse, { useSavedPulse } from "./SavedPulse";

export default function PixelsCard({
  profileId,
  pixelsEnabled,
  initialFacebookId,
  initialTiktokId,
}: {
  profileId: string;
  pixelsEnabled: boolean;
  initialFacebookId: string | null;
  initialTiktokId: string | null;
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [fbId, setFbId] = useState(initialFacebookId || "");
  const [ttId, setTtId] = useState(initialTiktokId || "");
  const pulse = useSavedPulse();

  const save = async (patch: Record<string, string>) => {
    await supabase.from("profiles").update(patch).eq("id", profileId);
    pulse.show();
  };

  if (!pixelsEnabled) {
    return (
      <EditorCard icon={Radar} title={t.editor.trackingPixels}>
        <div className="border border-dashed border-ringo-border rounded-card p-6 text-center text-sm text-ringo-muted">
          {t.editor.pixelsLocked}
        </div>
      </EditorCard>
    );
  }

  return (
    <EditorCard icon={Radar} title={t.editor.trackingPixels} action={<SavedPulse visible={pulse.visible} label={t.editor.saved} />}>
      <div className="flex flex-col gap-2">
        <input
          value={fbId}
          onChange={(e) => setFbId(e.target.value)}
          onBlur={() => save({ facebook_pixel_id: fbId })}
          placeholder={t.editor.facebookPixelId}
          className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
        />
        <input
          value={ttId}
          onChange={(e) => setTtId(e.target.value)}
          onBlur={() => save({ tiktok_pixel_id: ttId })}
          placeholder={t.editor.tiktokPixelId}
          className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
        />
      </div>
    </EditorCard>
  );
}