"use client";

import { useEffect, useState } from "react";
import { Nfc, Loader2, ShieldAlert, ArrowLeft, Check, Gift, Wallet } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { isWebNfcSupported, isSecureContextAvailable, readRingoCard, RingoCardError } from "@/lib/ringoCardWriter";

type Tab = "tap" | "history";
type Stage = "idle" | "scanning" | "found" | "amount" | "rewards" | "success" | "error";

interface Reward {
  id: string;
  name: string;
  description: string | null;
  points_cost: number;
}

export default function AssociationPartnerView({
  associationProfileId,
  associationName,
  partnerProfileId,
  momoNumber,
}: {
  associationProfileId: string;
  associationName: string;
  partnerProfileId: string;
  momoNumber: string | null;
}) {
  const { t } = useLanguage();
  const a = t.association;
  const [tab, setTab] = useState<Tab>("tap");
  const [stage, setStage] = useState<Stage>("idle");
  const [member, setMember] = useState<{ id: string; name: string; pointsBalance: number } | null>(null);
  const [amount, setAmount] = useState("");
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [history, setHistory] = useState<any[] | null>(null);

  useEffect(() => {
    if (tab === "history" && history === null) {
      fetch(`/api/association/transactions?associationProfileId=${associationProfileId}`)
        .then((r) => r.json())
        .then((d) => setHistory(d.transactions || []));
    }
  }, [tab, history, associationProfileId]);

  const scanCard = async () => {
    if (!isWebNfcSupported() || !isSecureContextAvailable()) {
      setError(a.nfcUnsupported);
      setStage("error");
      return;
    }
    setStage("scanning");
    setError("");
    try {
      const result = await readRingoCard(15000);
      const reference = result.url?.split("/").filter(Boolean).pop();
      if (!reference) throw new RingoCardError("unknown", "no reference");

      const res = await fetch("/api/association/tap/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ associationProfileId, cardReference: reference }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((a.errors as Record<string, string>)[data.code] || data.error || a.genericError);

      setMember(data.member);
      setStage("found");
    } catch (err) {
      setError(err instanceof RingoCardError ? a.nfcErrors[err.code] || a.genericError : (err as Error).message || a.genericError);
      setStage("error");
    }
  };

  const logPurchase = async () => {
    if (!member) return;
    setStage("scanning");
    setError("");
    try {
      const res = await fetch("/api/association/tap/earn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ associationProfileId, memberId: member.id, amountXaf: Number(amount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((a.errors as Record<string, string>)[data.code] || data.error || a.genericError);
      setSuccessMessage(a.pointsEarnedMessage(data.pointsEarned));
      setStage("success");
    } catch (err: any) {
      setError(err.message);
      setStage("error");
    }
  };

  const openRewards = async () => {
    const res = await fetch(`/api/association/rewards?associationProfileId=${associationProfileId}`);
    const data = await res.json();
    setRewards(data.rewards || []);
    setStage("rewards");
  };

  const redeem = async (reward: Reward) => {
    if (!member) return;
    setStage("scanning");
    setError("");
    try {
      const res = await fetch("/api/association/tap/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ associationProfileId, memberId: member.id, rewardId: reward.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((a.errors as Record<string, string>)[data.code] || data.error || a.genericError);
      setSuccessMessage(a.rewardRedeemedMessage(reward.name));
      setStage("success");
    } catch (err: any) {
      setError(err.message);
      setStage("error");
    }
  };

  const reset = () => {
    setMember(null);
    setAmount("");
    setError("");
    setStage("idle");
  };

  return (
    <div className="max-w-md flex flex-col gap-5">
      <div>
        <h1 className="font-display text-lg font-semibold text-ringo-text">{associationName}</h1>
        <p className="text-sm text-ringo-muted mt-0.5">{a.partnerSubtitle}</p>
      </div>

      <div className="flex gap-1 border-b border-ringo-border/70">
        <button
          onClick={() => setTab("tap")}
          className={`px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${tab === "tap" ? "border-ringo-indigo text-ringo-indigo" : "border-transparent text-ringo-muted"}`}
        >
          {a.tabTapToLog}
        </button>
        <button
          onClick={() => setTab("history")}
          className={`px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${tab === "history" ? "border-ringo-indigo text-ringo-indigo" : "border-transparent text-ringo-muted"}`}
        >
          {a.tabMyLog}
        </button>
      </div>

      {tab === "tap" && (
        <div className="rounded-2xl border border-ringo-border/70 p-6 flex flex-col items-center text-center gap-3">
          {stage === "idle" && (
            <>
              <Nfc size={32} className="text-ringo-indigo" />
              <p className="text-sm text-ringo-muted">{a.tapCardHint}</p>
              <button onClick={scanCard} className="w-full flex items-center justify-center gap-2 py-3 rounded-card bg-ringo-indigo text-white text-sm font-semibold">
                <Nfc size={16} /> {a.tapCardCta}
              </button>
              {momoNumber && (
                <div className="w-full rounded-card border border-ringo-border/60 p-3 flex items-center gap-2 text-left mt-2">
                  <Wallet size={15} className="text-ringo-muted shrink-0" />
                  <p className="text-xs text-ringo-muted">
                    {a.momoDisplayLabel} <span className="font-mono text-ringo-text">{momoNumber}</span>
                  </p>
                </div>
              )}
            </>
          )}

          {stage === "scanning" && (
            <>
              <Loader2 size={28} className="animate-spin text-ringo-indigo" />
              <p className="text-sm text-ringo-muted">{a.processingHint}</p>
            </>
          )}

          {stage === "found" && member && (
            <>
              <p className="text-base font-semibold text-ringo-text">{member.name}</p>
              <p className="text-sm text-ringo-muted">{a.pointsBalanceLabel(member.pointsBalance)}</p>
              <div className="w-full flex flex-col gap-2 mt-2">
                <button onClick={() => setStage("amount")} className="w-full py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium">
                  {a.logPurchaseCta}
                </button>
                <button onClick={openRewards} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-card border border-ringo-border text-ringo-text text-sm font-medium">
                  <Gift size={15} /> {a.redeemRewardCta}
                </button>
              </div>
              <button onClick={reset} className="text-xs text-ringo-muted hover:text-ringo-text transition flex items-center gap-1 mt-1">
                <ArrowLeft size={12} /> {a.cancelAction}
              </button>
            </>
          )}

          {stage === "amount" && member && (
            <>
              <p className="text-sm font-medium text-ringo-text">{member.name}</p>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                min={1}
                placeholder={a.purchaseAmountPlaceholder}
                className="w-full border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-bg text-center"
                autoFocus
              />
              <button onClick={logPurchase} disabled={!amount} className="w-full py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium disabled:opacity-60">
                {a.confirmAction}
              </button>
              <button onClick={() => setStage("found")} className="text-xs text-ringo-muted hover:text-ringo-text transition">
                {a.backAction}
              </button>
            </>
          )}

          {stage === "rewards" && member && (
            <>
              <p className="text-sm font-medium text-ringo-text">{member.name}</p>
              <div className="w-full flex flex-col gap-2 max-h-56 overflow-y-auto">
                {rewards.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => redeem(r)}
                    disabled={member.pointsBalance < r.points_cost}
                    className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-card border border-ringo-border text-left disabled:opacity-40 hover:border-ringo-indigo transition"
                  >
                    <span className="text-sm text-ringo-text">{r.name}</span>
                    <span className="text-xs font-semibold text-ringo-indigo shrink-0">{a.pointsShort(r.points_cost)}</span>
                  </button>
                ))}
                {rewards.length === 0 && <p className="text-xs text-ringo-muted">{a.noRewardsYet}</p>}
              </div>
              <button onClick={() => setStage("found")} className="text-xs text-ringo-muted hover:text-ringo-text transition">
                {a.backAction}
              </button>
            </>
          )}

          {stage === "success" && (
            <>
              <span className="w-14 h-14 rounded-full bg-ringo-teal/10 flex items-center justify-center">
                <Check size={26} className="text-ringo-teal" />
              </span>
              <p className="text-sm font-medium text-ringo-text">{successMessage}</p>
              <button onClick={reset} className="w-full py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium">
                {a.doneCta}
              </button>
            </>
          )}

          {stage === "error" && (
            <>
              <ShieldAlert size={28} className="text-ringo-coral" />
              <p className="text-sm text-ringo-text">{error}</p>
              <button onClick={reset} className="w-full py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium">
                {a.tryAgainCta}
              </button>
            </>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="flex flex-col gap-2">
          {history === null && (
            <div className="flex justify-center py-6">
              <Loader2 size={18} className="animate-spin text-ringo-muted" />
            </div>
          )}
          {history?.map((tx) => (
            <div key={tx.id} className="flex items-center gap-3 rounded-2xl border border-ringo-border/70 p-3.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ringo-text truncate">{tx.association_members?.name || "—"}</p>
                <p className="text-xs text-ringo-muted truncate">
                  {tx.type === "earn" ? a.activityEarnLabel : a.activityRedeemLabel(tx.association_rewards?.name || "")}
                  {" · "}
                  {new Date(tx.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </p>
              </div>
              <span className={`text-sm font-semibold shrink-0 tabular-nums ${tx.points_delta >= 0 ? "text-ringo-teal" : "text-ringo-coral"}`}>
                {tx.points_delta >= 0 ? "+" : ""}
                {tx.points_delta}
              </span>
            </div>
          ))}
          {history?.length === 0 && <p className="text-sm text-ringo-muted text-center py-6">{a.noActivityYet}</p>}
        </div>
      )}
    </div>
  );
}
