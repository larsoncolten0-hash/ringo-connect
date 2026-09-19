"use client";

import { useState } from "react";
import { Users, Copy, Check } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import EditorCard from "@/components/editor/EditorCard";

// Community is always on for every profile (src/lib/community/enabled.ts),
// so there is nothing to enable, disable or save here any more — the ON/OFF
// toggle and the legacy button-label field are gone, and this card never
// writes profiles.community_enabled / community_label (both columns are
// kept untouched in the database). What remains is the legacy join-page
// link, which still works for old shared links.
export default function CommunitySettingsCard({ username, siteUrl }: { username: string; siteUrl: string }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  const communityLink = `${siteUrl.replace(/\/$/, "")}/${username}/community`;

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
    <EditorCard icon={Users} title={t.community.title}>
      <div className="flex flex-col gap-4">
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
        </div>
      </div>
    </EditorCard>
  );
}
