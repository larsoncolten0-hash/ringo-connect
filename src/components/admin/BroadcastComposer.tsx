"use client";

import { useState } from "react";
import { Send, Loader2, Check, Radio } from "lucide-react";

// "Message notifications from Ringo Connect itself" — the platform-wide
// push broadcast, sent from here to /api/admin/broadcast. Two audiences:
// every fan across every creator's community, or every creator/admin
// account — see that route's own comment.
export default function BroadcastComposer() {
  const [audience, setAudience] = useState<"subscribers" | "users">("subscribers");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    setError("");
    if (!title.trim() || !body.trim()) {
      setError("Title and message are required.");
      return;
    }
    setSending(true);
    setSent(false);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience, title: title.trim(), body: body.trim(), url: url.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Could not send the broadcast.");
        return;
      }
      setSent(true);
      setTitle("");
      setBody("");
      setUrl("");
    } catch {
      setError("Could not send the broadcast.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-xl flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text tracking-[-0.01em] flex items-center gap-2">
          <Radio size={18} className="text-ringo-indigo" />
          Broadcast
        </h1>
        <p className="text-sm text-ringo-muted mt-1">
          Send an OS-level push notification to every subscriber (or every creator/admin) who has notifications
          enabled. Delivered instantly — there's no draft/schedule step, so double-check before sending.
        </p>
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col gap-4">
        <div>
          <p className="text-xs text-ringo-muted mb-1.5">Audience</p>
          <div className="flex items-center gap-1 bg-ringo-muted/10 rounded-full p-1 w-fit">
            {(
              [
                ["subscribers", "Fans (all creators)"],
                ["users", "Creators & admins"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setAudience(id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  audience === id ? "bg-ringo-surface text-ringo-text shadow-sm" : "text-ringo-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ringo-muted">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. New feature: Ringo Cards"
            maxLength={120}
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ringo-muted">Message</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What do you want them to know?"
            maxLength={500}
            rows={3}
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text resize-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ringo-muted">Link (optional — opened when the notification is tapped)</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="/dashboard or https://…"
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
        </label>

        {error && <p className="text-xs text-ringo-coral">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={send}
            disabled={sending}
            className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-full bg-ringo-indigo text-white disabled:opacity-60"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {sending ? "Sending…" : "Send broadcast"}
          </button>
          {sent && (
            <span className="text-xs flex items-center gap-1 text-ringo-teal">
              <Check size={13} /> Sent
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
