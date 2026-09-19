"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Check, X, Loader2 } from "lucide-react";
import type { AdminVerificationRequest } from "@/lib/verification";

const TABS = ["pending", "approved", "rejected"] as const;
type Tab = (typeof TABS)[number];

// The admin blue-tick review queue — every creator's verification
// request, filterable by status, with Approve/Reject actions on each
// pending one (see the [id]/approve and [id]/reject routes, the only
// code paths that actually flip profiles.verified). Polls every 5s for
// new submissions — same "no Realtime dependency" posture as the support
// inbox (see SupportInboxView.tsx's own comment on why).
export default function VerificationRequestsView({ initialRequests }: { initialRequests: AdminVerificationRequest[] }) {
  const [requests, setRequests] = useState(initialRequests);
  const [tab, setTab] = useState<Tab>("pending");
  const [actingId, setActingId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  // Deep link from a notification (`?r=<requestId>`): jump to the tab that
  // holds that request, scroll to it, and ring it briefly. Plain DOM APIs
  // rather than useSearchParams, same reasoning as HighlightOnArrival.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("r");
    if (!id) return;
    const target = initialRequests.find((r) => r.id === id);
    if (target) setTab(target.status as Tab);
    setFocusId(id);
    const scroll = setTimeout(() => document.getElementById(`verification-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 150);
    const clear = setTimeout(() => setFocusId(null), 3000);
    return () => {
      clearTimeout(scroll);
      clearTimeout(clear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/admin/verification/requests");
        if (!res.ok) return;
        const data = await res.json();
        setRequests(data.requests || []);
      } catch {
        // Silent — a missed refresh just means a slightly stale list
        // until the next tick.
      }
    };
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  const act = async (id: string, action: "approve" | "reject") => {
    setActingId(id);
    // Optimistic — flips the row's status locally right away so the tab
    // filter reflects it immediately instead of waiting on the next poll.
    const prev = requests;
    setRequests((r) => r.map((req) => (req.id === id ? { ...req, status: action === "approve" ? "approved" : "rejected" } : req)));
    try {
      const res = await fetch(`/api/admin/verification/${id}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error("failed");
    } catch {
      setRequests(prev);
    } finally {
      setActingId(null);
    }
  };

  const filtered = requests.filter((r) => r.status === tab);
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ringo-text flex items-center gap-2">
          <BadgeCheck size={20} className="text-blue-500" />
          Verification requests
        </h1>
        <p className="text-sm text-ringo-muted mt-1">Creators asking for the blue-tick badge on their public page.</p>
      </div>

      <div className="flex items-center gap-1.5 bg-ringo-muted/10 rounded-card p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 text-sm font-medium px-4 py-1.5 rounded-card capitalize transition ${
              tab === t ? "bg-ringo-surface text-ringo-text shadow-sm" : "text-ringo-muted"
            }`}
          >
            {t}
            {t === "pending" && pendingCount > 0 && (
              <span className="text-[10px] font-semibold bg-ringo-indigo text-white px-1.5 py-0.5 rounded-full">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface overflow-hidden">
        {filtered.length === 0 ? (
          <p className="text-sm text-ringo-muted text-center py-12">No {tab} requests.</p>
        ) : (
          filtered.map((r) => {
            const name = r.username ? `@${r.username}` : r.email || "Unknown";
            const initial = (r.username || r.email || "?")[0]?.toUpperCase();
            return (
              <div
                id={`verification-${r.id}`}
                key={r.id}
                className={`flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-4 border-b border-ringo-border/60 last:border-0 transition-colors ${
                  focusId === r.id ? "bg-ringo-indigo/10" : ""
                }`}
              >
                <span className="w-9 h-9 rounded-full flex items-center justify-center bg-ringo-indigo text-white text-xs font-medium shrink-0">
                  {initial}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ringo-text truncate">{name}</p>
                  <p className="text-xs text-ringo-muted mt-0.5">
                    {r.fullName} · {r.phoneNumber} · {r.location}
                  </p>
                  <p className="text-[11px] text-ringo-muted/70 mt-0.5">{relativeTime(r.createdAt)}</p>
                </div>
                {r.status === "pending" ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => act(r.id, "reject")}
                      disabled={actingId === r.id}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-card border border-ringo-border text-ringo-text hover:border-red-400 hover:text-red-500 transition-colors disabled:opacity-50"
                    >
                      {actingId === r.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                      Reject
                    </button>
                    <button
                      onClick={() => act(r.id, "approve")}
                      disabled={actingId === r.id}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-card bg-ringo-indigo text-white hover:brightness-110 transition disabled:opacity-50"
                    >
                      {actingId === r.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      Approve
                    </button>
                  </div>
                ) : (
                  <span
                    className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium ${
                      r.status === "approved" ? "bg-blue-500/10 text-blue-500" : "bg-ringo-muted/10 text-ringo-muted"
                    }`}
                  >
                    {r.status === "approved" ? "Approved" : "Rejected"}
                  </span>
                )}
              </div>
            );
          })
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
