"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Users, ShoppingBag, Wallet, Banknote, History } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import { useLanguage } from "@/components/LanguageProvider";
import AmbassadorPayoutActions, { AmbassadorMinPayoutSetting } from "@/components/admin/AmbassadorPayoutActions";
import type { AmbassadorAdminOverview } from "@/lib/ambassador/admin";

// Ambassador Program (Phase F) — Ringo Management. Every write action
// here is a plain fetch to an assertAdmin()-gated API route
// (src/app/api/admin/ambassadors/**, src/app/api/admin/ambassador-teams/**),
// mirroring AdminAffiliatesView.tsx's own fetch -> optimistic update ->
// router.refresh() pattern. Nothing here writes directly to
// ambassador_sales, ambassador_commission_ledger, or ambassador_payouts —
// those stay exclusively the approved SQL functions' responsibility
// (payout actions are the Phase H buttons in AmbassadorPayoutActions.tsx —
// each is an assertAdmin()-gated route that calls those SQL functions).

const TABS = ["ambassadors", "teams", "sales", "ledger", "payouts", "actions"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  ambassadors: "Ambassadors",
  teams: "Teams",
  sales: "Sales",
  ledger: "Commission Ledger",
  payouts: "Payouts",
  actions: "Activity Log",
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600",
  inactive: "bg-ringo-muted/10 text-ringo-muted",
  suspended: "bg-red-500/10 text-red-500",
  attributed: "bg-amber-500/10 text-amber-600",
  locked: "bg-sky-500/10 text-sky-600",
  milestone_1_earned: "bg-indigo-500/10 text-indigo-600",
  milestone_2_earned: "bg-emerald-500/10 text-emerald-600",
  disputed: "bg-red-500/10 text-red-500",
  voided: "bg-ringo-muted/10 text-ringo-muted",
  refunded: "bg-red-500/10 text-red-500",
  earned: "bg-indigo-500/10 text-indigo-600",
  eligible_for_payout: "bg-sky-500/10 text-sky-600",
  paid: "bg-emerald-500/10 text-emerald-600",
  reversed: "bg-red-500/10 text-red-500",
  cancelled: "bg-ringo-muted/10 text-ringo-muted",
  requested: "bg-amber-500/10 text-amber-600",
  processing: "bg-sky-500/10 text-sky-600",
  rejected: "bg-red-500/10 text-red-500",
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${STATUS_STYLES[status] || "bg-ringo-muted/10 text-ringo-muted"}`}>{status}</span>;
}

function StatTile({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-ringo-indigo/10">
          <Icon size={12} className="text-ringo-indigo" />
        </span>
        <p className="text-xs text-ringo-muted">{label}</p>
      </div>
      <p className="text-xl font-display font-medium text-ringo-text tabular-nums tracking-[-0.02em]">{value}</p>
    </div>
  );
}

export default function AdminAmbassadorsView({ overview: initialOverview }: { overview: AmbassadorAdminOverview }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [overview, setOverview] = useState(initialOverview);
  const [tab, setTab] = useState<Tab>("ambassadors");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newAmbassadorUsername, setNewAmbassadorUsername] = useState("");
  const [newTeamLeaderUsername, setNewTeamLeaderUsername] = useState("");
  const [newTeamName, setNewTeamName] = useState("");
  const [formError, setFormError] = useState("");
  const fmt = (n: number) => formatPrice(n, "XAF", "en");

  const createAmbassador = async () => {
    if (!newAmbassadorUsername.trim()) return;
    setFormError("");
    const res = await fetch("/api/admin/ambassadors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newAmbassadorUsername.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFormError(data.error || "Could not create the Ambassador.");
      return;
    }
    setNewAmbassadorUsername("");
    router.refresh();
  };

  const createTeam = async () => {
    if (!newTeamLeaderUsername.trim() || !newTeamName.trim()) return;
    setFormError("");
    const res = await fetch("/api/admin/ambassador-teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamLeaderUsername: newTeamLeaderUsername.trim(), name: newTeamName.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFormError(data.error || "Could not create the team.");
      return;
    }
    setNewTeamLeaderUsername("");
    setNewTeamName("");
    router.refresh();
  };

  const setAmbassadorStatus = async (id: string, status: "active" | "inactive" | "suspended") => {
    setBusyId(id);
    const res = await fetch(`/api/admin/ambassadors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      alert(data.error || "Could not update this Ambassador.");
      return;
    }
    setOverview((prev) => ({ ...prev, ambassadors: prev.ambassadors.map((a) => (a.id === id ? { ...a, status } : a)) }));
    router.refresh();
  };

  const setTeamStatus = async (id: string, status: "active" | "inactive") => {
    setBusyId(id);
    const res = await fetch(`/api/admin/ambassador-teams/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      alert(data.error || "Could not update this team.");
      return;
    }
    setOverview((prev) => ({ ...prev, teams: prev.teams.map((t) => (t.id === id ? { ...t, status } : t)) }));
    router.refresh();
  };

  const reassignTeam = async (ambassadorId: string, teamId: string | null) => {
    setBusyId(ambassadorId);
    const res = await fetch(`/api/admin/ambassadors/${ambassadorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      alert(data.error || "Could not reassign this Ambassador's team.");
      return;
    }
    router.refresh();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ringo-text tracking-[-0.01em]">Ambassador Program</h1>
        <p className="text-sm text-ringo-muted mt-1">Manage Ambassadors, Teams, sales attribution, commissions, and payouts.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Ambassadors" value={overview.ambassadors.length} icon={Megaphone} />
        <StatTile label="Teams" value={overview.teams.length} icon={Users} />
        <StatTile label="Sales" value={overview.sales.length} icon={ShoppingBag} />
        <StatTile label="Pending payouts" value={overview.payouts.filter((p) => p.status === "requested").length} icon={Banknote} />
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-ringo-border/60 pb-px">
        {TABS.map((tKey) => (
          <button
            key={tKey}
            type="button"
            onClick={() => setTab(tKey)}
            className={`shrink-0 px-3 py-2 text-sm font-medium rounded-t-lg transition ${
              tab === tKey ? "text-ringo-indigo border-b-2 border-ringo-indigo" : "text-ringo-muted hover:text-ringo-text"
            }`}
          >
            {TAB_LABELS[tKey]}
          </button>
        ))}
      </div>

      {formError && <p className="text-sm text-red-500">{formError}</p>}

      {tab === "ambassadors" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ringo-muted">Username</label>
              <input
                value={newAmbassadorUsername}
                onChange={(e) => setNewAmbassadorUsername(e.target.value)}
                placeholder="ringo-username"
                className="text-sm px-3 py-2 rounded-lg border border-ringo-border bg-transparent"
              />
            </div>
            <button type="button" onClick={createAmbassador} className="text-sm font-medium px-3 py-2 rounded-lg bg-ringo-indigo text-white">
              Make Ambassador
            </button>
          </div>
          <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ringo-muted border-b border-ringo-border/60">
                  <th className="px-3.5 py-2.5 font-medium">Username</th>
                  <th className="px-3.5 py-2.5 font-medium">Code</th>
                  <th className="px-3.5 py-2.5 font-medium">Team</th>
                  <th className="px-3.5 py-2.5 font-medium">Status</th>
                  <th className="px-3.5 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {overview.ambassadors.map((a) => (
                  <tr key={a.id} className="border-b border-ringo-border/40 last:border-0">
                    <td className="px-3.5 py-2.5 text-ringo-text">{a.username || "—"}</td>
                    <td className="px-3.5 py-2.5 text-ringo-muted font-mono text-xs">{a.salesCode}</td>
                    <td className="px-3.5 py-2.5">
                      <select
                        defaultValue={a.teamId || ""}
                        onChange={(e) => reassignTeam(a.id, e.target.value || null)}
                        disabled={busyId === a.id}
                        className="text-xs bg-transparent border border-ringo-border rounded-lg px-2 py-1"
                      >
                        <option value="">No team</option>
                        {overview.teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3.5 py-2.5">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-3.5 py-2.5 flex gap-2">
                      {a.status !== "active" && (
                        <button type="button" disabled={busyId === a.id} onClick={() => setAmbassadorStatus(a.id, "active")} className="text-xs text-emerald-600 hover:underline">
                          Activate
                        </button>
                      )}
                      {a.status !== "suspended" && (
                        <button type="button" disabled={busyId === a.id} onClick={() => setAmbassadorStatus(a.id, "suspended")} className="text-xs text-red-500 hover:underline">
                          Suspend
                        </button>
                      )}
                      {a.status !== "inactive" && (
                        <button type="button" disabled={busyId === a.id} onClick={() => setAmbassadorStatus(a.id, "inactive")} className="text-xs text-ringo-muted hover:underline">
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "teams" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ringo-muted">Team Leader username</label>
              <input
                value={newTeamLeaderUsername}
                onChange={(e) => setNewTeamLeaderUsername(e.target.value)}
                placeholder="ringo-username"
                className="text-sm px-3 py-2 rounded-lg border border-ringo-border bg-transparent"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-ringo-muted">Team name</label>
              <input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="Team name" className="text-sm px-3 py-2 rounded-lg border border-ringo-border bg-transparent" />
            </div>
            <button type="button" onClick={createTeam} className="text-sm font-medium px-3 py-2 rounded-lg bg-ringo-indigo text-white">
              Create Team
            </button>
          </div>
          <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ringo-muted border-b border-ringo-border/60">
                  <th className="px-3.5 py-2.5 font-medium">Name</th>
                  <th className="px-3.5 py-2.5 font-medium">Team Leader</th>
                  <th className="px-3.5 py-2.5 font-medium">Ambassadors</th>
                  <th className="px-3.5 py-2.5 font-medium">Status</th>
                  <th className="px-3.5 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {overview.teams.map((t) => (
                  <tr key={t.id} className="border-b border-ringo-border/40 last:border-0">
                    <td className="px-3.5 py-2.5 text-ringo-text">{t.name}</td>
                    <td className="px-3.5 py-2.5 text-ringo-muted">{t.teamLeaderUsername || "—"}</td>
                    <td className="px-3.5 py-2.5 text-ringo-muted">{t.ambassadorCount}</td>
                    <td className="px-3.5 py-2.5">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-3.5 py-2.5">
                      {t.status === "active" ? (
                        <button type="button" disabled={busyId === t.id} onClick={() => setTeamStatus(t.id, "inactive")} className="text-xs text-ringo-muted hover:underline">
                          Deactivate
                        </button>
                      ) : (
                        <button type="button" disabled={busyId === t.id} onClick={() => setTeamStatus(t.id, "active")} className="text-xs text-emerald-600 hover:underline">
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "sales" && (
        <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ringo-muted border-b border-ringo-border/60">
                <th className="px-3.5 py-2.5 font-medium">Ambassador</th>
                <th className="px-3.5 py-2.5 font-medium">Team</th>
                <th className="px-3.5 py-2.5 font-medium">Customer</th>
                <th className="px-3.5 py-2.5 font-medium">Card</th>
                <th className="px-3.5 py-2.5 font-medium">Price</th>
                <th className="px-3.5 py-2.5 font-medium">Status</th>
                <th className="px-3.5 py-2.5 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {overview.sales.map((s) => (
                <tr key={s.id} className="border-b border-ringo-border/40 last:border-0">
                  <td className="px-3.5 py-2.5 font-mono text-xs text-ringo-text">{s.ambassadorSalesCode}</td>
                  <td className="px-3.5 py-2.5 text-ringo-muted">{s.teamName || "—"}</td>
                  <td className="px-3.5 py-2.5 text-ringo-muted">{s.customerUsername || "—"}</td>
                  <td className="px-3.5 py-2.5 text-ringo-muted">{s.cardType}</td>
                  <td className="px-3.5 py-2.5 text-ringo-muted">{fmt(s.sellingPrice)}</td>
                  <td className="px-3.5 py-2.5">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-3.5 py-2.5 text-ringo-muted">{new Date(s.attributedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "ledger" && (
        <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ringo-muted border-b border-ringo-border/60">
                <th className="px-3.5 py-2.5 font-medium">Recipient</th>
                <th className="px-3.5 py-2.5 font-medium">Type</th>
                <th className="px-3.5 py-2.5 font-medium">Milestone</th>
                <th className="px-3.5 py-2.5 font-medium">Entry</th>
                <th className="px-3.5 py-2.5 font-medium">Amount</th>
                <th className="px-3.5 py-2.5 font-medium">Status</th>
                <th className="px-3.5 py-2.5 font-medium">Date</th>
                <th className="px-3.5 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {overview.ledger.map((l) => (
                <tr key={l.id} className="border-b border-ringo-border/40 last:border-0">
                  <td className="px-3.5 py-2.5 text-ringo-text">{l.recipientUsername || "—"}</td>
                  <td className="px-3.5 py-2.5 text-ringo-muted">{l.recipientType}</td>
                  <td className="px-3.5 py-2.5 text-ringo-muted">{l.milestone}</td>
                  <td className="px-3.5 py-2.5 text-ringo-muted">{l.entryType}</td>
                  <td className={`px-3.5 py-2.5 ${l.commissionAmount < 0 ? "text-red-500" : "text-ringo-muted"}`}>{fmt(l.commissionAmount)}</td>
                  <td className="px-3.5 py-2.5">
                    <StatusBadge status={l.status} />
                  </td>
                  <td className="px-3.5 py-2.5 text-ringo-muted">{new Date(l.createdAt).toLocaleDateString()}</td>
                  <td className="px-3.5 py-2.5">
                    {l.entryType === "commission" && (
                      <span className="inline-flex gap-1.5">
                        {l.status === "earned" && <AmbassadorPayoutActions kind="release" id={l.id} />}
                        {l.status !== "reversed" && l.status !== "cancelled" && <AmbassadorPayoutActions kind="reverse" id={l.id} />}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "payouts" && (
        <div className="flex flex-col gap-3">
          <AmbassadorMinPayoutSetting initial={overview.minPayoutXaf} />
          <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ringo-muted border-b border-ringo-border/60">
                  <th className="px-3.5 py-2.5 font-medium">Recipient</th>
                  <th className="px-3.5 py-2.5 font-medium">Type</th>
                  <th className="px-3.5 py-2.5 font-medium">Amount</th>
                  <th className="px-3.5 py-2.5 font-medium">Status</th>
                  <th className="px-3.5 py-2.5 font-medium">Requested</th>
                  <th className="px-3.5 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {overview.payouts.map((p) => (
                  <tr key={p.id} className="border-b border-ringo-border/40 last:border-0">
                    <td className="px-3.5 py-2.5 text-ringo-text">{p.recipientUsername || "—"}</td>
                    <td className="px-3.5 py-2.5 text-ringo-muted">{p.recipientType}</td>
                    <td className="px-3.5 py-2.5 text-ringo-muted">{fmt(p.amount)}</td>
                    <td className="px-3.5 py-2.5">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-3.5 py-2.5 text-ringo-muted">{new Date(p.requestedAt).toLocaleDateString()}</td>
                    <td className="px-3.5 py-2.5">
                      <span className="inline-flex flex-wrap gap-1.5">
                        {p.status === "requested" && p.payoutMethod === "mobile_money" && p.currency === "XAF" && <AmbassadorPayoutActions kind="send" id={p.id} />}
                        {p.status === "requested" && <AmbassadorPayoutActions kind="markPaid" id={p.id} />}
                        {p.status === "requested" && <AmbassadorPayoutActions kind="reject" id={p.id} />}
                        {(p.status === "processing" || p.status === "reconciliation_required") && p.hasFapshiTransaction && <AmbassadorPayoutActions kind="check" id={p.id} />}
                        {p.status === "reconciliation_required" && <AmbassadorPayoutActions kind="resolveSent" id={p.id} />}
                        {p.status === "reconciliation_required" && !p.hasFapshiTransaction && <AmbassadorPayoutActions kind="resolveNotSent" id={p.id} />}
                        {p.status === "reconciliation_required" && <span className="text-[11px] text-amber-600 max-w-[220px]">{t.ambassadorPayouts.admin.reconciliationHint}</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "actions" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-ringo-muted flex items-center gap-1.5">
            <History size={13} /> Every Ambassador-program administrative action, plus system events (e.g. a rejected self-referral).
          </p>
          <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ringo-muted border-b border-ringo-border/60">
                  <th className="px-3.5 py-2.5 font-medium">Actor</th>
                  <th className="px-3.5 py-2.5 font-medium">Action</th>
                  <th className="px-3.5 py-2.5 font-medium">Target</th>
                  <th className="px-3.5 py-2.5 font-medium">Reason</th>
                  <th className="px-3.5 py-2.5 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {overview.actions.map((a) => (
                  <tr key={a.id} className="border-b border-ringo-border/40 last:border-0">
                    <td className="px-3.5 py-2.5 text-ringo-text">{a.actorUsername || "System"}</td>
                    <td className="px-3.5 py-2.5 text-ringo-muted">{a.action}</td>
                    <td className="px-3.5 py-2.5 text-ringo-muted">{a.targetTable}</td>
                    <td className="px-3.5 py-2.5 text-ringo-muted">{a.reason || "—"}</td>
                    <td className="px-3.5 py-2.5 text-ringo-muted">{new Date(a.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
