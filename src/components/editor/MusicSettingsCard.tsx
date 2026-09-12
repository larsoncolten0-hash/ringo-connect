"use client";

import { useState } from "react";
import { Sparkles, Palette } from "lucide-react";
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
  initialSupportMessage,
}: {
  profileId: string;
  initialRole: string | null;
  initialSupportEnabled: boolean;
  initialSupportMessage: string | null;
}) {
  const supabase = createClient();
  const { t, locale } = useLanguage();
  const [role, setRole] = useState<MusicRole | null>((initialRole as MusicRole) || null);
  const [supportEnabled, setSupportEnabled] = useState(initialSupportEnabled);
  const [supportMessage, setSupportMessage] = useState(initialSupportMessage || "");
  const [applyingTheme, setApplyingTheme] = useState(false);
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
    setApplyingTheme(true);
    const patch = {
      theme_color: theme.themeColor,
      background_style: theme.backgroundStyle,
      background_color: theme.backgroundColor,
      background_gradient_end: theme.backgroundGradientEnd,
      text_color: theme.textColor,
      button_style: theme.buttonStyle,
      button_radius: theme.buttonRadius,
    };
    await supabase.from("profiles").update(patch).eq("id", profileId);
    // ThemeCard seeds its own color/style state once at mount from the
    // server-rendered profile, not from this shared draft — so without a
    // reload it would keep showing the old selection even though the DB
    // (and the live preview, via updateDraft) already reflect the new
    // theme. A full reload is the simplest way to get ThemeCard's own
    // controls to actually show what was just applied, and this is a
    // deliberate, infrequent action rather than something worth building
    // cross-card state sync for.
    updateDraft(patch);
    window.location.reload();
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

        {supportEnabled && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ringo-text">{t.music.supportMessageLabel}</span>
            <textarea
              value={supportMessage}
              onChange={(e) => setSupportMessage(e.target.value)}
              onBlur={async (e) => {
                const value = e.target.value.trim() || null;
                updateDraft({ support_message: value });
                await supabase.from("profiles").update({ support_message: value }).eq("id", profileId);
                pulse.show();
              }}
              placeholder={t.music.supportMessagePlaceholder}
              rows={2}
              className="text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text resize-none"
            />
          </label>
        )}

        <div className="rounded-card border border-ringo-indigo/25 bg-ringo-indigo/[0.05] p-4 flex flex-col sm:flex-row sm:items-center gap-3.5">
          <span className="w-9 h-9 rounded-full bg-ringo-indigo/10 flex items-center justify-center shrink-0">
            <Palette size={16} className="text-ringo-indigo" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-ringo-text">{t.music.recommendedThemeNudge}</p>
            <p className="text-xs text-ringo-muted mt-0.5">{t.music.applyThemeHint}</p>
          </div>
          <button
            onClick={applyRecommendedTheme}
            disabled={applyingTheme}
            className="shrink-0 flex items-center justify-center gap-1.5 text-xs font-semibold text-white bg-ringo-indigo px-4 py-2.5 rounded-card transition hover:brightness-110 active:scale-[0.97] disabled:opacity-50 whitespace-nowrap"
          >
            {applyingTheme ? t.music.applyingTheme : t.music.applyTheme}
          </button>
        </div>
      </div>
    </EditorCard>
  );
}
