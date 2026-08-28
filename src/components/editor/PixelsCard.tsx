"use client";

import { useState } from "react";
import Link from "next/link";
import { Radar, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { isValidFacebookPixelId, isValidTiktokPixelId } from "@/lib/pixelEvents";
import EditorCard from "./EditorCard";
import SavedPulse, { useSavedPulse } from "./SavedPulse";

function ConfiguredBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-ringo-teal">
      <Check size={11} />
      {label}
    </span>
  );
}

export default function PixelsCard({
  profileId,
  pixelsEnabled,
  initialFacebookId,
  initialTiktokId,
  initialTestEventCode,
  facebookCapiConfigured,
  tiktokEventsConfigured,
}: {
  profileId: string;
  pixelsEnabled: boolean;
  initialFacebookId: string | null;
  initialTiktokId: string | null;
  initialTestEventCode: string | null;
  facebookCapiConfigured: boolean;
  tiktokEventsConfigured: boolean;
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [fbId, setFbId] = useState(initialFacebookId || "");
  const [ttId, setTtId] = useState(initialTiktokId || "");
  const [testEventCode, setTestEventCode] = useState(initialTestEventCode || "");
  const [fbToken, setFbToken] = useState("");
  const [ttToken, setTtToken] = useState("");
  const [fbConfigured, setFbConfigured] = useState(facebookCapiConfigured);
  const [ttConfigured, setTtConfigured] = useState(tiktokEventsConfigured);
  const [tokenError, setTokenError] = useState("");
  const pulse = useSavedPulse();

  const save = async (patch: Record<string, string>) => {
    await supabase.from("profiles").update(patch).eq("id", profileId);
    pulse.show();
  };

  // Secret tokens go through a dedicated route (they're encrypted
  // server-side before storage — see /api/pixels), unlike the plain
  // pixel IDs above which are saved directly the same way every other
  // field in this editor is.
  const saveToken = async (field: "facebookCapiToken" | "tiktokEventsToken", value: string) => {
    if (!value.trim()) return;
    setTokenError("");
    const res = await fetch("/api/pixels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, [field]: value }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setTokenError(body?.error || t.editor.pixelTokenSaveError);
      return;
    }
    if (field === "facebookCapiToken") {
      setFbConfigured(true);
      setFbToken("");
    } else {
      setTtConfigured(true);
      setTtToken("");
    }
    pulse.show();
  };

  if (!pixelsEnabled) {
    return (
      <EditorCard icon={Radar} title={t.editor.trackingPixels}>
        <div className="border border-dashed border-ringo-border rounded-card p-6 text-center text-sm text-ringo-muted flex flex-col items-center gap-3">
          {t.editor.pixelsLocked}
          <Link href="/dashboard/subscription" className="text-xs font-medium text-ringo-indigo">
            {t.sidebar.upgradePlan}
          </Link>
        </div>
      </EditorCard>
    );
  }

  const fbIdInvalid = fbId.trim() !== "" && !isValidFacebookPixelId(fbId.trim());
  const ttIdInvalid = ttId.trim() !== "" && !isValidTiktokPixelId(ttId.trim());

  return (
    <EditorCard icon={Radar} title={t.editor.trackingPixels} action={<SavedPulse visible={pulse.visible} label={t.editor.saved} />}>
      <p className="text-xs text-ringo-muted mb-4">{t.editor.pixelsIntro}</p>

      {/* Meta / Facebook */}
      <div className="flex flex-col gap-2 mb-5">
        <p className="text-xs font-medium text-ringo-text">{t.editor.metaSectionTitle}</p>
        <div>
          <input
            value={fbId}
            onChange={(e) => setFbId(e.target.value)}
            onBlur={() => !fbIdInvalid && save({ facebook_pixel_id: fbId.trim() })}
            placeholder={t.editor.facebookPixelId}
            inputMode="numeric"
            className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
          {fbIdInvalid && <p className="text-[11px] text-ringo-coral mt-1">{t.editor.facebookPixelIdInvalid}</p>}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-ringo-muted">{t.editor.facebookCapiToken}</span>
            {fbConfigured && <ConfiguredBadge label={t.editor.configured} />}
          </div>
          <input
            type="password"
            value={fbToken}
            onChange={(e) => setFbToken(e.target.value)}
            onBlur={() => saveToken("facebookCapiToken", fbToken)}
            placeholder={fbConfigured ? t.editor.tokenReplacePlaceholder : t.editor.tokenNotSetPlaceholder}
            className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
          <p className="text-[11px] text-ringo-muted mt-1">{t.editor.facebookCapiTokenHint}</p>
        </div>
        <input
          value={testEventCode}
          onChange={(e) => setTestEventCode(e.target.value)}
          onBlur={() => save({ facebook_test_event_code: testEventCode.trim() })}
          placeholder={t.editor.testEventCode}
          className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
        />
      </div>

      {/* TikTok */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-ringo-text">{t.editor.tiktokSectionTitle}</p>
        <div>
          <input
            value={ttId}
            onChange={(e) => setTtId(e.target.value)}
            onBlur={() => !ttIdInvalid && save({ tiktok_pixel_id: ttId.trim() })}
            placeholder={t.editor.tiktokPixelId}
            className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
          {ttIdInvalid && <p className="text-[11px] text-ringo-coral mt-1">{t.editor.tiktokPixelIdInvalid}</p>}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-ringo-muted">{t.editor.tiktokEventsToken}</span>
            {ttConfigured && <ConfiguredBadge label={t.editor.configured} />}
          </div>
          <input
            type="password"
            value={ttToken}
            onChange={(e) => setTtToken(e.target.value)}
            onBlur={() => saveToken("tiktokEventsToken", ttToken)}
            placeholder={ttConfigured ? t.editor.tokenReplacePlaceholder : t.editor.tokenNotSetPlaceholder}
            className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
          <p className="text-[11px] text-ringo-muted mt-1">{t.editor.tiktokEventsTokenHint}</p>
        </div>
      </div>

      {tokenError && <p className="text-xs text-ringo-coral mt-3">{tokenError}</p>}
    </EditorCard>
  );
}
