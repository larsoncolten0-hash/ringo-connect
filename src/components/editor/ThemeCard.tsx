"use client";

import { useRef, useState } from "react";
import { Palette } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { getButtonStyle, getRadiusClass, getBackgroundStyle, type ButtonStyle, type ButtonRadius, type BackgroundStyle } from "@/lib/theme";
import EditorCard from "./EditorCard";
import SavedPulse, { useSavedPulse } from "./SavedPulse";

const ACCENT_PRESETS = ["#4F46E5", "#FF6B4A", "#14B8A6", "#E11D48", "#059669", "#D97706", "#0EA5E9", "#7C3AED", "#0F172A"];

export default function ThemeCard({
  profileId,
  themeEnabled,
  initial,
}: {
  profileId: string;
  themeEnabled: boolean;
  initial: {
    themeColor: string;
    backgroundStyle: BackgroundStyle;
    backgroundColor: string;
    backgroundGradientEnd: string | null;
    textColor: string;
    buttonStyle: ButtonStyle;
    buttonRadius: ButtonRadius;
  };
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [accent, setAccent] = useState(initial.themeColor || "#4F46E5");
  const [bgStyle, setBgStyle] = useState<BackgroundStyle>(initial.backgroundStyle || "solid");
  const [bgColor, setBgColor] = useState(initial.backgroundColor || "#FAFAF8");
  const [bgGradientEnd, setBgGradientEnd] = useState(initial.backgroundGradientEnd || "#E0E7FF");
  const [textColor, setTextColor] = useState(initial.textColor || "#0F172A");
  const [btnStyle, setBtnStyle] = useState<ButtonStyle>(initial.buttonStyle || "fill");
  const [btnRadius, setBtnRadius] = useState<ButtonRadius>(initial.buttonRadius || "rounded");
  const pulse = useSavedPulse();
  const persistTimer = useRef<ReturnType<typeof setTimeout>>();

  const persist = (patch: Record<string, any>) => {
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(async () => {
      await supabase.from("profiles").update(patch).eq("id", profileId);
      pulse.show();
    }, 300);
  };

  if (!themeEnabled) {
    return (
      <EditorCard icon={Palette} title={t.editor.theme.title}>
        <div className="border border-dashed border-ringo-border rounded-card p-6 text-center text-sm text-ringo-muted">
          {t.editor.theme.locked}
        </div>
      </EditorCard>
    );
  }

  const previewButtonStyle = getButtonStyle(btnStyle, accent);
  const previewRadius = getRadiusClass(btnRadius);
  const previewBg = getBackgroundStyle(bgStyle, bgColor, bgGradientEnd);

  return (
    <EditorCard
      icon={Palette}
      title={t.editor.theme.title}
      action={<SavedPulse visible={pulse.visible} label={t.editor.saved} />}
    >
      <p className="text-xs text-ringo-muted mb-4">{t.editor.theme.description}</p>

      <div className="grid lg:grid-cols-[1fr_180px] gap-5">
        <div className="flex flex-col gap-4">
          {/* Accent color */}
          <div>
            <p className="text-xs font-medium text-ringo-text mb-2">{t.editor.theme.title}</p>
            <div className="flex flex-wrap items-center gap-2">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => {
                    setAccent(preset);
                    persist({ theme_color: preset });
                  }}
                  aria-label={preset}
                  style={{ backgroundColor: preset }}
                  className={`w-7 h-7 rounded-full ring-offset-2 ring-offset-ringo-surface ${
                    accent.toLowerCase() === preset.toLowerCase() ? "ring-2 ring-ringo-text" : ""
                  }`}
                />
              ))}
              <label
                className="relative w-7 h-7 rounded-full overflow-hidden border border-ringo-border cursor-pointer shrink-0"
                style={{ backgroundColor: accent }}
                title={t.editor.theme.custom}
              >
                <input
                  type="color"
                  value={accent}
                  onChange={(e) => {
                    setAccent(e.target.value);
                    persist({ theme_color: e.target.value });
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </label>
            </div>
          </div>

          {/* Background */}
          <div>
            <p className="text-xs font-medium text-ringo-text mb-2">{t.editor.theme.background}</p>
            <div className="flex items-center gap-2 mb-2">
              {(["solid", "gradient"] as BackgroundStyle[]).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setBgStyle(s);
                    persist({ background_style: s });
                  }}
                  className={`text-xs px-3 py-1.5 rounded-card border transition ${
                    bgStyle === s ? "border-ringo-indigo text-ringo-indigo bg-ringo-indigo/5" : "border-ringo-border text-ringo-muted"
                  }`}
                >
                  {s === "solid" ? t.editor.theme.solid : t.editor.theme.gradient}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={bgColor}
                onChange={(e) => {
                  setBgColor(e.target.value);
                  persist({ background_color: e.target.value });
                }}
                className="w-8 h-8 rounded-card border border-ringo-border cursor-pointer"
              />
              {bgStyle === "gradient" && (
                <input
                  type="color"
                  value={bgGradientEnd}
                  onChange={(e) => {
                    setBgGradientEnd(e.target.value);
                    persist({ background_gradient_end: e.target.value });
                  }}
                  className="w-8 h-8 rounded-card border border-ringo-border cursor-pointer"
                />
              )}
            </div>
          </div>

          {/* Text color */}
          <div>
            <p className="text-xs font-medium text-ringo-text mb-2">{t.editor.theme.textColor}</p>
            <div className="flex items-center gap-2">
              {["#0F172A", "#FFFFFF"].map((preset) => (
                <button
                  key={preset}
                  onClick={() => {
                    setTextColor(preset);
                    persist({ text_color: preset });
                  }}
                  style={{ backgroundColor: preset }}
                  className={`w-7 h-7 rounded-full border border-ringo-border ${
                    textColor.toLowerCase() === preset.toLowerCase() ? "ring-2 ring-ringo-indigo ring-offset-2 ring-offset-ringo-surface" : ""
                  }`}
                />
              ))}
              <input
                type="color"
                value={textColor}
                onChange={(e) => {
                  setTextColor(e.target.value);
                  persist({ text_color: e.target.value });
                }}
                className="w-7 h-7 rounded-card border border-ringo-border cursor-pointer"
              />
            </div>
          </div>

          {/* Button style */}
          <div>
            <p className="text-xs font-medium text-ringo-text mb-2">{t.editor.theme.buttonStyle}</p>
            <div className="flex items-center gap-2">
              {(["fill", "outline", "soft"] as ButtonStyle[]).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setBtnStyle(s);
                    persist({ button_style: s });
                  }}
                  className={`text-xs px-3 py-1.5 rounded-card border transition ${
                    btnStyle === s ? "border-ringo-indigo text-ringo-indigo bg-ringo-indigo/5" : "border-ringo-border text-ringo-muted"
                  }`}
                >
                  {s === "fill" ? t.editor.theme.fill : s === "outline" ? t.editor.theme.outline : t.editor.theme.soft}
                </button>
              ))}
            </div>
          </div>

          {/* Button shape */}
          <div>
            <p className="text-xs font-medium text-ringo-text mb-2">{t.editor.theme.buttonShape}</p>
            <div className="flex items-center gap-2">
              {(["square", "rounded", "pill"] as ButtonRadius[]).map((r) => (
                <button
                  key={r}
                  onClick={() => {
                    setBtnRadius(r);
                    persist({ button_radius: r });
                  }}
                  className={`text-xs px-3 py-1.5 border transition ${getRadiusClass(r)} ${
                    btnRadius === r ? "border-ringo-indigo text-ringo-indigo bg-ringo-indigo/5" : "border-ringo-border text-ringo-muted"
                  }`}
                >
                  {r === "square" ? t.editor.theme.square : r === "rounded" ? t.editor.theme.rounded : t.editor.theme.pill}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div>
          <p className="text-xs font-medium text-ringo-text mb-2">{t.editor.theme.preview}</p>
          <div
            className="rounded-card border border-ringo-border p-4 flex flex-col items-center gap-3 h-full justify-center"
            style={{ ...previewBg, color: textColor }}
          >
            <div className="w-10 h-10 rounded-full" style={{ backgroundColor: accent, opacity: 0.25 }} />
            <div className={`w-full text-center text-xs py-2 px-2 ${previewRadius}`} style={previewButtonStyle}>
              {t.editor.theme.sampleLink}
            </div>
          </div>
        </div>
      </div>
    </EditorCard>
  );
}