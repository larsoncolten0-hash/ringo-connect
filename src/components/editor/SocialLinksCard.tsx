"use client";

import { useEffect, useId, useState } from "react";
import { Share2, X, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { detectPlatform } from "@/lib/utils";
import { normalizeLinkUrl } from "@/lib/linkUrl";
import { useLanguage } from "@/components/LanguageProvider";
import { useAutosave } from "@/components/dashboard/sectionAutosave";
import SocialIcon from "@/components/SocialIcon";
import EditorCard from "./EditorCard";
import EmptyState from "./EmptyState";
import { useEditorPreview } from "./EditorPreviewContext";

// Social links save the moment they are added or removed (there is no Save step). Every write goes
// through the section's auto-save engine, so a failure is never silent: a failed add keeps the typed
// address in the box with a message, a failed remove puts the row back. The address typed but not yet
// added counts as unsaved input, so leaving the section does not drop it without asking.
export default function SocialLinksCard({
  profileId,
  initialSocials,
}: {
  profileId: string;
  initialSocials: any[];
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const autosave = useAutosave();
  const [socials, setSocials] = useState(initialSocials);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [urlError, setUrlError] = useState("");
  const { updateDraft } = useEditorPreview();
  const hintId = useId();
  const typed = url.trim() ? normalizeLinkUrl(url.trim()) : null;
  const detectedPlatform = typed && typed.ok ? { platform: detectPlatform(typed.url), url: typed.url } : null;

  // The typed-but-not-added address is the only thing here that can be lost.
  useEffect(() => {
    autosave.setUncommitted("social-url", url.trim() !== "");
    return () => autosave.setUncommitted("social-url", false);
  }, [url, autosave]);

  const addSocial = async () => {
    const trimmed = url.trim();
    if (!trimmed || adding) return;
    const check = normalizeLinkUrl(trimmed);
    if (!check.ok) {
      setUrlError(t.editor.validation.urlInvalid);
      return;
    }
    setUrlError("");
    setAdding(true);
    const platform = detectPlatform(check.url);
    let created: any = null;
    const ok = await autosave.run(
      async () => {
        const res = await supabase
          .from("social_links")
          .insert({ profile_id: profileId, platform, url: check.url, sort_order: socials.length })
          .select()
          .single();
        created = res.data;
        // a "success" without the new row would leave the list out of step with the database
        return res.error || !res.data ? { error: res.error ?? new Error("no row returned") } : res;
      },
      { rollback: () => {} } // nothing was added to the list yet, so there is nothing to undo; keep the typed address
    );
    if (ok && created) {
      const next = [...socials, created];
      setSocials(next);
      updateDraft({ social_links: next });
      setUrl("");
    }
    setAdding(false);
  };

  const removeSocial = async (id: string) => {
    const index = socials.findIndex((s) => s.id === id);
    if (index < 0) return;
    const removed = socials[index];
    const next = socials.filter((s) => s.id !== id);
    setSocials(next);
    updateDraft({ social_links: next });
    await autosave.run(() => supabase.from("social_links").delete().eq("id", id), {
      rollback: () => {
        // put the row back where it was, so the list matches what is really saved
        setSocials((cur) => {
          if (cur.some((s) => s.id === id)) return cur;
          const restored = [...cur];
          restored.splice(Math.min(index, restored.length), 0, removed);
          updateDraft({ social_links: restored });
          return restored;
        });
      },
    });
  };

  return (
    <EditorCard icon={Share2} title={t.editor.socialLinks}>
      <div className="flex flex-col gap-2 mb-3">
        {socials.length === 0 && <EmptyState icon={Share2} title={t.editor.noSocialsYet} />}
        {socials.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2.5 border border-ringo-border rounded-card pl-3 pr-1 py-1"
          >
            <SocialIcon platform={s.platform} url={s.url} />
            <span className="flex-1 text-sm text-ringo-text truncate min-w-0">{s.url}</span>
            <button
              type="button"
              onClick={() => removeSocial(s.id)}
              aria-label={t.editor.removeSocial}
              className="shrink-0 w-11 h-11 flex items-center justify-center rounded-full text-ringo-muted hover:text-ringo-coral hover:bg-ringo-coral/10 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      {/* Explicit Add button — Enter still works as a bonus on desktop,
          but nobody should have to guess that on a phone keyboard. */}
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (urlError) setUrlError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") addSocial();
          }}
          placeholder={t.editor.pasteUrlHint}
          inputMode="url"
          aria-label={t.editor.addSocial}
          aria-invalid={!!urlError}
          aria-describedby={hintId}
          className="flex-1 min-w-0 border border-ringo-border rounded-card px-3 py-2.5 text-sm bg-ringo-bg text-ringo-text"
        />
        <button
          type="button"
          onClick={addSocial}
          disabled={!url.trim() || adding}
          aria-label={t.editor.addSocial}
          className="ringo-tactile ringo-cta shrink-0 w-11 h-11 flex items-center justify-center rounded-card"
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
      {detectedPlatform && (
        // which account this will be: the platform is read from the address as it is typed (the same detection the save uses)
        <p aria-live="polite" className="mt-2 flex items-center gap-2 text-xs font-medium text-ringo-text">
          <SocialIcon platform={detectedPlatform.platform} url={detectedPlatform.url} />
          <span className="capitalize">{t.editor.socialDetected(detectedPlatform.platform)}</span>
        </p>
      )}
      <p id={hintId} className={`text-xs mt-1.5 ${urlError ? "text-red-500" : "text-ringo-muted"}`} role={urlError ? "alert" : undefined}>
        {urlError || t.editor.validation.urlHint}
      </p>
    </EditorCard>
  );
}
