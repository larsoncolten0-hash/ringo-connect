"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bell, BellOff, CheckCheck, Loader2, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { CustomerNotifications } from "./useCustomerNotifications";
import CustomerAvatar from "./CustomerAvatar";

// The My Ringo bell: a button with an unread count, and a panel listing every notification the
// customer was sent (community announcements, loyalty, bookings), so one that was swiped away or
// missed is still there. Opening the panel never marks anything read; opening an item or "Mark
// all as read" does. State lives in useCustomerNotifications (mounted once by the shell).

const badgeText = (n: number) => (n > 99 ? "99+" : String(n));

export function CustomerBellButton({
  unread,
  onToggle,
  open,
  variant,
}: {
  unread: number;
  onToggle: () => void;
  open: boolean;
  variant: "icon" | "row";
}) {
  const { t } = useLanguage();
  const label = unread > 0 ? `${t.myRingo.bell.label}, ${t.myRingo.bell.unread(unread)}` : t.myRingo.bell.label;

  if (variant === "row") {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ringo-muted transition hover:bg-ringo-muted/10 hover:text-ringo-text"
      >
        <Bell size={18} />
        <span className="flex-1 text-left">{t.myRingo.bell.label}</span>
        {unread > 0 && (
          <span className="min-w-[20px] rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[11px] font-bold leading-none text-white">{badgeText(unread)}</span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-expanded={open}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ringo-text transition hover:bg-ringo-muted/10"
    >
      <Bell size={19} />
      {unread > 0 && (
        <span className="absolute right-0.5 top-0.5 min-w-[17px] rounded-full bg-red-500 px-1 py-0.5 text-center text-[10px] font-bold leading-none text-white ring-2 ring-ringo-surface">
          {badgeText(unread)}
        </span>
      )}
    </button>
  );
}

function timeAgo(iso: string, locale: string): string {
  const diff = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale === "fr" ? "fr" : "en", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "short", year: "numeric" });
}

export function CustomerBellPanel({ state, onClose }: { state: CustomerNotifications; onClose: () => void }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const { items, loading, unread, markRead, markAllRead } = state;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const openItem = (id: string, url: string | null, alreadyRead: boolean) => {
    if (!alreadyRead) markRead([id]);
    onClose();
    if (!url) return;
    try {
      const target = new URL(url, window.location.origin);
      if (target.origin === window.location.origin) router.push(`${target.pathname}${target.search}${target.hash}`);
      else window.location.assign(target.href);
    } catch {
      // Unusable link: the notification is still marked read.
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/30 sm:bg-transparent" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.myRingo.bell.title}
        className="absolute inset-x-0 top-14 flex max-h-[calc(100vh-3.5rem)] flex-col overflow-hidden border-b border-ringo-border bg-ringo-bg shadow-xl sm:inset-x-auto sm:bottom-4 sm:left-64 sm:top-auto sm:max-h-[70vh] sm:w-96 sm:rounded-2xl sm:border"
      >
        <div className="flex items-center justify-between gap-2 border-b border-ringo-border/70 px-4 py-3">
          <h2 className="text-sm font-semibold text-ringo-text">
            {t.myRingo.bell.title}
            {unread > 0 && <span className="ml-2 text-xs font-medium text-ringo-muted">{t.myRingo.bell.unread(unread)}</span>}
          </h2>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-ringo-indigo transition hover:bg-ringo-indigo/10"
              >
                <CheckCheck size={14} />
                {t.myRingo.bell.markAllRead}
              </button>
            )}
            <button type="button" onClick={onClose} aria-label={t.myRingo.bell.close} className="flex h-8 w-8 items-center justify-center rounded-lg text-ringo-muted hover:bg-ringo-muted/10">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {items === null ? (
            <div className="flex justify-center py-10">
              <Loader2 size={18} className="animate-spin text-ringo-muted" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <BellOff size={26} className="text-ringo-muted/60" />
              <p className="text-sm font-medium text-ringo-text">{t.myRingo.bell.emptyTitle}</p>
              <p className="text-xs text-ringo-muted">{t.myRingo.bell.emptyBody}</p>
            </div>
          ) : (
            <ul>
              {items.map((n) => {
                const unreadRow = !n.readAt;
                return (
                  <li key={n.id} className="border-b border-ringo-border/60 last:border-0">
                    <button
                      type="button"
                      onClick={() => openItem(n.id, n.url, !unreadRow)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-ringo-muted/[0.06] ${unreadRow ? "bg-ringo-indigo/[0.06]" : ""}`}
                    >
                      {n.sender ? (
                        <CustomerAvatar name={n.sender.name} avatarUrl={n.sender.avatarUrl} className="h-9 w-9 shrink-0 text-xs" />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ringo-indigo/10 text-ringo-indigo">
                          <Bell size={16} />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        {n.sender && <span className="block truncate text-[11px] font-medium text-ringo-muted">{n.sender.name}</span>}
                        <span className={`block text-sm text-ringo-text ${unreadRow ? "font-semibold" : "font-medium"}`}>{n.title}</span>
                        {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-ringo-muted">{n.body}</span>}
                        <span className="mt-1 block text-[11px] text-ringo-muted/80" suppressHydrationWarning>
                          {timeAgo(n.createdAt, locale)}
                        </span>
                      </span>
                      {unreadRow && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ringo-indigo" aria-hidden="true" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
