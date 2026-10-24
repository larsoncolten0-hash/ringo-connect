"use client";

import { useMemo } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { safeHttpsUrl } from "@/lib/church/lifecycle/validation";
import { announcementEnd } from "@/lib/church/week";
import type { PublicAnnouncement, PublicEvent } from "@/lib/church/public/events";
import { ChurchAnnouncementsCard, ChurchEventsCard } from "../ChurchEventsCards";
import type { FieldDef, FormValues, LifecycleConfig } from "../lifecycle/types";

// The Events and Announcements screens are the shared lifecycle list / editor (src/components/church/lifecycle) with these two configs: which fields, when a language is ready to publish, and the public
// card drawn in the preview. The texts live in translations (churchEvents).

const PREVIEW_ID = "00000000-0000-4000-8000-000000000000";
const THEME = { accent: "#4F46E5", accentText: "#4338CA", textColor: "#14110A", borderTint: "rgba(20,17,10,0.12)", radiusClass: "rounded-2xl" };
const s = (form: FormValues, k: string): string => (typeof form[k] === "string" ? (form[k] as string) : "");
const filled = (v: string) => v.trim() !== "";
const orNull = (v: string): string | null => (filled(v) ? v : null);

const EVENT_FIELDS: FieldDef[] = [
  { key: "event_date", kind: "date" },
  { key: "start_time", kind: "time", optional: true },
  { key: "end_time", kind: "time", optional: true },
  { key: "is_cancelled", kind: "checkbox" },
  { key: "venue", kind: "text", max: 160, optional: true },
  { key: "address", kind: "text", max: 240, optional: true },
  { key: "online_url", kind: "url", max: 500, optional: true },
  { key: "title", bilingual: true, kind: "text", max: 120 },
  { key: "description", bilingual: true, kind: "textarea", max: 2000, rows: 6, optional: true },
];
const ANNOUNCEMENT_FIELDS: FieldDef[] = [
  { key: "expires_on", kind: "date", presets: "announcement" },
  { key: "title", bilingual: true, kind: "text", max: 120 },
  { key: "body", bilingual: true, kind: "textarea", max: 2000, rows: 7 },
];

export function useEventsConfig(): LifecycleConfig {
  const { t } = useLanguage();
  return useMemo<LifecycleConfig>(
    () => ({
      apiPath: "/api/church/events",
      pagePath: "/dashboard/church/events",
      idPrefix: "ce",
      texts: t.churchEvents.events,
      views: ["all", "drafts", "upcoming", "past"],
      fields: EVENT_FIELDS,
      ready: (form, lang) => filled(s(form, `title_${lang}`)),
      blank: (today) => ({ event_date: today, start_time: "", end_time: "", is_cancelled: false, venue: "", address: "", online_url: "", title_en: "", title_fr: "", description_en: "", description_fr: "" }),
      renderPreview: (form, lang, tr) => {
        const e: PublicEvent = {
          id: PREVIEW_ID,
          event_date: s(form, "event_date") || new Date().toISOString().slice(0, 10),
          start_time: orNull(s(form, "start_time")),
          end_time: orNull(s(form, "end_time")),
          title_en: orNull(s(form, "title_en")), title_fr: orNull(s(form, "title_fr")),
          description_en: orNull(s(form, "description_en")), description_fr: orNull(s(form, "description_fr")),
          venue: orNull(s(form, "venue")),
          address: orNull(s(form, "address")),
          online_url: safeHttpsUrl(s(form, "online_url")),
          is_cancelled: form.is_cancelled === true,
        };
        return <ChurchEventsCard t={tr} locale={lang} events={[e]} {...THEME} />;
      },
      subline: (row, locale, formatDay) => {
        const c = t.churchEvents.events.list;
        const parts = [formatDay(row.event_date, locale)];
        if (row.start_time) parts[0] += ` ${c.at(row.start_time)}`;
        if (row.venue) parts.push(row.venue);
        return parts.join(" · ");
      },
      rowTitle: (row, locale) => (locale === "fr" ? row.title_fr || row.title_en : row.title_en || row.title_fr) || "",
      stateTone: { draft: "inactive", upcoming: "active", past: "pending" },
      caps: { view: (c) => c.viewEvents, manage: (c) => c.manageEvents, publish: (c) => c.publishEvents },
      extraBadges: (row) => (row.is_cancelled ? [t.churchEvents.events.list.cancelled] : []),
    }),
    [t]
  );
}

export function useAnnouncementsConfig(): LifecycleConfig {
  const { t } = useLanguage();
  return useMemo<LifecycleConfig>(
    () => ({
      apiPath: "/api/church/announcements",
      pagePath: "/dashboard/church/announcements",
      idPrefix: "ca",
      texts: t.churchEvents.announcements,
      views: ["all", "drafts", "published", "expired"],
      fields: ANNOUNCEMENT_FIELDS,
      ready: (form, lang) => filled(s(form, `title_${lang}`)) && filled(s(form, `body_${lang}`)),
      // a new announcement defaults to "This week": it leaves the public page on Sunday at midnight unless the church chooses a month, a year or a date
      blank: (today) => ({ expires_on: announcementEnd("week", today) ?? "", title_en: "", title_fr: "", body_en: "", body_fr: "" }),
      renderPreview: (form, lang, tr) => {
        const a: PublicAnnouncement = {
          id: PREVIEW_ID,
          title_en: orNull(s(form, "title_en")), title_fr: orNull(s(form, "title_fr")),
          body_en: orNull(s(form, "body_en")), body_fr: orNull(s(form, "body_fr")),
          expires_on: orNull(s(form, "expires_on")),
        };
        return <ChurchAnnouncementsCard t={tr} locale={lang} announcements={[a]} {...THEME} />;
      },
      subline: (row, locale, formatDay) => {
        const c = t.churchEvents.announcements.list;
        return row.expires_on ? c.until(formatDay(row.expires_on, locale)) : c.noEnd;
      },
      rowTitle: (row, locale) => (locale === "fr" ? row.title_fr || row.title_en : row.title_en || row.title_fr) || "",
      stateTone: { draft: "inactive", published: "active", expired: "pending" },
      caps: { view: (c) => c.viewEvents, manage: (c) => c.manageEvents, publish: (c) => c.publishEvents },
    }),
    [t]
  );
}
