"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { useLanguage } from "@/components/LanguageProvider";

// Shown while the conversation list or a thread is being fetched. Mirrors the two-pane layout (same widths, same fixed height, same free column on the right) and the shape of a
// conversation (header, message bubbles on both sides, reply box), so nothing jumps when the content lands.
export default function InboxLoading() {
  const { t } = useLanguage();
  return (
    <div className="loading-reveal flex flex-col gap-4 lg:pr-16" role="status" aria-busy="true">
      <span className="sr-only">{t.inbox.loading}</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="grid grid-rows-[minmax(0,1fr)] gap-4 lg:h-[calc(100dvh-13rem)] lg:min-h-[480px] lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 rounded-card border border-ringo-border p-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
          ))}
        </div>
        <div className="hidden min-h-[320px] flex-col overflow-hidden rounded-card border border-ringo-border lg:flex">
          <div className="flex items-center gap-3 border-b border-ringo-border px-4 py-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 px-5 py-4">
            <Skeleton className="h-10 w-2/5 rounded-2xl" />
            <Skeleton className="ml-auto h-14 w-1/2 rounded-2xl" />
            <Skeleton className="h-10 w-1/3 rounded-2xl" />
            <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
          </div>
          <div className="flex items-center gap-2 border-t border-ringo-border px-4 py-2.5">
            <Skeleton className="h-11 w-11 rounded-full" />
            <Skeleton className="h-11 flex-1 rounded-2xl" />
            <Skeleton className="h-11 w-11 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
