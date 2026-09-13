"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

// The in-app notification feed — backed by the `notifications` table
// (see supabase/migrations/2026-09-12_notifications.sql and
// src/lib/notifications.ts's notifyAdmins/notifyUser, called from e.g.
// /api/admin/requests/[id]/approve and applyPayment.ts). Two audiences
// share this one component: 'admin' (every full admin sees the same
// feed, mounted in AdminShell) and 'user' (one account's own feed,
// mounted in DashboardShell) — RLS on that table is what actually
// enforces who can see/mark-read which rows; this component only picks
// the right filter for its `mode` and otherwise trusts the database.
//
// Distinct from PushNotificationBell (the OS-level Web Push opt-in
// toggle, src/components/PushNotificationBell.tsx) — that one asks for a
// browser permission and enables/disables OS notifications on this one
// device; this one is a persistent, cross-device history of what already
// happened, readable any time whether or not push is enabled at all.
export default function NotificationBell({
  mode,
  userId,
  variant = "default",
}: {
  mode: "user" | "admin";
  userId?: string;
  variant?: "default" | "onDark";
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    if (mode === "user" && !userId) return;
    const supabase = createClient();
    let query = supabase
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    query = mode === "admin" ? query.eq("audience", "admin") : query.eq("audience", "user").eq("user_id", userId as string);

    const { data, error } = await query;
    if (!error) setItems(data || []);
    setLoaded(true);
  }, [mode, userId]);

  // Polls rather than Supabase Realtime — same "no Realtime dependency"
  // posture RestaurantOrderPage.tsx's own status polling already uses,
  // so this works regardless of whether Realtime is enabled on the
  // project. 30s is frequent enough for a notification bell without
  // hammering the database from every open tab.
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = items.filter((n) => !n.read_at).length;

  const markRead = async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    await createClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  };

  const markAllRead = async () => {
    const unreadIds = items.filter((n) => !n.read_at).map((n) => n.id);
    if (unreadIds.length === 0) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    await createClient().from("notifications").update({ read_at: now }).in("id", unreadIds);
  };

  // No account to key a 'user' feed off of yet — nothing to show.
  if (mode === "user" && !userId) return null;

  const iconClass =
    variant === "onDark" ? "text-white/50 hover:text-white hover:bg-white/10" : "text-ringo-muted hover:text-ringo-text hover:bg-ringo-muted/10";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        aria-expanded={open}
        className={`relative w-9 h-9 flex items-center justify-center rounded-full transition ${iconClass}`}
      >
        <Bell size={17} />
        {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-ringo-coral" />}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_8px_30px_-6px_rgba(15,23,42,0.15)] z-50 animate-dropdown-in overflow-hidden text-left">
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-ringo-border/70">
            <p className="text-sm font-medium text-ringo-text">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-ringo-indigo flex items-center gap-1 hover:underline">
                <Check size={12} /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {!loaded ? (
              <p className="text-xs text-ringo-muted text-center py-6">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-xs text-ringo-muted text-center py-6">No notifications yet.</p>
            ) : (
              items.map((n) => (
                <NotificationRowItem key={n.id} notification={n} onOpen={() => { if (!n.read_at) markRead(n.id); setOpen(false); }} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRowItem({ notification: n, onOpen }: { notification: NotificationRow; onOpen: () => void }) {
  const content = (
    <div
      className={`px-3.5 py-3 border-b border-ringo-border/60 last:border-0 transition-colors hover:bg-ringo-muted/[0.05] ${
        n.read_at ? "" : "bg-ringo-indigo/[0.04]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-ringo-text font-medium leading-snug">{n.title}</p>
        {!n.read_at && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-ringo-indigo mt-1.5" />}
      </div>
      {n.body && <p className="text-xs text-ringo-muted mt-0.5">{n.body}</p>}
      <p className="text-[11px] text-ringo-muted/70 mt-1">{relativeTime(n.created_at)}</p>
    </div>
  );

  return n.link ? (
    <Link href={n.link} onClick={onOpen} className="block">
      {content}
    </Link>
  ) : (
    <button onClick={onOpen} className="block w-full text-left">
      {content}
    </button>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
