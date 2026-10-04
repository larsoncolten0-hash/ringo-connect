"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { useLanguage } from "@/components/LanguageProvider";

// Shown while the conversation list or a thread is being fetched. Mirrors the two-pane layout so nothing jumps when content lands.
export default function InboxLoading() {
  const { t } = useLanguage();
  return (
    <div className="loading-reveal flex flex-col gap-4" role="status" aria-busy="true">
      <span className="sr-only">{t.inbox.loading}</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 rounded-card border border-ringo-border p-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
          ))}
        </div>
        <div className="hidden min-h-[320px] rounded-card border border-ringo-border p-4 lg:block">
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
    </div>
  );
}
