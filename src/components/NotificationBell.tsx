"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

function timeAgo(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Notification bell shared by AdminShell (mode="admin" — every full admin
 * sees the same broadcast rows) and DashboardShell (mode="user" — a
 * creator, including a "super creator", sees only their own). Both modes
 * read through the regular RLS-scoped client (see the matching policies in
 * supabase/migrations/2026-09-12_notifications.sql) — nothing here needs
 * the service-role client since it never writes, only reads and marks read.
 *
 * Polls rather than subscribing to realtime changes — simple, and "up to
 * 30s stale" is fine for a request queue nobody needs to react to
 * instantly.
 */
export default function NotificationBell({
  mode,
  userId,
  variant = "default",
}: {
  mode: "admin" | "user";
  userId?: string;
  variant?: "default" | "onDark";
}) {
  const supabase = createClient();
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    let query = supabase
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(15);
    query = mode === "admin" ? query.eq("audience", "admin") : query.eq("audience", "user").eq("user_id", userId);
    const { data } = await query;
    setItems(data || []);
  };

  useEffect(() => {
    if (mode === "user" && !userId) return;
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, userId]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const unreadCount = items.filter((n) => !n.read_at).length;

  const markRead = async (n: Notification) => {
    if (!n.read_at) {
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i)));
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  const markAllRead = async () => {
    const unreadIds = items.filter((n) => !n.read_at).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setItems((prev) => prev.map((i) => (i.read_at ? i : { ...i, read_at: new Date().toISOString() })));
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", unreadIds);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className={`relative w-9 h-9 flex items-center justify-center rounded-full transition ${
          variant === "onDark"
            ? "text-white/50 hover:text-white hover:bg-white/10"
            : "text-ringo-muted hover:text-ringo-text hover:bg-ringo-muted/10"
        }`}
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-ringo-coral text-white text-[10px] font-medium flex items-center justify-center leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-card border border-ringo-border bg-ringo-surface shadow-lg z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-ringo-border">
            <p className="text-sm font-medium text-ringo-text">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-ringo-indigo font-medium">
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-ringo-muted text-center py-8">Nothing yet.</p>
          ) : (
            <div className="flex flex-col">
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markRead(n)}
                  className={`text-left px-4 py-3 border-b border-ringo-border/50 last:border-0 hover:bg-ringo-muted/5 transition-colors ${
                    !n.read_at ? "bg-ringo-indigo/5" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read_at && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-ringo-indigo shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm text-ringo-text font-medium truncate">{n.title}</p>
                      {n.body && <p className="text-xs text-ringo-muted mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-[10px] text-ringo-muted/70 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
