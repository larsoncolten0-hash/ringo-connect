"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { MessageCircle, X, Send, Loader2, AlertCircle, ArrowUpRight } from "lucide-react";
import RingoAvatar from "@/components/ai/RingoAvatar";
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
  const [unreadCount, setUnreadCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  // Deep link from a support-reply notification (`?support=open`): open the
  // chat panel straight away, then strip the param so a refresh doesn't
  // reopen it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("support") !== "open") return;
    setOpen(true);
    params.delete("support");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
  }, []);

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
      setUnreadCount(0); // GET marks the thread read server-side.
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
        setUnreadCount(data.unread || 0);
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

  // `override` lets a suggested question be sent in one tap (the composer's own draft is untouched in that case)
  const send = async (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || sending) return;
    setSending(true);
    if (override === undefined) setDraft("");
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
              className="absolute bottom-[4.75rem] right-0 w-[calc(100vw-2rem)] max-w-[340px] h-[min(76vh,540px)] rounded-2xl border border-ringo-border/70 bg-ringo-surface shadow-[0_20px_48px_-16px_rgba(15,23,42,0.35)] flex flex-col overflow-hidden z-40"
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-ringo-border/70 bg-[linear-gradient(to_right,rgb(var(--ringo-accent)/0.08),transparent_70%)] shrink-0">
                <RingoAvatar size={38} live />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ringo-text">{t.help.title}</p>
                  <p className="text-xs text-ringo-muted mt-0.5 leading-snug">{t.help.subtitle}</p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="ringo-tactile -mr-2 shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10"
                >
                  <X size={16} />
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
                    <button onClick={fetchThread} className="ringo-tactile inline-flex min-h-[44px] items-center rounded-full border border-ringo-border px-4 text-xs font-semibold text-ringo-text hover:border-ringo-indigo/40">
                      {t.help.retry}
                    </button>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="my-auto flex flex-col gap-4 px-1">
                    <div className="ringo-rise">
                      <p className="font-display text-base font-semibold tracking-[-0.01em] text-ringo-text text-balance">{t.help.emptyTitle}</p>
                      <p className="mt-1 text-xs leading-relaxed text-ringo-muted">{t.help.emptyState}</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ringo-muted">{t.help.suggestionsTitle}</p>
                      {t.help.suggestions.map((q, i) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => send(q)}
                          disabled={sending}
                          style={{ ["--i" as string]: i + 1 }}
                          className="ringo-rise ringo-tactile group flex min-h-[44px] items-center gap-2 rounded-2xl border border-ringo-border/80 px-3.5 py-1.5 text-left text-sm text-ringo-text hover:border-ringo-indigo/50 hover:bg-ringo-indigo/[0.04] disabled:opacity-50"
                        >
                          <span className="min-w-0 flex-1 leading-snug">{q}</span>
                          <ArrowUpRight size={14} aria-hidden="true" className="shrink-0 text-ringo-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`ringo-msg-in max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-snug whitespace-pre-wrap break-words ${
                        m.sender_type === "user"
                          ? "self-end bg-ringo-indigo text-white rounded-br-md shadow-[0_4px_12px_-6px_rgb(var(--ringo-accent)/0.55)]"
                          : "self-start border border-ringo-border/50 bg-ringo-muted/[0.08] text-ringo-text rounded-bl-md"
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
                className="p-3 border-t border-ringo-border/70 shrink-0"
              >
               <div className="flex items-end gap-1 rounded-[26px] border border-ringo-border bg-ringo-bg p-1.5 transition-colors focus-within:border-ringo-indigo/60 focus-within:ring-2 focus-within:ring-ringo-indigo/20">
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
                  aria-label={t.help.placeholder}
                  rows={1}
                  disabled={sending}
                  className="min-h-[44px] flex-1 resize-none bg-transparent px-2.5 py-[11px] text-sm text-ringo-text placeholder:text-ringo-muted focus:outline-none max-h-24 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || sending}
                  aria-label={t.help.send}
                  aria-busy={sending}
                  className="ringo-tactile ringo-cta shrink-0 w-11 h-11 rounded-full flex items-center justify-center"
                >
                  {sending ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> : <Send size={16} />}
                </button>
               </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `${t.help.button}, ${unreadCount > 99 ? "99+" : unreadCount} unread` : t.help.button}
        className="ringo-tactile ringo-cta relative w-16 h-16 rounded-2xl flex flex-col items-center justify-center gap-0.5"
      >
        {open ? (
          <X size={20} />
        ) : (
          <>
            <MessageCircle size={20} />
            <span className="text-[9px] font-semibold leading-none">{t.help.button}</span>
            <AnimatePresence>
              {unreadCount > 0 && (
                <motion.span
                  key={unreadCount}
                  initial={shouldReduceMotion ? false : { scale: 1.35, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 22 }}
                  className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-ringo-coral text-white text-[10px] font-semibold flex items-center justify-center leading-none ring-2 ring-ringo-surface"
                  aria-hidden="true"
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </motion.span>
              )}
            </AnimatePresence>
          </>
        )}
      </button>
    </div>
  );
}
