"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Zap, RefreshCw, Check } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import type { AdminMusicPayoutOverview } from "@/lib/musicEarnings";
import type { MusicPayoutSettings } from "@/lib/musicPayoutSettings";

// Mirrors AdminAffiliatesView.tsx's payout-processing section closely —
// same actions (send via Fapshi / check status / mark paid / reject),
// same reasoning, just against music_payouts instead of affiliate_payouts.
const STATUS_STYLES: Record<string, string> = {
  requested: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  processing: "bg-ringo-indigo/10 text-ringo-indigo",
  paid: "bg-ringo-teal/10 text-ringo-teal",
  rejected: "bg-red-500/10 text-red-500",
};
const STATUS_ORDER: Record<string, number> = { requested: 0, processing: 1, paid: 2, rejected: 3 };

function StatTile({ label, value, icon: Icon }: { label: string; value: string | number; icon: any }) {
  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-ringo-indigo/10">
          <Icon size={12} className="text-ringo-indigo" />
        </span>
        <p className="text-xs text-ringo-muted">{label}</p>
      </div>
      <p className="text-xl font-display font-medium text-ringo-text tabular-nums tracking-[-0.02em]">{value}</p>
    </div>
  );
}

export default function AdminMusicPayoutsView({
  overview: initialOverview,
  initialSettings,
}: {
  overview: AdminMusicPayoutOverview;
  initialSettings: MusicPayoutSettings;
}) {
  const router = useRouter();
  const [overview, setOverview] = useState(initialOverview);
  const [settings, setSettings] = useState({
    musicCommissionRatePct: Math.round(initialSettings.musicCommissionRate * 10000) / 100,
    musicPayoutHoldDays: initialSettings.musicPayoutHoldDays,
    musicMinPayoutXaf: initialSettings.musicMinPayoutXaf,
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "requested" | "processing" | "paid" | "rejected">("requested");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const saveSettings = async () => {
    setSavingSettings(true);
    setSettingsError("");
    const res = await fetch("/api/admin/music/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const data = await res.json().catch(() => ({}));
    setSavingSettings(false);
    if (!res.ok) {
      setSettingsError(data.error || "Could not save settings.");
      return;
    }
    setSettingsSaved(true);
    router.refresh();
    setTimeout(() => setSettingsSaved(false), 2000);
  };

  const resolvePayout = async (id: string, action: "paid" | "rejected") => {
    const note = window.prompt(
      action === "paid" ? "Optional note for this payout (e.g. transaction reference):" : "Reason for rejecting (optional):",
      ""
    );
    if (note === null) return;

    setResolvingId(id);
    const res = await fetch(`/api/admin/music/payouts/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: note || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setResolvingId(null);
    if (!res.ok) {
      alert(data.error || "Could not update this payout.");
      return;
    }
    setOverview((prev) => ({
      ...prev,
      payouts: prev.payouts.map((p) => (p.id === id ? { ...p, status: action, processedAt: new Date().toISOString() } : p)),
    }));
    router.refresh();
  };

  const sendViaFapshi = async (id: string) => {
    if (!window.confirm("Send this amount via Fapshi Mobile Money right now? This moves real money.")) return;
    setSendingId(id);
    const res = await fetch(`/api/admin/music/payouts/${id}/send`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setSendingId(null);
    if (!res.ok) {
      alert(data.error || "Could not start the Fapshi disbursement.");
      return;
    }
    setOverview((prev) => ({
      ...prev,
      payouts: prev.payouts.map((p) => (p.id === id ? { ...p, status: "processing", fapshiTransId: data.transId } : p)),
    }));
    setStatusFilter("processing");
  };

  const checkFapshiStatus = async (id: string) => {
    setCheckingId(id);
    const res = await fetch(`/api/admin/music/payouts/${id}/check`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setCheckingId(null);
    if (!res.ok) {
      alert(data.error || "Could not check this payout's status.");
      return;
    }
    if (data.status === "CREATED") {
      alert("Still in progress at Fapshi — check again in a moment.");
      return;
    }
    const nextStatus = data.status === "SUCCESSFUL" ? "paid" : "requested";
    setOverview((prev) => ({
      ...prev,
      payouts: prev.payouts.map((p) =>
        p.id === id ? { ...p, status: nextStatus, processedAt: nextStatus === "paid" ? new Date().toISOString() : p.processedAt } : p
      ),
    }));
    router.refresh();
  };

  const filteredPayouts = [...overview.payouts]
    .filter((p) => statusFilter === "all" || p.status === statusFilter)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || +new Date(b.requestedAt) - +new Date(a.requestedAt));

  const currencies = Object.keys(overview.totalsByCurrency);

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div>
        <p className="text-xs font-medium tracking-wide uppercase text-ringo-indigo mb-2">Music</p>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1">Music sales payouts</h1>
        <p className="text-sm text-ringo-muted max-w-lg">
          Money owed to artists from Mobile Money sales Ringo Connect collected automatically. Cash/card sales the artist
          confirms themselves never appear here — Ringo never touched that money.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {currencies.length === 0 ? (
          <StatTile label="Outstanding" value={formatPrice(0, "XAF")} icon={Banknote} />
        ) : (
          currencies.flatMap((cur) => [
            <StatTile key={`${cur}-out`} label={`${cur} outstanding`} value={formatPrice(overview.totalsByCurrency[cur].outstanding, cur)} icon={Banknote} />,
            <StatTile key={`${cur}-paid`} label={`${cur} paid out`} value={formatPrice(overview.totalsByCurrency[cur].paid, cur)} icon={Check} />,
          ])
        )}
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col gap-4">
        <p className="text-sm font-semibold text-ringo-text">Payout policy</p>
        {settingsError && <p className="text-xs text-red-500">{settingsError}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ringo-text">Platform fee (%)</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={settings.musicCommissionRatePct}
              onChange={(e) => setSettings((s) => ({ ...s, musicCommissionRatePct: Number(e.target.value) }))}
              className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ringo-text">Hold period (days)</span>
            <input
              type="number"
              min={0}
              value={settings.musicPayoutHoldDays}
              onChange={(e) => setSettings((s) => ({ ...s, musicPayoutHoldDays: Number(e.target.value) }))}
              className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ringo-text">Minimum payout (XAF)</span>
            <input
              type="number"
              min={0}
              value={settings.musicMinPayoutXaf}
              onChange={(e) => setSettings((s) => ({ ...s, musicMinPayoutXaf: Number(e.target.value) }))}
              className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            />
          </label>
        </div>
        <button
          onClick={saveSettings}
          disabled={savingSettings}
          className="self-start text-sm font-medium px-4 py-2 rounded-card bg-ringo-indigo text-white disabled:opacity-50 hover:brightness-110 transition"
        >
          {savingSettings ? "Saving…" : settingsSaved ? "Saved ✓" : "Save"}
        </button>
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-ringo-border/70 flex-wrap gap-2">
          <p className="text-sm font-semibold text-ringo-text">Payout requests</p>
          <div className="flex gap-1 bg-ringo-muted/10 rounded-full p-1">
            {(["requested", "processing", "all", "paid", "rejected"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs font-medium px-3 py-1 rounded-full capitalize transition ${
                  statusFilter === s ? "bg-ringo-surface text-ringo-text shadow-sm" : "text-ringo-muted"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {filteredPayouts.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 py-14">
            <span className="w-10 h-10 rounded-full bg-ringo-muted/10 flex items-center justify-center">
              <Banknote size={16} className="text-ringo-muted" />
            </span>
            <p className="text-sm text-ringo-muted">No payout requests here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                  <th className="py-3 px-5 font-normal">Artist</th>
                  <th className="font-normal">Amount</th>
                  <th className="font-normal">Method</th>
                  <th className="font-normal">Status</th>
                  <th className="font-normal">Requested</th>
                  <th className="font-normal px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayouts.map((p) => (
                  <tr key={p.id} className="border-b border-ringo-border/40 last:border-0 hover:bg-ringo-muted/5 transition-colors">
                    <td className="py-3 px-5">
                      <p className="text-ringo-text font-medium truncate max-w-[180px]">
                        {p.artist.username ? `@${p.artist.username}` : p.artist.email}
                      </p>
                      <p className="text-xs text-ringo-muted truncate max-w-[180px]">{p.artist.email}</p>
                    </td>
                    <td className="text-ringo-text tabular-nums">{formatPrice(p.amount, p.currency)}</td>
                    <td className="text-ringo-muted capitalize">{(p.payoutMethod || "—").replace("_", " ")}</td>
                    <td>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${STATUS_STYLES[p.status]}`}>{p.status}</span>
                      {p.status === "processing" && p.fapshiTransId && (
                        <p className="text-[10px] text-ringo-muted mt-1 font-mono truncate max-w-[120px]">{p.fapshiTransId}</p>
                      )}
                    </td>
                    <td className="text-ringo-muted">{new Date(p.requestedAt).toLocaleDateString("en-US")}</td>
                    <td className="px-5 text-right">
                      {p.status === "requested" || p.status === "processing" ? (
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {p.status === "requested" && p.currency === "XAF" && p.payoutMethod === "mobile_money" && (
                            <button
                              onClick={() => sendViaFapshi(p.id)}
                              disabled={sendingId === p.id}
                              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white disabled:opacity-50"
                            >
                              <Zap size={11} />
                              {sendingId === p.id ? "Sending…" : "Send via Fapshi"}
                            </button>
                          )}
                          {p.status === "processing" && (
                            <button
                              onClick={() => checkFapshiStatus(p.id)}
                              disabled={checkingId === p.id}
                              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-card border border-ringo-indigo text-ringo-indigo disabled:opacity-50"
                            >
                              <RefreshCw size={11} className={checkingId === p.id ? "animate-spin" : ""} />
                              Check status
                            </button>
                          )}
                          <button
                            onClick={() => resolvePayout(p.id, "paid")}
                            disabled={resolvingId === p.id}
                            className="text-xs px-3 py-1.5 rounded-card bg-ringo-teal text-white disabled:opacity-50"
                          >
                            Mark paid
                          </button>
                          <button
                            onClick={() => resolvePayout(p.id, "rejected")}
                            disabled={resolvingId === p.id}
                            className="text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-muted hover:border-red-500 hover:text-red-500 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-ringo-muted">{p.processedAt ? new Date(p.processedAt).toLocaleDateString("en-US") : "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
