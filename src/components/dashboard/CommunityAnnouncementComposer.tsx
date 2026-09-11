"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { createClient } from "@/lib/supabase/client";
import ImageUploadField from "@/components/editor/ImageUploadField";
import SavedPulse, { useSavedPulse } from "@/components/editor/SavedPulse";

// Draft save/edit goes straight through the authenticated browser client
// (RLS: "community_announcements owner all" already scopes this, same
// pattern CatalogCard/BookingSettingsCard use for their own writes).
// Sending is the one action that has to go through a server route (needs
// the email provider's secret key + a cross-subscriber fan-out) — see
// /api/community/announcements/[id]/send.
export default function CommunityAnnouncementComposer({
  profileId,
  userId,
  announcement,
  products,
  tracks,
  events,
}: {
  profileId: string;
  userId: string;
  announcement: any | null;
  products: any[];
  tracks: any[];
  events: any[];
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const supabase = createClient();
  const pulse = useSavedPulse();

  const [id, setId] = useState<string | null>(announcement?.id || null);
  const [status, setStatus] = useState<string>(announcement?.status || "draft");
  const [title, setTitle] = useState(announcement?.title || "");
  const [message, setMessage] = useState(announcement?.message || "");
  const [imageUrl, setImageUrl] = useState<string | null>(announcement?.image_url || null);
  const [linkType, setLinkType] = useState(announcement?.link_type || "none");
  const [linkUrl, setLinkUrl] = useState(announcement?.link_url || "");
  const [linkRefId, setLinkRefId] = useState(announcement?.link_ref_id || "");
  const [audience, setAudience] = useState(announcement?.audience === "whatsapp" ? "all" : announcement?.audience || "all");
  const [category, setCategory] = useState(announcement?.notification_category || "announcement");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [recipientEstimate, setRecipientEstimate] = useState<number | null>(null);
  const [sendResult, setSendResult] = useState<{ sentCount: number; recipientCount: number; providerConfigured: boolean } | null>(null);

  const readOnly = status === "sent" || status === "sending";
  const notifyColumn: Record<string, string> = {
    announcement: "notify_announcements",
    product: "notify_products",
    music: "notify_music",
    event: "notify_events",
    offer: "notify_offers",
  };

  // Live estimate of who'd actually receive this — recomputed whenever the
  // targeting inputs change, read straight from Supabase under the owner's
  // own RLS (no extra API route needed for a read like this).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("community_subscribers")
        .select(`id, community_subscription_preferences!inner(*)`, { count: "exact", head: true })
        .eq("profile_id", profileId)
        .eq("status", "active")
        .eq("community_subscription_preferences.email_updates", true)
        .eq(`community_subscription_preferences.${notifyColumn[category] || "notify_announcements"}`, true);
      if (!cancelled) setRecipientEstimate(count ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, category, audience]);

  const saveDraft = async (): Promise<string | null> => {
    setError("");
    if (!title.trim()) {
      setError(t.community.titleRequired);
      return null;
    }
    if (!message.trim()) {
      setError(t.community.messageRequired);
      return null;
    }
    setSaving(true);
    const payload = {
      profile_id: profileId,
      title: title.trim(),
      message: message.trim(),
      image_url: imageUrl,
      link_type: linkType,
      link_url: linkType === "custom" ? linkUrl.trim() || null : null,
      link_ref_id: ["product", "music", "event"].includes(linkType) ? linkRefId || null : null,
      audience,
      notification_category: category,
      updated_at: new Date().toISOString(),
    };

    let savedId = id;
    if (id) {
      await supabase.from("community_announcements").update(payload).eq("id", id);
    } else {
      const { data, error: insertError } = await supabase.from("community_announcements").insert(payload).select("id").single();
      if (insertError || !data) {
        setError(t.community.titleRequired);
        setSaving(false);
        return null;
      }
      savedId = data.id;
      setId(savedId);
      router.replace(`/dashboard/community/announcements/new?id=${savedId}`);
    }
    setSaving(false);
    pulse.show();
    return savedId;
  };

  const confirmSend = async () => {
    const savedId = id || (await saveDraft());
    if (!savedId) return;
    setShowSendConfirm(true);
  };

  const doSend = async () => {
    setShowSendConfirm(false);
    setSending(true);
    setError("");
    try {
      const res = await fetch(`/api/community/announcements/${id}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t.community.providerNotConfigured);
        return;
      }
      setStatus(data.status);
      setSendResult({ sentCount: data.sentCount, recipientCount: data.recipientCount, providerConfigured: data.providerConfigured });
    } catch {
      setError(t.community.providerNotConfigured);
    } finally {
      setSending(false);
    }
  };

  const refOptions = linkType === "product" ? products : linkType === "music" ? tracks : linkType === "event" ? events : [];
  const refLabel = (r: any) => r.name || r.title;

  return (
    <div className="max-w-2xl flex flex-col gap-4">
      <Link href="/dashboard/community/announcements" className="flex items-center gap-1.5 text-sm text-ringo-muted hover:text-ringo-text w-fit">
        <ArrowLeft size={15} />
        {t.community.backToAnnouncements}
      </Link>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 flex flex-col gap-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {error && <p className="text-sm px-3.5 py-2.5 rounded-card bg-red-50 text-red-700">{error}</p>}

        {sendResult && (
          <p className="text-sm px-3.5 py-2.5 rounded-card bg-ringo-teal/10 text-ringo-teal">
            {sendResult.providerConfigured
              ? t.community.sentSummary(sendResult.sentCount, sendResult.recipientCount)
              : t.community.providerNotConfigured}
          </p>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ringo-text">{t.community.titleLabel}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.community.titlePlaceholder}
            disabled={readOnly}
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text disabled:opacity-60"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ringo-text">{t.community.messageLabel}</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t.community.messagePlaceholder}
            rows={4}
            disabled={readOnly}
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text resize-none disabled:opacity-60"
          />
        </label>

        <div>
          <span className="text-xs font-medium text-ringo-text block mb-1.5">{t.community.imageLabel}</span>
          <ImageUploadField value={imageUrl} onChange={setImageUrl} userId={userId} folder="community" shape="square" size={88} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ringo-text">{t.community.linkLabel}</span>
            <select
              value={linkType}
              onChange={(e) => {
                setLinkType(e.target.value);
                setLinkRefId("");
              }}
              disabled={readOnly}
              className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text disabled:opacity-60"
            >
              <option value="none">{t.community.linkTypeNone}</option>
              <option value="custom">{t.community.linkTypeCustom}</option>
              <option value="product">{t.community.linkTypeProduct}</option>
              <option value="music">{t.community.linkTypeMusic}</option>
              <option value="event">{t.community.linkTypeEvent}</option>
              <option value="booking">{t.community.linkTypeBooking}</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ringo-text">{t.community.categoryLabel}</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={readOnly}
              className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text disabled:opacity-60"
            >
              <option value="announcement">{t.community.categoryAnnouncement}</option>
              <option value="product">{t.community.categoryProduct}</option>
              <option value="music">{t.community.categoryMusic}</option>
              <option value="event">{t.community.categoryEvent}</option>
              <option value="offer">{t.community.categoryOffer}</option>
            </select>
          </label>
        </div>

        {linkType === "custom" && (
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder={t.community.linkUrlPlaceholder}
            disabled={readOnly}
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text disabled:opacity-60"
          />
        )}
        {["product", "music", "event"].includes(linkType) && (
          <select
            value={linkRefId}
            onChange={(e) => setLinkRefId(e.target.value)}
            disabled={readOnly}
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text disabled:opacity-60"
          >
            <option value="">—</option>
            {refOptions.map((r: any) => (
              <option key={r.id} value={r.id}>
                {refLabel(r)}
              </option>
            ))}
          </select>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ringo-text">{t.community.audienceLabel}</span>
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            disabled={readOnly}
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text disabled:opacity-60 max-w-xs"
          >
            <option value="all">{t.community.audienceAll}</option>
            <option value="email">{t.community.audienceEmail}</option>
          </select>
        </label>

        {recipientEstimate !== null && !readOnly && (
          <p className="text-xs text-ringo-muted">{t.community.sendConfirmBody(recipientEstimate)}</p>
        )}

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-ringo-border/50">
            <button
              onClick={saveDraft}
              disabled={saving}
              className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {t.community.saveDraft}
            </button>
            <button
              onClick={() => setShowPreview((v) => !v)}
              className="text-sm font-medium px-4 py-2 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors"
            >
              {t.community.preview}
            </button>
            <Link
              href="/dashboard/community/announcements"
              className="text-sm font-medium px-4 py-2 rounded-card text-ringo-muted hover:text-ringo-text transition-colors"
            >
              {t.community.cancel}
            </Link>
            <button
              onClick={confirmSend}
              disabled={sending}
              className="ml-auto flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-card bg-ringo-indigo text-white hover:brightness-110 transition disabled:opacity-50"
            >
              {sending && <Loader2 size={14} className="animate-spin" />}
              {t.community.sendAnnouncement}
            </button>
            <SavedPulse visible={pulse.visible} label={t.community.saved} />
          </div>
        )}
      </div>

      {showPreview && (
        <div className="rounded-card border border-ringo-border/70 bg-ringo-bg p-5 max-w-sm mx-auto w-full">
          <div className="rounded-2xl bg-white shadow-sm p-5 text-center" style={{ color: "#111827" }}>
            <p className="text-[15px] font-bold">{title || t.community.titlePlaceholder}</p>
            {imageUrl && <img src={imageUrl} alt="" className="w-full rounded-xl my-3" />}
            <p className="text-sm text-left whitespace-pre-wrap mt-2" style={{ color: "#374151" }}>
              {message || t.community.messagePlaceholder}
            </p>
          </div>
        </div>
      )}

      {showSendConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSendConfirm(false)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-5" style={{ color: "#14202B" }}>
            <p className="font-semibold mb-1.5">{t.community.sendConfirmTitle}</p>
            <p className="text-sm mb-4" style={{ opacity: 0.75 }}>
              {t.community.sendConfirmBody(recipientEstimate ?? 0)}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSendConfirm(false)} className="text-sm font-medium px-4 py-2 rounded-full" style={{ opacity: 0.7 }}>
                {t.community.cancel}
              </button>
              <button onClick={doSend} className="text-sm font-semibold px-4 py-2 rounded-full text-white bg-ringo-indigo">
                {t.community.confirmSend}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
