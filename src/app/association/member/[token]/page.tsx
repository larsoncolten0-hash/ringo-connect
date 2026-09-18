"use client";

import { useEffect, useState } from "react";
import { Loader2, Award } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Public, no login — a Member has no Ringo account (see the migration's
// own note: linking one is optional and never required). The token in the
// URL (association_members.access_token_hash) is the only credential,
// resolved server-side via /api/association/member-view/[token] using the
// admin client — same posture as /community/manage/[token].
interface MemberViewData {
  name: string;
  pointsBalance: number;
  status: "active" | "disabled";
  associationName: string;
  transactions: { type: "earn" | "redeem"; amountXaf: number | null; pointsDelta: number; createdAt: string; rewardName: string | null }[];
}

export default function AssociationMemberViewPage({ params }: { params: { token: string } }) {
  const { t } = useLanguage();
  const a = t.association;
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<MemberViewData | null>(null);

  useEffect(() => {
    fetch(`/api/association/member-view/${params.token}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setData)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [params.token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-ringo-muted" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <p className="text-sm text-ringo-muted">{a.memberView.linkInvalid}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white px-4 py-10">
      <div className="max-w-md mx-auto flex flex-col gap-5">
        <div>
          <p className="text-xs text-ringo-muted">{data.associationName}</p>
          <h1 className="font-display text-lg font-bold text-ringo-text">{a.memberView.greeting(data.name)}</h1>
        </div>

        <div className="rounded-2xl bg-ringo-indigo text-white p-5 flex items-center gap-3">
          <Award size={28} />
          <div>
            <p className="text-2xl font-bold tabular-nums">{data.pointsBalance}</p>
            <p className="text-xs opacity-80">{a.memberView.pointsLabel}</p>
          </div>
        </div>

        {data.status === "disabled" && <p className="text-xs text-ringo-coral">{a.memberView.accountDisabled}</p>}

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ringo-muted mb-2">{a.memberView.historyTitle}</p>
          <div className="flex flex-col gap-2">
            {data.transactions.map((tx, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl border border-ringo-border/70 p-3.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ringo-text truncate">{tx.type === "earn" ? a.activityEarnLabel : a.activityRedeemLabel(tx.rewardName || "")}</p>
                  <p className="text-xs text-ringo-muted">{new Date(tx.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                </div>
                <span className={`text-sm font-semibold shrink-0 tabular-nums ${tx.pointsDelta >= 0 ? "text-ringo-teal" : "text-ringo-coral"}`}>
                  {tx.pointsDelta >= 0 ? "+" : ""}
                  {tx.pointsDelta}
                </span>
              </div>
            ))}
            {data.transactions.length === 0 && <p className="text-sm text-ringo-muted">{a.noActivityYet}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
