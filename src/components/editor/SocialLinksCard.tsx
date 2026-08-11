"use client";

import { useState } from "react";
import { Share2, X, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { detectPlatform } from "@/lib/utils";
import { useLanguage } from "@/components/LanguageProvider";
import SocialIcon from "@/components/SocialIcon";
import EditorCard from "./EditorCard";

export default function SocialLinksCard({
  profileId,
  initialSocials,
}: {
  profileId: string;
  initialSocials: any[];
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [socials, setSocials] = useState(initialSocials);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const addSocial = async () => {
    const trimmed = url.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    const platform = detectPlatform(trimmed);
    const { data } = await supabase
      .from("social_links")
      .insert({ profile_id: profileId, platform, url: trimmed, sort_order: socials.length })
      .select()
      .single();
    if (data) setSocials([...socials, data]);
    setUrl("");
    setAdding(false);
  };

  const removeSocial = async (id: string) => {
    setSocials(socials.filter((s) => s.id !== id));
    await supabase.from("social_links").delete().eq("id", id);
  };

  return (
    <EditorCard icon={Share2} title={t.editor.socialLinks}>
      <div className="flex flex-col gap-2 mb-3">
        {socials.length === 0 && <p className="text-sm text-ringo-muted">{t.editor.noSocialsYet}</p>}
        {socials.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2.5 border border-ringo-border rounded-card px-3 py-2.5"
          >
            <SocialIcon platform={s.platform} url={s.url} />
            <span className="flex-1 text-sm text-ringo-text truncate min-w-0">{s.url}</span>
            <button
              onClick={() => removeSocial(s.id)}
              aria-label={t.editor.removeSocial}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-ringo-muted hover:text-ringo-coral hover:bg-ringo-coral/10 transition"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>

      {/* Explicit Add button — Enter still works as a bonus on desktop,
          but nobody should have to guess that on a phone keyboard. */}
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addSocial();
          }}
          placeholder={t.editor.pasteUrlHint}
          inputMode="url"
          className="flex-1 min-w-0 border border-ringo-border rounded-card px-3 py-2.5 text-sm bg-ringo-bg text-ringo-text"
        />
        <button
          onClick={addSocial}
          disabled={!url.trim() || adding}
          aria-label={t.editor.addSocial}
          className="shrink-0 w-11 h-11 flex items-center justify-center rounded-card bg-ringo-indigo text-white disabled:opacity-40"
        >
          <Plus size={18} />
        </button>
      </div>
    </EditorCard>
  );
}