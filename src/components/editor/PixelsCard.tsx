"use client";

import { useState } from "react";
import Link from "next/link";
import { Radar, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { useAutosave } from "@/components/dashboard/sectionAutosave";
import Disclosure from "@/components/ui/Disclosure";
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
  const autosave = useAutosave();

  // Pixel IDs save when you leave the field. A failure is never silent: the section shows it and keeps
  // the typed value for a retry (a later success for the same field clears it).
  const save = async (patch: Record<string, string>) => {
    const ok = await autosave.run(() => supabase.from("profiles").update(patch).eq("id", profileId), {
      key: `pixel:${Object.keys(patch).sort().join(",")}`,
    });
    if (ok) pulse.show();
  };

  // Secret tokens go through a dedicated route (they're encrypted
  // server-side before storage — see /api/pixels), unlike the plain
  // pixel IDs above which are saved directly the same way every other
  // field in this editor is.
  const saveToken = async (field: "facebookCapiToken" | "tiktokEventsToken", value: string) => {
    if (!value.trim()) return;
    setTokenError("");
    let res: Response | null = null;
    try {
      res = await fetch("/api/pixels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, [field]: value }),
      });
    } catch {
      res = null; // offline / network error
    }
    if (!res || !res.ok) {
      // always the generic message: the server's own wording (which can contain database details) is never shown
      setTokenError(t.editor.pixelTokenSaveError);
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
            aria-label={t.editor.facebookPixelId}
            aria-invalid={fbIdInvalid}
            inputMode="numeric"
            className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
          {fbIdInvalid && <p role="alert" className="text-[11px] text-ringo-coral mt-1">{t.editor.facebookPixelIdInvalid}</p>}
        </div>
        {/* Server-side tracking is optional and technical, so it is grouped; open when already set up. */}
        <Disclosure title={t.editor.advancedServerTracking} hint={t.editor.advancedServerTrackingHint} defaultOpen={fbConfigured || !!testEventCode}>
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
              aria-label={t.editor.facebookCapiToken}
              autoComplete="off"
              className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            />
            <p className="text-[11px] text-ringo-muted mt-1">{t.editor.facebookCapiTokenHint}</p>
          </div>
          <input
            value={testEventCode}
            onChange={(e) => setTestEventCode(e.target.value)}
            onBlur={() => save({ facebook_test_event_code: testEventCode.trim() })}
            placeholder={t.editor.testEventCode}
            aria-label={t.editor.testEventCode}
            className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
        </Disclosure>
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
            aria-label={t.editor.tiktokPixelId}
            aria-invalid={ttIdInvalid}
            className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
          {ttIdInvalid && <p role="alert" className="text-[11px] text-ringo-coral mt-1">{t.editor.tiktokPixelIdInvalid}</p>}
        </div>
        <Disclosure title={t.editor.advancedServerTracking} hint={t.editor.advancedServerTrackingHint} defaultOpen={ttConfigured}>
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
              aria-label={t.editor.tiktokEventsToken}
              autoComplete="off"
              className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            />
            <p className="text-[11px] text-ringo-muted mt-1">{t.editor.tiktokEventsTokenHint}</p>
          </div>
        </Disclosure>
      </div>

      {tokenError && <p role="alert" className="text-xs text-ringo-coral mt-3">{tokenError}</p>}
    </EditorCard>
  );
}
