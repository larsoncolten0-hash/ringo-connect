"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { MUSIC_ROLES, getCategory, type MusicRole } from "@/lib/categories";
import EditorCard from "./EditorCard";
import SavedPulse, { useSavedPulse } from "./SavedPulse";
import { useEditorPreview } from "./EditorPreviewContext";

// Only ever rendered for a profile tagged Music & Entertainment (see
// Editor.tsx) — the role picker retitles the Latest Music/Beats section
// and its Artist Hub card, the toggle controls the Support the Artist
// section, and "Apply recommended theme" is the one explicit, user-
// triggered way to pull in the category's curated look after signup (it's
// applied automatically only once, at signup, for a brand-new profile —
// see /auth/confirm and the admin approve route).
export default function MusicSettingsCard({
  profileId,
  initialRole,
  initialSupportEnabled,
}: {
  profileId: string;
  initialRole: string | null;
  initialSupportEnabled: boolean;
}) {
  const supabase = createClient();
  const { t, locale } = useLanguage();
  const [role, setRole] = useState<MusicRole | null>((initialRole as MusicRole) || null);
  const [supportEnabled, setSupportEnabled] = useState(initialSupportEnabled);
  const [themeJustApplied, setThemeJustApplied] = useState(false);
  const pulse = useSavedPulse();
  const { updateDraft } = useEditorPreview();

  const selectRole = async (id: MusicRole) => {
    setRole(id);
    updateDraft({ music_role: id });
    await supabase.from("profiles").update({ music_role: id }).eq("id", profileId);
    pulse.show();
  };

  const toggleSupport = async () => {
    const next = !supportEnabled;
    setSupportEnabled(next);
    updateDraft({ hub_support_enabled: next });
    await supabase.from("profiles").update({ hub_support_enabled: next }).eq("id", profileId);
    pulse.show();
  };

  const applyRecommendedTheme = async () => {
    const theme = getCategory("music_entertainment")?.defaults.recommendedTheme;
    if (!theme) return;
    const patch = {
      theme_color: theme.themeColor,
      background_style: theme.backgroundStyle,
      background_color: theme.backgroundColor,
      background_gradient_end: theme.backgroundGradientEnd,
      text_color: theme.textColor,
      button_style: theme.buttonStyle,
      button_radius: theme.buttonRadius,
    };
    updateDraft(patch);
    await supabase.from("profiles").update(patch).eq("id", profileId);
    setThemeJustApplied(true);
    pulse.show();
  };

  return (
    <EditorCard
      icon={Sparkles}
      title={t.music.settingsTitle}
      action={<SavedPulse visible={pulse.visible} label={t.editor.saved} />}
    >
      <p className="text-xs text-ringo-muted -mt-1 mb-4">{t.music.settingsHint}</p>

      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium text-ringo-text mb-2">{t.music.roleLabel}</p>
          <div className="flex flex-wrap gap-1.5">
            {MUSIC_ROLES.map((r) => (
              <button
                key={r.id}
                onClick={() => selectRole(r.id)}
                className={`text-xs px-2.5 py-1.5 rounded-full border transition ${
                  role === r.id
                    ? "border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo font-medium"
                    : "border-ringo-border text-ringo-muted"
                }`}
              >
                {r.emoji} {r.label[locale]}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-card border border-ringo-border p-3 cursor-pointer">
          <span>
            <span className="block text-sm font-medium text-ringo-text">{t.music.supportToggleLabel}</span>
            <span className="block text-xs text-ringo-muted mt-0.5">{t.music.supportToggleHint}</span>
          </span>
          <input
            type="checkbox"
            checked={supportEnabled}
            onChange={toggleSupport}
            className="accent-ringo-indigo shrink-0"
          />
        </label>

        <div className="rounded-card border border-dashed border-ringo-border p-3.5">
          <p className="text-sm font-medium text-ringo-text">{t.music.recommendedThemeNudge}</p>
          <p className="text-xs text-ringo-muted mt-1">{t.music.applyThemeHint}</p>
          <button
            onClick={applyRecommendedTheme}
            className="text-xs font-medium text-ringo-indigo mt-2.5"
          >
            {t.music.applyTheme}
          </button>
          {themeJustApplied && <p className="text-xs text-ringo-teal mt-1.5">{t.music.themeApplied}</p>}
        </div>
      </div>
    </EditorCard>
  );
}
