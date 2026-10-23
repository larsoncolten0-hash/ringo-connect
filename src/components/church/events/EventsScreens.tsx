"use client";

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import LifecycleEditor from "../lifecycle/LifecycleEditor";
import LifecycleList from "../lifecycle/LifecycleList";
import { BTN_SECONDARY } from "../people/shared";
import { useAnnouncementsConfig, useEventsConfig } from "./configs";

// The four Phase 4 screens: the shared lifecycle list and editor, plugged into the events and announcements configs. The church and the permissions are resolved on the server (the pages) and by
// /api/church/** on every request.
export function EventsList({ caps }: { caps: ChurchCapabilities }) {
  return <LifecycleList config={useEventsConfig()} caps={caps} />;
}
export function EventEditor({ id, caps }: { id?: string; caps: ChurchCapabilities }) {
  const { t } = useLanguage();
  return (
    <LifecycleEditor
      id={id}
      caps={caps}
      config={useEventsConfig()}
      // Phase 7: a published event leads to its (private) attendance for people who may open it
      extra={(meta) =>
        meta.status === "published" && caps.viewAttendance ? (
          <div className="mt-6 border-t border-ringo-border/70 pt-4">
            <Link href={`/dashboard/church/attendance/${meta.id}`} className={BTN_SECONDARY}>
              <ClipboardList size={15} aria-hidden="true" />
              {t.churchEvents.events.attendanceLink}
            </Link>
          </div>
        ) : null
      }
    />
  );
}
export function AnnouncementsList({ caps }: { caps: ChurchCapabilities }) {
  return <LifecycleList config={useAnnouncementsConfig()} caps={caps} />;
}
export function AnnouncementEditor({ id, caps }: { id?: string; caps: ChurchCapabilities }) {
  return <LifecycleEditor id={id} caps={caps} config={useAnnouncementsConfig()} />;
}
