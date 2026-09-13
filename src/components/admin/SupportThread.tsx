"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Send, Loader2, AlertCircle } from "lucide-react";

type ChatMessage = { id: string; sender_type: "user" | "admin"; body: string; created_at: string };

// One conversation's thread, from the admin side — mirrors
// src/components/dashboard/HelpWidget.tsx's own message list/composer,
// just with the bubble sides flipped (an admin's own replies are the
// ones on the right here). Polls every 3s while mounted, i.e. while this
// conversation is the one open in SupportInboxView.tsx.
export default function SupportThread({
  conversationId,
  title,
  onBack,
}: {
  conversationId: string;
  title: string;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const fetchThread = async () => {
    try {
      const res = await fetch(`/api/admin/support/${conversationId}/messages`);
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      setMessages(data.messages || []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    fetchThread();
    const interval = setInterval(fetchThread, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    try {
      const res = await fetch(`/api/admin/support/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) throw new Error("send failed");
      const data = await res.json();
      setMessages((prev) => [...prev, data.message]);
      setLoadError(false);
    } catch {
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-ringo-border/70 shrink-0">
        <button onClick={onBack} aria-label="Back" className="lg:hidden shrink-0 -ml-1 w-7 h-7 flex items-center justify-center text-ringo-muted">
          <ArrowLeft size={16} />
        </button>
        <p className="text-sm font-semibold text-ringo-text truncate">{title}</p>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3.5 flex flex-col gap-2">
        {!loaded ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-ringo-muted" />
          </div>
        ) : loadError ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
            <AlertCircle size={18} className="text-ringo-coral" />
            <p className="text-xs text-ringo-muted">Couldn't load this conversation.</p>
            <button onClick={fetchThread} className="text-xs font-medium text-ringo-indigo hover:underline">
              Try again
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center px-6">
            <p className="text-xs text-ringo-muted leading-relaxed">No messages yet.</p>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap break-words ${
                m.sender_type === "admin"
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
        className="flex items-end gap-2 p-3.5 border-t border-ringo-border/70 shrink-0"
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
          placeholder="Write a reply…"
          rows={1}
          disabled={sending}
          className="flex-1 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text resize-none max-h-28 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          aria-label="Send"
          className="shrink-0 w-9 h-9 rounded-full bg-ringo-indigo text-white flex items-center justify-center transition disabled:opacity-40 active:scale-95"
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
        </button>
      </form>
    </>
  );
}
