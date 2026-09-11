"use client";

import { useState } from "react";
import { Users, Copy, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import EditorCard from "@/components/editor/EditorCard";
import SavedPulse, { useSavedPulse } from "@/components/editor/SavedPulse";

// Mirrors BookingSettingsCard.tsx exactly — same "type things, then click
// Save" pattern, same "your link" copy box.
export default function CommunitySettingsCard({
  profileId,
  username,
  siteUrl,
  initialEnabled,
  initialLabel,
}: {
  profileId: string;
  username: string;
  siteUrl: string;
  initialEnabled: boolean;
  initialLabel: string | null;
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [label, setLabel] = useState(initialLabel || "");
  const [copied, setCopied] = useState(false);
  const pulse = useSavedPulse();

  const communityLink = `${siteUrl.replace(/\/$/, "")}/${username}/community`;

  const save = async () => {
    await supabase
      .from("profiles")
      .update({ community_enabled: enabled, community_label: label.trim() || null })
      .eq("id", profileId);
    pulse.show();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(communityLink);
    } catch {
      // Clipboard API can be unavailable — non-critical convenience feature.
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <EditorCard icon={Users} title={t.community.title} action={<SavedPulse visible={pulse.visible} label={t.editor.saved} />}>
      <div className="flex flex-col gap-4">
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span>
            <span className="block text-sm font-medium text-ringo-text">{t.community.enableLabel}</span>
            <span className="block text-xs text-ringo-muted mt-0.5">{t.community.enableHint}</span>
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-ringo-indigo w-5 h-5 shrink-0"
          />
        </label>

        <div className="rounded-card border border-ringo-border/70 bg-ringo-bg p-4">
          <p className="text-sm font-medium text-ringo-text mb-1">{t.community.yourLinkTitle}</p>
          <p className="text-xs text-ringo-muted mb-3">{t.community.yourLinkHint}</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 min-w-0 flex items-center rounded-card border border-ringo-border bg-ringo-surface px-3.5 py-2.5">
              <p className="text-sm text-ringo-text truncate font-mono">{communityLink}</p>
            </div>
            <button
              onClick={copyLink}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium hover:brightness-110 transition active:scale-[0.97]"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? t.community.linkCopied : t.community.copyLink}
            </button>
          </div>
          {!enabled && <p className="text-xs text-ringo-muted mt-2.5">{t.community.linkDisabledHint}</p>}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ringo-text">{t.community.labelFieldLabel}</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t.community.labelFieldPlaceholder}
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
          <span className="text-xs text-ringo-muted">{t.community.labelFieldHint}</span>
        </label>

        <button
          onClick={save}
          className="self-start px-4 py-2 rounded-card bg-ringo-indigo text-white text-sm font-medium transition hover:brightness-110 active:scale-[0.97]"
        >
          {t.editor.save}
        </button>
      </div>
    </EditorCard>
  );
}
