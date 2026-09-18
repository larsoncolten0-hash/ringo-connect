"use client";

import { useState, useEffect } from "react";
import { UserPlus, Award, Loader2, Copy, Check, Ban, Download, Settings2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import InvitePartnerModal from "./InvitePartnerModal";
import AddMemberModal from "./AddMemberModal";
import AssociationPartnerView from "./AssociationPartnerView";
import Link from "next/link";
import ManagedMemberPanel, { MembershipBadge } from "./admin/ManagedMemberPanel";
import type { ManagedMemberInfo } from "@/lib/association/membershipTypes";

type Tab = "members" | "partners" | "rewards" | "settings" | "activity" | "simulatedTap";

interface PartnerRow {
  id: string;
  partner_profile_id: string;
  momo_number: string | null;
  status: "active" | "removed";
  joined_at: string;
  profiles: { username: string; name: string | null; avatar_url: string | null } | null;
}

interface MemberRow {
  id: string;
  name: string;
  phone: string | null;
  linked_profile_id: string | null;
  points_balance: number;
  status: "active" | "disabled";
  profiles: { username: string; name: string | null; avatar_url: string | null } | null;
}

interface RewardRow {
  id: string;
  name: string;
  description: string | null;
  points_cost: number;
  active: boolean;
  sort_order: number;
}

interface InvitationRow {
  id: string;
  method: "manual" | "link";
  invitee_profile_id: string;
  status: "pending" | "accepted" | "expired" | "revoked" | "cancelled";
  expires_at: string;
  created_at: string;
  profiles: { username: string; name: string | null; avatar_url: string | null } | null;
}

export default function AssociationOwnerView({
  associationProfileId,
  associationName,
  maxMembers,
  maxPartners,
  initialPartners,
  initialMembers,
  initialRewards,
  initialSettings,
  initialInvitations,
  isDemo = false,
  associationId = null,
  managedMembers = {},
  membershipAvailable = false,
}: {
  associationProfileId: string;
  associationName: string;
  maxMembers: number | null;
  maxPartners: number | null;
  initialPartners: PartnerRow[];
  initialMembers: MemberRow[];
  initialRewards: RewardRow[];
  initialSettings: { points_per_amount: number; amount_unit: number; default_momo_number: string | null } | null;
  initialInvitations: InvitationRow[];
  // "Try the Association Program" demo accounts only — adds a demo-only
  // tab hosting the simulated tap-to-log flow (see AssociationPartnerView's
  // own isDemo prop), since a demo visitor has no physical Ringo Card to
  // actually tap.
  isDemo?: boolean;
  // Membership (Phase B1). Resolved on the server so a membership-managed member never shows the legacy
  // Enable/Disable toggle, not even on first paint. All three are optional: without them this view behaves
  // exactly as it did before Membership existed.
  associationId?: string | null;
  managedMembers?: Record<string, ManagedMemberInfo>;
  membershipAvailable?: boolean;
}) {
  const { t } = useLanguage();
  const a = t.association;
  const [tab, setTab] = useState<Tab>("members");
  const [partners, setPartners] = useState(initialPartners);
  const [members, setMembers] = useState(initialMembers);
  const [rewards, setRewards] = useState(initialRewards);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [showInvite, setShowInvite] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [managed, setManaged] = useState<Record<string, ManagedMemberInfo>>(managedMembers);

  const activeMembers = members.filter((m) => m.status === "active").length;
  const activePartners = partners.filter((p) => p.status === "active").length;

  const refreshMembers = async () => {
    const res = await fetch(`/api/association/members?associationProfileId=${associationProfileId}`);
    if (res.ok) setMembers((await res.json()).members || []);
  };
  const refreshManaged = async () => {
    if (!associationId) return;
    const res = await fetch(`/api/associations/${associationId}/members?managed=1`);
    if (res.ok) setManaged((await res.json()).managed || {});
  };
  const refreshMembersAndManaged = async () => {
    await Promise.all([refreshMembers(), refreshManaged()]);
  };
  const refreshPartners = async () => {
    const [pRes, iRes] = await Promise.all([
      fetch(`/api/association/partners?associationProfileId=${associationProfileId}`),
      fetch(`/api/association/invitations?associationProfileId=${associationProfileId}`),
    ]);
    if (pRes.ok) setPartners((await pRes.json()).partners || []);
    if (iRes.ok) setInvitations((await iRes.json()).invitations || []);
  };
  const refreshRewards = async () => {
    const res = await fetch(`/api/association/rewards?associationProfileId=${associationProfileId}`);
    if (res.ok) setRewards((await res.json()).rewards || []);
  };

  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-lg font-semibold text-ringo-text">{a.dashboardTitle}</h1>
          <p className="text-sm text-ringo-muted mt-0.5">
            {a.membersCount(activeMembers, maxMembers)} · {a.partnersCount(activePartners, maxPartners)}
          </p>
        </div>
        {membershipAvailable && associationId && (
          <Link
            href={`/dashboard/association/${associationId}/admin/memberships`}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold border border-ringo-border text-ringo-text hover:border-ringo-indigo transition"
          >
            <Award size={15} />
            {a.membership.navLink}
          </Link>
        )}
      </div>

      <div className="flex gap-1 border-b border-ringo-border/70 overflow-x-auto no-scrollbar">
        <TabButton active={tab === "members"} onClick={() => setTab("members")}>
          {a.tabMembers}
        </TabButton>
        <TabButton active={tab === "partners"} onClick={() => setTab("partners")}>
          {a.tabPartners}
        </TabButton>
        <TabButton active={tab === "rewards"} onClick={() => setTab("rewards")}>
          {a.tabRewards}
        </TabButton>
        <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>
          {a.tabActivity}
        </TabButton>
        <TabButton active={tab === "settings"} onClick={() => setTab("settings")}>
          {a.tabSettings}
        </TabButton>
        {isDemo && (
          <TabButton active={tab === "simulatedTap"} onClick={() => setTab("simulatedTap")}>
            {a.tabSimulatedTap}
          </TabButton>
        )}
      </div>

      {tab === "simulatedTap" && isDemo && (
        <AssociationPartnerView
          associationProfileId={associationProfileId}
          associationName={associationName}
          partnerProfileId={associationProfileId}
          momoNumber={initialSettings?.default_momo_number ?? null}
          isDemo
        />
      )}

      {tab === "members" && (
        <div className="flex flex-col gap-3">
          <div className="flex justify-end">
            <button
              onClick={() => setShowAddMember(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold bg-ringo-indigo text-white hover:brightness-110 active:scale-[0.98] transition"
            >
              <UserPlus size={15} />
              {a.addMemberCta}
            </button>
          </div>
          <div className="flex flex-col gap-2.5">
            {members.map((m) => (
              <MemberRowCard key={m.id} member={m} associationProfileId={associationProfileId} associationId={associationId} managed={managed[m.id]} onChanged={refreshMembersAndManaged} a={a} />
            ))}
            {members.length === 0 && <EmptyState text={a.noMembersYet} />}
          </div>
        </div>
      )}

      {tab === "partners" && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowInvite(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold bg-ringo-indigo text-white hover:brightness-110 active:scale-[0.98] transition"
            >
              <UserPlus size={15} />
              {a.invitePartnerCta}
            </button>
          </div>

          <div className="flex flex-col gap-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-ringo-muted">{a.tabPartners}</p>
            {partners.map((p) => (
              <PartnerRowCard key={p.id} partner={p} associationProfileId={associationProfileId} onChanged={refreshPartners} a={a} />
            ))}
            {partners.length === 0 && <EmptyState text={a.noPartnersYet} />}
          </div>

          {invitations.filter((i) => i.status === "pending").length > 0 && (
            <div className="flex flex-col gap-2.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ringo-muted">{a.pendingInvitations}</p>
              {invitations
                .filter((i) => i.status === "pending")
                .map((inv) => (
                  <InvitationRowCard key={inv.id} invitation={inv} a={a} />
                ))}
            </div>
          )}
        </div>
      )}

      {tab === "rewards" && <RewardsPanel associationProfileId={associationProfileId} rewards={rewards} onChanged={refreshRewards} a={a} />}

      {tab === "activity" && <ActivityPanel associationProfileId={associationProfileId} a={a} />}

      {tab === "settings" && <SettingsPanel associationProfileId={associationProfileId} initialSettings={initialSettings} a={a} />}

      {showInvite && (
        <InvitePartnerModal associationProfileId={associationProfileId} onClose={() => setShowInvite(false)} onInvited={refreshPartners} />
      )}
      {showAddMember && (
        <AddMemberModal associationProfileId={associationProfileId} onClose={() => setShowAddMember(false)} onCreated={refreshMembers} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
        active ? "border-ringo-indigo text-ringo-indigo" : "border-transparent text-ringo-muted hover:text-ringo-text"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-ringo-border/70 p-6 text-center text-sm text-ringo-muted">{text}</div>;
}

function Avatar({ url, name }: { url?: string | null; name: string }) {
  return (
    <span className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center bg-ringo-indigo text-white text-xs font-medium shrink-0">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className="w-full h-full object-cover" />
      ) : (
        name?.[0]?.toUpperCase() || "?"
      )}
    </span>
  );
}

function StatusBadge({ status, a }: { status: string; a: any }) {
  const styles: Record<string, string> = {
    active: "bg-ringo-teal/10 text-ringo-teal",
    disabled: "bg-ringo-muted/10 text-ringo-muted",
    removed: "bg-red-500/10 text-red-500",
    pending: "bg-amber-500/10 text-amber-600",
  };
  return <span className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${styles[status] || ""}`}>{a.statusLabels[status] || status}</span>;
}

function MemberRowCard({
  member,
  associationProfileId,
  associationId,
  managed,
  onChanged,
  a,
}: {
  member: MemberRow;
  associationProfileId: string;
  associationId: string | null;
  managed?: ManagedMemberInfo;
  onChanged: () => void;
  a: any;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);

  const toggleStatus = async () => {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch(`/api/association/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ associationProfileId, status: member.status === "active" ? "disabled" : "active" }),
      });
      // The database rejects a legacy status change for a member that is managed by Membership (e.g. enrolled in
      // another tab since this list loaded). Never fail silently: say so, and refresh so the row shows Membership actions.
      if (!res.ok) setNotice(a.membership.legacyToggleFailed);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3 rounded-2xl border border-ringo-border/70 p-3.5">
        <Avatar url={member.profiles?.avatar_url} name={member.name} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ringo-text truncate">{member.name}</p>
          <p className="text-xs text-ringo-muted truncate">
            {member.phone || "—"}
            {member.profiles && ` · @${member.profiles.username}`}
          </p>
        </div>
        <span className="text-sm font-semibold text-ringo-indigo shrink-0 tabular-nums">{a.pointsShort(member.points_balance)}</span>
        {managed && associationId ? (
          <>
            <MembershipBadge state={managed.effectiveState} />
            <button
              onClick={() => setPanelOpen(true)}
              className="px-3 py-1.5 rounded-full text-xs font-medium border border-ringo-border text-ringo-text hover:border-ringo-indigo transition shrink-0"
            >
              {a.membership.membershipButton}
            </button>
          </>
        ) : (
          <>
            <StatusBadge status={member.status} a={a} />
            <button
              onClick={toggleStatus}
              disabled={busy}
              className="w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10 transition disabled:opacity-60 shrink-0"
              aria-label={member.status === "active" ? a.disableMemberAction : a.enableMemberAction}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : member.status === "active" ? <Ban size={14} /> : <Check size={14} />}
            </button>
          </>
        )}
      </div>
      {notice && <p className="text-xs text-ringo-coral px-1">{notice}</p>}
      {panelOpen && managed && associationId && (
        <ManagedMemberPanel
          associationId={associationId}
          memberId={member.id}
          memberName={member.name}
          info={managed}
          canManage
          onClose={() => setPanelOpen(false)}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

function PartnerRowCard({ partner, associationProfileId, onChanged, a }: { partner: PartnerRow; associationProfileId: string; onChanged: () => void; a: any }) {
  const [busy, setBusy] = useState(false);
  const name = partner.profiles?.name || partner.profiles?.username || "—";

  const toggleStatus = async () => {
    setBusy(true);
    try {
      await fetch(`/api/association/partners/${partner.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: partner.status === "active" ? "removed" : "active" }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-ringo-border/70 p-3.5">
      <Avatar url={partner.profiles?.avatar_url} name={name} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ringo-text truncate">{name}</p>
        <p className="text-xs text-ringo-muted truncate">{partner.profiles?.username ? `@${partner.profiles.username}` : "—"}</p>
      </div>
      <StatusBadge status={partner.status} a={a} />
      <button
        onClick={toggleStatus}
        disabled={busy}
        className="w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10 transition disabled:opacity-60 shrink-0"
        aria-label={partner.status === "active" ? a.removePartnerAction : a.reactivatePartnerAction}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : partner.status === "active" ? <Ban size={14} /> : <Check size={14} />}
      </button>
    </div>
  );
}

function InvitationRowCard({ invitation, a }: { invitation: InvitationRow; a: any }) {
  const name = invitation.profiles?.name || invitation.profiles?.username || "—";
  const expires = new Date(invitation.expires_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-ringo-border/70 p-3.5">
      <Avatar url={invitation.profiles?.avatar_url} name={name} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ringo-text truncate">{name}</p>
        <p className="text-xs text-ringo-muted truncate">{a.invitationExpires(expires)}</p>
      </div>
      <StatusBadge status={invitation.status} a={a} />
    </div>
  );
}

function RewardsPanel({ associationProfileId, rewards, onChanged, a }: { associationProfileId: string; rewards: RewardRow[]; onChanged: () => void; a: any }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pointsCost, setPointsCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/association/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ associationProfileId, name, description, pointsCost: Number(pointsCost) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "server_error");
      setName("");
      setDescription("");
      setPointsCost("");
      setShowForm(false);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (reward: RewardRow) => {
    await fetch(`/api/association/rewards/${reward.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ associationProfileId, active: !reward.active }),
    });
    onChanged();
  };

  const remove = async (reward: RewardRow) => {
    await fetch(`/api/association/rewards/${reward.id}?associationProfileId=${associationProfileId}`, { method: "DELETE" });
    onChanged();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold bg-ringo-indigo text-white hover:brightness-110 active:scale-[0.98] transition"
        >
          <Award size={15} />
          {a.addRewardCta}
        </button>
      </div>

      {showForm && (
        <div className="rounded-2xl border border-ringo-border/70 p-4 flex flex-col gap-3">
          {error && <p className="text-xs text-red-500">{error}</p>}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={a.rewardNamePlaceholder}
            className="border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-surface"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={a.rewardDescriptionPlaceholder}
            className="border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-surface"
          />
          <input
            value={pointsCost}
            onChange={(e) => setPointsCost(e.target.value)}
            type="number"
            min={1}
            placeholder={a.rewardPointsCostPlaceholder}
            className="border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-surface"
          />
          <button
            onClick={create}
            disabled={busy || !name.trim() || !pointsCost}
            className="py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium disabled:opacity-60"
          >
            {busy ? <Loader2 size={15} className="animate-spin mx-auto" /> : a.saveRewardCta}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {rewards.map((r) => (
          <div key={r.id} className="flex items-center gap-3 rounded-2xl border border-ringo-border/70 p-3.5">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ringo-text truncate">{r.name}</p>
              {r.description && <p className="text-xs text-ringo-muted truncate">{r.description}</p>}
            </div>
            <span className="text-sm font-semibold text-ringo-indigo shrink-0 tabular-nums">{a.pointsShort(r.points_cost)}</span>
            <button onClick={() => toggleActive(r)} className="text-xs px-2.5 py-1.5 rounded-full border border-ringo-border hover:bg-ringo-muted/10 transition shrink-0">
              {r.active ? a.deactivateAction : a.activateAction}
            </button>
            <button onClick={() => remove(r)} className="text-xs px-2.5 py-1.5 rounded-full border border-ringo-border text-ringo-coral hover:bg-ringo-coral/10 transition shrink-0">
              {a.deleteAction}
            </button>
          </div>
        ))}
        {rewards.length === 0 && <EmptyState text={a.noRewardsYet} />}
      </div>
    </div>
  );
}

function SettingsPanel({
  associationProfileId,
  initialSettings,
  a,
}: {
  associationProfileId: string;
  initialSettings: { points_per_amount: number; amount_unit: number; default_momo_number: string | null } | null;
  a: any;
}) {
  const [pointsPerAmount, setPointsPerAmount] = useState(String(initialSettings?.points_per_amount ?? 1));
  const [amountUnit, setAmountUnit] = useState(String(initialSettings?.amount_unit ?? 100));
  const [momoNumber, setMomoNumber] = useState(initialSettings?.default_momo_number || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    await fetch("/api/association/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        associationProfileId,
        pointsPerAmount: Number(pointsPerAmount),
        amountUnit: Number(amountUnit),
        defaultMomoNumber: momoNumber,
      }),
    });
    setSaving(false);
    setSaved(true);
  };

  return (
    <div className="max-w-sm flex flex-col gap-4">
      <div className="rounded-2xl border border-ringo-border/70 p-4 flex flex-col gap-3">
        <p className="text-sm font-semibold text-ringo-text flex items-center gap-2">
          <Settings2 size={15} /> {a.pointsRateTitle}
        </p>
        <p className="text-xs text-ringo-muted">{a.pointsRateHint}</p>
        <div className="flex items-center gap-2">
          <input
            value={pointsPerAmount}
            onChange={(e) => setPointsPerAmount(e.target.value)}
            type="number"
            min={0.01}
            step="any"
            className="w-20 border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-surface"
          />
          <span className="text-xs text-ringo-muted">{a.pointsRatePer}</span>
          <input
            value={amountUnit}
            onChange={(e) => setAmountUnit(e.target.value)}
            type="number"
            min={1}
            className="w-24 border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-surface"
          />
          <span className="text-xs text-ringo-muted">{a.pointsRateCurrency}</span>
        </div>
      </div>

      <div className="rounded-2xl border border-ringo-border/70 p-4 flex flex-col gap-2">
        <p className="text-sm font-semibold text-ringo-text">{a.defaultMomoTitle}</p>
        <p className="text-xs text-ringo-muted">{a.defaultMomoHint}</p>
        <input
          value={momoNumber}
          onChange={(e) => setMomoNumber(e.target.value)}
          placeholder={a.momoNumberPlaceholder}
          className="border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-surface"
        />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold bg-ringo-indigo text-white disabled:opacity-60">
          {saving && <Loader2 size={14} className="animate-spin" />}
          {a.saveSettingsCta}
        </button>
        {saved && (
          <span className="text-xs flex items-center gap-1 text-ringo-teal">
            <Check size={13} /> {a.saved}
          </span>
        )}
      </div>
    </div>
  );
}

function ActivityPanel({ associationProfileId, a }: { associationProfileId: string; a: any }) {
  const [transactions, setTransactions] = useState<any[] | null>(null);

  useEffect(() => {
    fetch(`/api/association/transactions?associationProfileId=${associationProfileId}`)
      .then((r) => r.json())
      .then((d) => setTransactions(d.transactions || []));
  }, [associationProfileId]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <a
          href={`/api/association/export?associationProfileId=${associationProfileId}`}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold border border-ringo-border text-ringo-text hover:bg-ringo-muted/10 transition"
        >
          <Download size={15} />
          {a.exportCsvCta}
        </a>
      </div>

      <div className="flex flex-col gap-2">
        {transactions === null && (
          <div className="flex justify-center py-6">
            <Loader2 size={18} className="animate-spin text-ringo-muted" />
          </div>
        )}
        {transactions?.map((tx) => (
          <div key={tx.id} className="flex items-center gap-3 rounded-2xl border border-ringo-border/70 p-3.5">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ringo-text truncate">
                {tx.association_members?.name || "—"}
                {tx.profiles && ` · ${tx.profiles.name || tx.profiles.username}`}
              </p>
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
        {transactions?.length === 0 && <EmptyState text={a.noActivityYet} />}
      </div>
    </div>
  );
}
