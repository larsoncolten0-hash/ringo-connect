"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, X, Send, Loader2, AlertCircle } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import MenuBackdrop from "@/components/ui/MenuBackdrop";

type ChatMessage = { id: string; sender_type: "user" | "admin"; body: string; created_at: string };

// A floating two-way chat with the admin team on every dashboard page —
// backed by support_conversations/support_messages (see
// 2026-09-27_support_chat.sql and src/app/api/support/messages/route.ts).
// One ongoing thread per account; admins read/reply from
// src/app/admin/support (SupportInboxView.tsx). Both sides also get an
// in-app notification-bell entry and a push notification the moment the
// other side sends something (see that API route and its admin-side
// mirror) — this widget itself only needs to poll for the thread
// content, not for "did something happen."
//
// Polls rather than subscribing to Supabase Realtime — same "no Realtime
// dependency" posture every other live view in this app already uses
// (see RestaurantOrdersView.tsx's own comment on why): every 3s while
// the panel is open (closer to an actual chat's expectations than the
// 4-6s this app uses for order boards), and a slower 20s check while
// closed just to light the launcher's unread dot.
export default function HelpWidget({ username, email }: { username: string; email: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [unread, setUnread] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const fetchThread = async () => {
    try {
      const res = await fetch("/api/support/messages");
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      setMessages(data.messages || []);
      setUnread(false); // GET marks the thread read server-side.
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  };

  // Fast poll while the panel is open — a real conversation, not a
  // dashboard list, so it gets a tighter interval than this app's other
  // "live" polls.
  useEffect(() => {
    if (!open) return;
    fetchThread();
    const interval = setInterval(fetchThread, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Slow background check while closed, just for the launcher's unread
  // dot — a lightweight nudge to open the panel, not a live feed.
  useEffect(() => {
    if (open) return;
    const check = async () => {
      try {
        // `peek=1` is load-bearing here, not just an optimization: the
        // plain GET marks the thread read as a side effect, which would
        // clear this very dot before the user ever opened the panel to
        // see it.
        const res = await fetch("/api/support/messages?peek=1");
        if (!res.ok) return;
        const data = await res.json();
        setMessages(data.messages || []);
        setLoaded(true);
        setUnread((data.unread || 0) > 0);
      } catch {
        // Silent — this is a background convenience check, not a load
        // the user is waiting on.
      }
    };
    check();
    const interval = setInterval(check, 20000);
    return () => clearInterval(interval);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    try {
      const res = await fetch("/api/support/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) throw new Error("send failed");
      const data = await res.json();
      setMessages((prev) => [...prev, data.message]);
      setLoadError(false);
    } catch {
      // Give the draft back so nothing typed is lost.
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed bottom-36 right-4 lg:bottom-6 lg:right-6 z-40" ref={panelRef}>
      <AnimatePresence>
        {open && (
          <>
            <MenuBackdrop key="backdrop" onClose={() => setOpen(false)} className="z-30" topClassName="top-16" />
            <motion.div
              key="panel"
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-[4.75rem] right-0 w-[calc(100vw-2rem)] max-w-[340px] h-[min(70vh,480px)] rounded-2xl border border-ringo-border/70 bg-ringo-surface shadow-[0_20px_48px_-16px_rgba(15,23,42,0.35)] flex flex-col overflow-hidden z-40"
            >
              <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-ringo-border/70 shrink-0">
                <div>
                  <p className="text-sm font-semibold text-ringo-text">{t.help.title}</p>
                  <p className="text-xs text-ringo-muted mt-0.5">{t.help.subtitle}</p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10 transition"
                >
                  <X size={13} />
                </button>
              </div>

              <div ref={listRef} className="flex-1 overflow-y-auto px-3.5 py-3 flex flex-col gap-2">
                {!loaded ? (
                  <div className="flex-1 flex items-center justify-center">
                    <Loader2 size={18} className="animate-spin text-ringo-muted" />
                  </div>
                ) : loadError ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
                    <AlertCircle size={18} className="text-ringo-coral" />
                    <p className="text-xs text-ringo-muted">{t.help.loadError}</p>
                    <button onClick={fetchThread} className="text-xs font-medium text-ringo-indigo hover:underline">
                      {t.help.retry}
                    </button>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-center px-6">
                    <p className="text-xs text-ringo-muted leading-relaxed">{t.help.emptyState}</p>
                  </div>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap break-words ${
                        m.sender_type === "user"
                          ? "self-end bg-ringo-indigo text-white rounded-br-md"
                          : "self-start bg-ringo-muted/10 text-ringo-text rounded-bl-md"
                      }`}
                    >
                      {m.body}
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
                className="flex items-end gap-2 p-3 border-t border-ringo-border/70 shrink-0"
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={t.help.placeholder}
                  rows={1}
                  disabled={sending}
                  className="flex-1 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text resize-none max-h-24 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || sending}
                  aria-label={t.help.send}
                  className="shrink-0 w-9 h-9 rounded-full bg-ringo-indigo text-white flex items-center justify-center transition disabled:opacity-40 active:scale-95"
                >
                  {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
                </button>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t.help.button}
        className="relative w-16 h-16 rounded-2xl bg-ringo-indigo text-white flex flex-col items-center justify-center gap-0.5 shadow-[0_10px_28px_-8px_rgba(79,70,229,0.55)] transition hover:-translate-y-0.5 active:scale-95"
      >
        {open ? (
          <X size={20} />
        ) : (
          <>
            <MessageCircle size={20} />
            <span className="text-[9px] font-semibold leading-none">{t.help.button}</span>
            {unread && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-ringo-coral ring-2 ring-ringo-surface" aria-hidden />
            )}
          </>
        )}
      </button>
    </div>
  );
}
