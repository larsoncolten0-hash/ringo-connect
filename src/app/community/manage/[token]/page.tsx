"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Public, no login — a subscriber has no Ringo account. The token in the
// URL (community_subscribers.unsubscribe_token) is the only credential;
// see src/app/api/community/manage/[token]/route.ts for how it's resolved
// server-side via the admin client (no anon RLS policy exists on these
// tables at all). Every marketing email links here (see
// renderAnnouncementEmail.ts) for both "Unsubscribe" and "Manage
// preferences" — this one page covers both.
type Prefs = {
  email_updates: boolean;
  whatsapp_updates: boolean;
  notify_products: boolean;
  notify_music: boolean;
  notify_events: boolean;
  notify_announcements: boolean;
  notify_offers: boolean;
};

export default function CommunityManagePage({ params }: { params: { token: string } }) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [notFoundState, setNotFoundState] = useState(false);
  const [creatorName, setCreatorName] = useState("");
  const [status, setStatus] = useState("");
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [unsubscribed, setUnsubscribed] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/community/manage/${params.token}`);
      if (!res.ok) {
        setNotFoundState(true);
        setLoading(false);
        return;
      }
      const data = await res.json();
      setCreatorName(data.creatorName || "");
      setStatus(data.status);
      setPrefs(data.preferences);
      setLoading(false);
    })();
  }, [params.token]);

  const toggle = (key: keyof Prefs) => {
    if (!prefs) return;
    setPrefs({ ...prefs, [key]: !prefs[key] });
    setSaved(false);
  };

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    await fetch(`/api/community/manage/${params.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    });
    setSaving(false);
    setSaved(true);
  };

  const unsubscribeAll = async () => {
    setSaving(true);
    await fetch(`/api/community/manage/${params.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unsubscribe: true }),
    });
    setSaving(false);
    setUnsubscribed(true);
  };

  const inputStyle = { color: "#14202B" } as const;

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 size={20} className="animate-spin" style={{ color: "#9CA3AF" }} />
      </div>
    );
  }

  if (notFoundState) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4" style={inputStyle}>
        <p className="text-sm" style={{ opacity: 0.6 }}>
          {t.communityJoin.linkInvalid}
        </p>
      </div>
    );
  }

  if (unsubscribed) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 text-center gap-3" style={inputStyle}>
        <span className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: "#F3F4F6" }}>
          <Check size={24} style={{ color: "#6B7280" }} />
        </span>
        <p className="text-base font-semibold">{t.communityJoin.unsubscribedTitle}</p>
        <p className="text-sm max-w-xs" style={{ opacity: 0.65 }}>
          {t.communityJoin.unsubscribedBody(creatorName)}
        </p>
      </div>
    );
  }

  const contentPrefs: { key: keyof Prefs; label: string }[] = [
    { key: "notify_products", label: t.community.categoryProduct },
    { key: "notify_music", label: t.community.categoryMusic },
    { key: "notify_events", label: t.community.categoryEvent },
    { key: "notify_announcements", label: t.community.categoryAnnouncement },
    { key: "notify_offers", label: t.community.categoryOffer },
  ];

  return (
    <div className="min-h-screen bg-white px-4 py-10" style={inputStyle}>
      <div className="max-w-md mx-auto flex flex-col gap-5">
        <div>
          <h1 className="font-display text-lg font-bold">{t.communityJoin.managePreferences}</h1>
          {creatorName && (
            <p className="text-sm mt-1" style={{ opacity: 0.65 }}>
              {creatorName}
            </p>
          )}
        </div>

        {prefs && (
          <>
            <div className="rounded-2xl p-4 flex flex-col gap-2.5" style={{ backgroundColor: "#F9FAFB" }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ opacity: 0.6 }}>
                {t.communityJoin.preferencesTitle}
              </p>
              <label className="flex items-center justify-between gap-3 text-sm cursor-pointer">
                {t.communityJoin.consentEmail}
                <input type="checkbox" checked={prefs.email_updates} onChange={() => toggle("email_updates")} className="w-4 h-4" />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm cursor-pointer">
                {t.communityJoin.consentWhatsapp}
                <input type="checkbox" checked={prefs.whatsapp_updates} onChange={() => toggle("whatsapp_updates")} className="w-4 h-4" />
              </label>
            </div>

            <div className="rounded-2xl p-4 flex flex-col gap-2.5 border" style={{ borderColor: "#E5E7EB" }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ opacity: 0.6 }}>
                {t.communityJoin.contentPrefsTitle}
              </p>
              {contentPrefs.map((c) => (
                <label key={c.key} className="flex items-center justify-between gap-3 text-sm cursor-pointer">
                  {c.label}
                  <input type="checkbox" checked={prefs[c.key]} onChange={() => toggle(c.key)} className="w-4 h-4" />
                </label>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-full text-white disabled:opacity-60"
                style={{ backgroundColor: "#4F46E5" }}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {t.communityJoin.savePreferences}
              </button>
              {saved && (
                <span className="text-xs flex items-center gap-1" style={{ color: "#0D9488" }}>
                  <Check size={13} /> {t.community.saved}
                </span>
              )}
            </div>
          </>
        )}

        <button onClick={unsubscribeAll} disabled={saving} className="text-xs underline text-left w-fit" style={{ opacity: 0.5 }}>
          {t.communityJoin.unsubscribeFromEverything}
        </button>
      </div>
    </div>
  );
}
