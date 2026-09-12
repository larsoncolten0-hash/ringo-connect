"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Mail, Phone, UserX, UserCheck, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { createClient } from "@/lib/supabase/client";
import { SUBSCRIBER_STATUS_COLOR } from "@/lib/communityStatus";

// Owner-side status changes go straight through the authenticated browser
// client — RLS ("community_subscribers owner all") already scopes
// correctness, same pattern BookingDetail.tsx uses for bookings.
export default function CommunitySubscriberDetail({ subscriber }: { subscriber: any }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const supabase = createClient();
  const [updating, setUpdating] = useState(false);

  const prefs = subscriber.community_subscription_preferences || {};
  const statusLabel = (s: string) => (t.community as any)[`status${s[0].toUpperCase()}${s.slice(1)}`] || s;
  const sourceLabel = (s: string) =>
    (t.community as any)[`source${s.split("_").map((w: string) => w[0].toUpperCase() + w.slice(1)).join("")}`] || s;

  const setStatus = async (next: "active" | "removed") => {
    if (next === "removed" && !confirm(t.community.deactivateConfirm)) return;
    setUpdating(true);
    await supabase.from("community_subscribers").update({ status: next, updated_at: new Date().toISOString() }).eq("id", subscriber.id);
    setUpdating(false);
    router.refresh();
  };

  const contentPrefs = [
    { key: "notify_products", label: t.community.categoryProduct },
    { key: "notify_music", label: t.community.categoryMusic },
    { key: "notify_events", label: t.community.categoryEvent },
    { key: "notify_announcements", label: t.community.categoryAnnouncement },
    { key: "notify_offers", label: t.community.categoryOffer },
  ];

  return (
    <div className="max-w-2xl flex flex-col gap-4">
      <Link href="/dashboard/community/subscribers" className="flex items-center gap-1.5 text-sm text-ringo-muted hover:text-ringo-text w-fit">
        <ArrowLeft size={15} />
        {t.community.backToSubscribers}
      </Link>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 flex flex-col gap-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-lg font-medium text-ringo-text">{subscriber.name || "—"}</h1>
            <p className="text-xs text-ringo-muted mt-0.5">
              {t.community.subscribedOn} {new Date(subscriber.created_at).toLocaleString(locale)}
            </p>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap ${SUBSCRIBER_STATUS_COLOR[subscriber.status] || ""}`}>
            {statusLabel(subscriber.status)}
          </span>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ringo-muted mb-2">{t.community.contactSection}</p>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2 text-ringo-text">
              <Mail size={14} className="text-ringo-muted shrink-0" />
              {subscriber.email || t.community.noEmailProvided}
            </div>
            <div className="flex items-center gap-2 text-ringo-text">
              <Phone size={14} className="text-ringo-muted shrink-0" />
              {subscriber.phone || t.community.noPhoneProvided}
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ringo-muted mb-2">{t.community.preferencesSection}</p>
          <div className="flex flex-col gap-1.5 text-sm">
            <p className={prefs.email_updates ? "text-ringo-text" : "text-ringo-muted"}>
              {prefs.email_updates ? t.community.emailConsentOn : t.community.emailConsentOff}
            </p>
            <p className={prefs.whatsapp_updates ? "text-ringo-text" : "text-ringo-muted"}>
              {prefs.whatsapp_updates ? t.community.whatsappConsentOn : t.community.whatsappConsentOff}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {contentPrefs.map((c) => (
              <span
                key={c.key}
                className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  prefs[c.key] ? "bg-ringo-indigo/10 text-ringo-indigo" : "bg-ringo-muted/10 text-ringo-muted line-through"
                }`}
              >
                {c.label}
              </span>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ringo-muted mb-2">{t.community.sourceSection}</p>
          <p className="text-sm text-ringo-text">{sourceLabel(subscriber.source)}</p>
        </div>

        <div className="flex justify-end pt-2 border-t border-ringo-border/50">
          {subscriber.status === "removed" ? (
            <button
              onClick={() => setStatus("active")}
              disabled={updating}
              className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors disabled:opacity-50"
            >
              {updating ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
              {t.community.reactivate}
            </button>
          ) : (
            <button
              onClick={() => setStatus("removed")}
              disabled={updating}
              className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-card border border-red-200 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {updating ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />}
              {t.community.deactivate}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
