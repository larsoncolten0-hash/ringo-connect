"use client";

import { useState } from "react";
import { UserPlus, Loader2, Copy, Check, Ban, MoreVertical } from "lucide-react";
import AddTeamMemberModal from "@/components/team/AddTeamMemberModal";
import RolesPanel, { type RoleRow } from "@/components/team/RolesPanel";
import type { Permission } from "@/lib/team/permissions";

interface MemberRow {
  id: string;
  user_id: string;
  status: "active" | "inactive" | "removed";
  joined_at: string;
  role_id: string;
  organization_roles: { id: string; name: string; permissions: Permission[] } | null;
  profile: { name: string | null; username: string | null; avatar_url: string | null } | null;
  email: string | null;
}

interface InvitationRow {
  id: string;
  role_id: string;
  method: "manual" | "link";
  invitee_name: string | null;
  invitee_email: string | null;
  invitee_phone: string | null;
  status: "pending" | "accepted" | "expired" | "revoked" | "cancelled";
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  organization_roles: { name: string } | null;
}

type Tab = "members" | "invitations" | "roles";

export default function TeamView({
  profileId,
  organizationName,
  isOwner,
  myPermissions,
  initialMembers,
  initialInvitations,
  initialRoles,
  owner,
}: {
  profileId: string;
  organizationName: string;
  isOwner: boolean;
  myPermissions: Permission[];
  initialMembers: MemberRow[];
  initialInvitations: InvitationRow[];
  initialRoles: RoleRow[];
  owner: { name: string | null; username: string | null; avatarUrl: string | null; email: string };
}) {
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [roles, setRoles] = useState(initialRoles);
  const [tab, setTab] = useState<Tab>("members");
  const [showAdd, setShowAdd] = useState(false);

  const canInvite = isOwner || myPermissions.includes("staff.invite");
  const canManage = isOwner || myPermissions.includes("staff.manage");

  const refreshAll = async () => {
    const [membersRes, invitationsRes, rolesRes] = await Promise.all([
      fetch(`/api/team/members?profileId=${profileId}`),
      canInvite ? fetch(`/api/team/invitations?profileId=${profileId}`) : null,
      fetch(`/api/team/roles?profileId=${profileId}`),
    ]);
    if (membersRes.ok) setMembers((await membersRes.json()).members || []);
    if (invitationsRes?.ok) setInvitations((await invitationsRes.json()).invitations || []);
    if (rolesRes.ok) setRoles((await rolesRes.json()).roles || []);
  };

  const activeCount = members.filter((m) => m.status === "active").length + 1; // +1 for the owner

  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-lg font-semibold text-ringo-text">Team</h1>
          <p className="text-sm text-ringo-muted mt-0.5">
            {activeCount} member{activeCount === 1 ? "" : "s"} at {organizationName}
          </p>
        </div>
        {canInvite && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold bg-ringo-indigo text-white hover:brightness-110 active:scale-[0.98] transition shrink-0"
          >
            <UserPlus size={15} />
            Add Team Member
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b border-ringo-border/70">
        <TabButton active={tab === "members"} onClick={() => setTab("members")}>
          Members
        </TabButton>
        {canInvite && (
          <TabButton active={tab === "invitations"} onClick={() => setTab("invitations")}>
            Invitations {invitations.filter((i) => i.status === "pending").length > 0 && `(${invitations.filter((i) => i.status === "pending").length})`}
          </TabButton>
        )}
        {canManage && (
          <TabButton active={tab === "roles"} onClick={() => setTab("roles")}>
            Roles
          </TabButton>
        )}
      </div>

      {tab === "members" && (
        <div className="flex flex-col gap-2.5">
          <MemberCard
            name={owner.name || owner.username || "Owner"}
            subtitle={owner.email}
            roleName="Owner"
            status="active"
            avatarUrl={owner.avatarUrl}
            isOwnerRow
          />
          {members.map((m) => (
            <MemberEditableCard key={m.id} member={m} profileId={profileId} roles={roles} canManage={canManage} onChanged={refreshAll} />
          ))}
          {members.length === 0 && <EmptyState text="No team members yet — add one to get started." />}
        </div>
      )}

      {tab === "invitations" && canInvite && (
        <div className="flex flex-col gap-2.5">
          {invitations.map((inv) => (
            <InvitationCard key={inv.id} invitation={inv} profileId={profileId} onChanged={refreshAll} />
          ))}
          {invitations.length === 0 && <EmptyState text="No invitations yet." />}
        </div>
      )}

      {tab === "roles" && canManage && <RolesPanel profileId={profileId} roles={roles} myPermissions={myPermissions} isOwner={isOwner} onChanged={refreshAll} />}

      {showAdd && (
        <AddTeamMemberModal
          profileId={profileId}
          organizationName={organizationName}
          onClose={() => setShowAdd(false)}
          onCreated={refreshAll}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-ringo-teal/10 text-ringo-teal",
    inactive: "bg-ringo-muted/10 text-ringo-muted",
    pending: "bg-amber-500/10 text-amber-600",
    accepted: "bg-ringo-teal/10 text-ringo-teal",
    expired: "bg-ringo-muted/10 text-ringo-muted",
    revoked: "bg-red-500/10 text-red-500",
    cancelled: "bg-red-500/10 text-red-500",
  };
  return <span className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${styles[status] || ""}`}>{status}</span>;
}

function MemberCard({
  name,
  subtitle,
  roleName,
  status,
  avatarUrl,
  isOwnerRow,
  children,
}: {
  name: string;
  subtitle?: string | null;
  roleName: string;
  status: string;
  avatarUrl?: string | null;
  isOwnerRow?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-ringo-border/70 p-3.5">
      <Avatar url={avatarUrl} name={name} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ringo-text truncate">{name}</p>
        <p className="text-xs text-ringo-muted truncate">
          {roleName}
          {subtitle ? ` · ${subtitle}` : ""}
        </p>
      </div>
      <StatusBadge status={status} />
      {!isOwnerRow && children}
    </div>
  );
}

function MemberEditableCard({
  member,
  profileId,
  roles,
  canManage,
  onChanged,
}: {
  member: MemberRow;
  profileId: string;
  roles: RoleRow[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const name = member.profile?.name || member.profile?.username || member.email || "Team member";

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await fetch(`/api/team/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, ...body }),
      });
      onChanged();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <MemberCard name={name} subtitle={member.email} roleName={member.organization_roles?.name || "—"} status={member.status} avatarUrl={member.profile?.avatar_url}>
      {canManage && (
        <div className="relative shrink-0">
          <button
            onClick={() => setOpen((v) => !v)}
            disabled={busy}
            aria-label="Manage member"
            className="w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10 transition disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <MoreVertical size={14} />}
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute right-0 mt-1 w-48 rounded-xl border border-ringo-border/70 bg-ringo-surface shadow-lg py-1 z-20">
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ringo-muted">Change role</p>
                {roles.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => patch({ roleId: r.id })}
                    className={`flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-ringo-muted/10 transition ${r.id === member.role_id ? "text-ringo-indigo font-medium" : "text-ringo-text"}`}
                  >
                    {r.name}
                    {r.id === member.role_id && <Check size={12} />}
                  </button>
                ))}
                <div className="my-1 h-px bg-ringo-border/70" />
                {member.status === "active" ? (
                  <button onClick={() => patch({ status: "inactive" })} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-ringo-text hover:bg-ringo-muted/10 transition">
                    <Ban size={12} /> Deactivate
                  </button>
                ) : (
                  <button onClick={() => patch({ status: "active" })} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-ringo-text hover:bg-ringo-muted/10 transition">
                    <Check size={12} /> Reactivate
                  </button>
                )}
                <button onClick={() => patch({ status: "removed" })} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-ringo-coral hover:bg-ringo-coral/10 transition">
                  Remove from team
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </MemberCard>
  );
}

function InvitationCard({ invitation, profileId, onChanged }: { invitation: InvitationRow; profileId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const act = async (action: "revoke" | "resend") => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/team/invitations/${invitation.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Something went wrong.");
      if (action === "resend" && data.inviteUrl) {
        await navigator.clipboard.writeText(data.inviteUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }
      onChanged();
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const name = invitation.invitee_name || invitation.invitee_email || invitation.invitee_phone || "Invitation link";
  const expires = new Date(invitation.expires_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-ringo-border/70 p-3.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ringo-text truncate">{name}</p>
        <p className="text-xs text-ringo-muted truncate">
          {invitation.organization_roles?.name || "—"} · {invitation.status === "pending" ? `Expires ${expires}` : invitation.status === "accepted" && invitation.accepted_at ? `Accepted ${new Date(invitation.accepted_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : invitation.status}
        </p>
        {error && <p className="text-[11px] text-ringo-coral mt-0.5">{error}</p>}
      </div>
      <StatusBadge status={invitation.status} />
      {invitation.status === "pending" && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => act("resend")}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-medium border border-ringo-border text-ringo-text hover:bg-ringo-muted/10 transition disabled:opacity-60"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copied" : invitation.method === "link" ? "Copy Link" : "Resend"}
          </button>
          <button
            onClick={() => act("revoke")}
            disabled={busy}
            className="px-2.5 py-1.5 rounded-full text-[11px] font-medium border border-ringo-border text-ringo-coral hover:bg-ringo-coral/10 transition disabled:opacity-60"
          >
            Revoke
          </button>
        </div>
      )}
    </div>
  );
}
