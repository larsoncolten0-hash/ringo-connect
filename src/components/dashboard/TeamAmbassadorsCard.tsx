"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { TeamMemberRow } from "@/lib/ambassador/teamMembers";

// Team Leader dashboard: add an existing Ringo account to the team as an
// Ambassador, and see who is on the team with their status. The Team Leader can
// only ADD — the new Ambassador is created pending and gets no access until
// Ringo Management approves them. The request carries just a username; the
// server derives the team and everything else from the session.
const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-600",
  active: "bg-emerald-500/10 text-emerald-600",
  inactive: "bg-ringo-muted/10 text-ringo-muted",
  suspended: "bg-red-500/10 text-red-500",
};

export default function TeamAmbassadorsCard({ members }: { members: TeamMemberRow[] }) {
  const { t } = useLanguage();
  const c = t.ambassadorTeamMembers;
  const errors = c.errors as Record<string, string>;
  const statusLabels = c.status as Record<string, string>;
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function add() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ambassador/team-members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }) });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setMessage({ ok: true, text: c.added(json.username) });
        setUsername("");
        router.refresh();
      } else {
        setMessage({ ok: false, text: errors[json.code] || errors.unavailable });
      }
    } catch {
      setMessage({ ok: false, text: errors.network });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-5xl mx-auto px-4 pb-6">
      <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface p-4 flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ringo-text flex items-center gap-2">
            <UserPlus size={15} className="text-ringo-indigo" /> {c.title}
          </h2>
          <p className="text-xs text-ringo-muted mt-0.5">{c.hint}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-ringo-muted flex flex-col gap-1">
            {c.usernameLabel}
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={c.usernamePlaceholder} autoComplete="off" className="w-56 rounded-lg border border-ringo-border/60 bg-ringo-bg px-3 py-2 text-sm text-ringo-text" />
          </label>
          <button type="button" onClick={add} disabled={busy || username.trim().length < 3} className="text-sm font-medium px-3 py-2 rounded-lg bg-ringo-indigo text-white disabled:opacity-60">
            {busy ? c.adding : c.add}
          </button>
        </div>
        {message && <p className={`text-sm ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</p>}

        {members.length === 0 ? (
          <p className="text-sm text-ringo-muted">{c.empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-ringo-border/40">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ringo-text">{m.username ? `@${m.username}` : "—"}</span>
                <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${STATUS_STYLES[m.status] || "bg-ringo-muted/10 text-ringo-muted"}`}>{statusLabels[m.status] || m.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
