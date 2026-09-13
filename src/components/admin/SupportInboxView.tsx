"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MessageCircle } from "lucide-react";
import SupportThread from "@/components/admin/SupportThread";
import type { AdminConversationSummary } from "@/lib/support";

// The admin support inbox — every creator's thread with the admin team,
// list on the left / open thread on the right (mobile: list, then the
// thread replaces it, with a back button — no split pane at that width).
// A `?c=<conversationId>` query param (set by the link a new-message
// notification points to, see src/app/api/support/messages/route.ts)
// auto-opens that conversation on load.
//
// Polls the list every 5s for new/updated conversations — same "no
// Realtime dependency" posture as everywhere else (see
// RestaurantOrdersView.tsx) — while SupportThread.tsx polls the open
// conversation itself faster (3s), since that's the pane someone's
// actually watching.
export default function SupportInboxView({ initialConversations }: { initialConversations: AdminConversationSummary[] }) {
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("c"));

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/admin/support/conversations");
        if (!res.ok) return;
        const data = await res.json();
        setConversations(data.conversations || []);
      } catch {
        // Silent — a missed refresh just means slightly stale previews
        // until the next tick.
      }
    };
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  // Clears the just-opened conversation's unread flag locally right away
  // — SupportThread's own GET marks it read server-side, but that
  // response doesn't flow back into this list, so without this the badge
  // would linger for up to 5s until the next list poll.
  const openConversation = (id: string) => {
    setSelectedId(id);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: false } : c)));
  };

  const selected = conversations.find((c) => c.id === selectedId);

  return (
    <div className="flex h-[calc(100vh-8rem)] lg:h-[calc(100vh-6rem)] rounded-card border border-ringo-border/70 bg-ringo-surface overflow-hidden">
      <div className={`w-full lg:w-80 shrink-0 border-r border-ringo-border/70 flex-col overflow-y-auto ${selectedId ? "hidden lg:flex" : "flex"}`}>
        <div className="px-4 py-3.5 border-b border-ringo-border/70">
          <h1 className="text-sm font-semibold text-ringo-text">Support</h1>
          <p className="text-xs text-ringo-muted mt-0.5">Creators' messages to the admin team</p>
        </div>

        {conversations.length === 0 ? (
          <p className="text-xs text-ringo-muted text-center py-10 px-4">No conversations yet.</p>
        ) : (
          conversations.map((c) => {
            const name = c.username ? `@${c.username}` : c.email || "Unknown";
            const initial = (c.username || c.email || "?")[0]?.toUpperCase();
            return (
              <button
                key={c.id}
                onClick={() => openConversation(c.id)}
                className={`flex items-center gap-2.5 px-4 py-3 border-b border-ringo-border/60 last:border-0 text-left transition-colors ${
                  c.id === selectedId ? "bg-ringo-indigo/10" : "hover:bg-ringo-muted/10"
                }`}
              >
                <span className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center bg-ringo-indigo text-white text-xs font-medium shrink-0">
                  {c.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    initial
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-ringo-text truncate">{name}</span>
                  <span className="block text-xs text-ringo-muted truncate">{relativeTime(c.lastMessageAt)}</span>
                </span>
                {c.unread && <span className="w-2 h-2 rounded-full bg-ringo-coral shrink-0" aria-label="Unread" />}
              </button>
            );
          })
        )}
      </div>

      <div className={`flex-1 flex-col min-w-0 ${selectedId ? "flex" : "hidden lg:flex"}`}>
        {selected ? (
          <SupportThread
            key={selected.id}
            conversationId={selected.id}
            title={selected.username ? `@${selected.username}` : selected.email || "Unknown"}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex-1 hidden lg:flex flex-col items-center justify-center gap-2 text-ringo-muted">
            <MessageCircle size={22} />
            <p className="text-sm">Pick a conversation to read it</p>
          </div>
        )}
      </div>
    </div>
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
