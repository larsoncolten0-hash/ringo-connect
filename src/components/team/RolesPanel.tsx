"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Check, X } from "lucide-react";
import { PERMISSION_GROUPS, type Permission } from "@/lib/team/permissions";
import { useLanguage } from "@/components/LanguageProvider";

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  permissions: Permission[];
  is_system: boolean;
}

// Roles + permissions, with progressive disclosure: the role list is a
// plain, glanceable set of chips by default — the full checkbox grid (see
// PERMISSION_GROUPS) only appears once someone actually opens a role to
// edit it or starts creating a custom one. Only rendered by TeamView when
// the caller holds staff.manage (or is the owner) — see that component's
// own gating.
export default function RolesPanel({
  profileId,
  roles,
  myPermissions,
  isOwner,
  onChanged,
}: {
  profileId: string;
  roles: RoleRow[];
  myPermissions: Permission[];
  isOwner: boolean;
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const canGrant = (p: Permission) => isOwner || myPermissions.includes(p);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ringo-muted">Roles define what a team member can access. Assign one per person from the Team tab.</p>
        <button
          onClick={() => setCreating(true)}
          className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-ringo-indigo hover:underline"
        >
          <Plus size={14} />
          Custom role
        </button>
      </div>

      {creating && (
        <RoleForm
          profileId={profileId}
          canGrant={canGrant}
          onCancel={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            onChanged();
          }}
        />
      )}

      <div className="flex flex-col gap-2.5">
        {roles.map((role) =>
          editingId === role.id ? (
            <RoleForm
              key={role.id}
              profileId={profileId}
              canGrant={canGrant}
              existing={role}
              onCancel={() => setEditingId(null)}
              onSaved={() => {
                setEditingId(null);
                onChanged();
              }}
            />
          ) : (
            <div key={role.id} className="rounded-2xl border border-ringo-border/70 p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ringo-text">{role.name}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {role.permissions.length === 0 ? (
                      <span className="text-[11px] text-ringo-muted">No permissions</span>
                    ) : (
                      role.permissions.map((p) => (
                        <span key={p} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-ringo-indigo/10 text-ringo-indigo">
                          {p}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setEditingId(role.id)} aria-label="Edit role" className="w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10 transition">
                    <Pencil size={14} />
                  </button>
                  <DeleteRoleButton profileId={profileId} roleId={role.id} onDeleted={onChanged} />
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function RoleForm({
  profileId,
  canGrant,
  existing,
  onCancel,
  onSaved,
}: {
  profileId: string;
  canGrant: (p: Permission) => boolean;
  existing?: RoleRow;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState(existing?.name || "");
  const [selected, setSelected] = useState<Set<Permission>>(new Set(existing?.permissions || []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggle = (p: Permission) => {
    if (!canGrant(p) && !selected.has(p)) return; // can't add a permission you don't hold — removing is always allowed
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Give the role a name.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(existing ? `/api/team/roles/${existing.id}` : "/api/team/roles", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, name: name.trim(), permissions: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not save the role.");
      onSaved();
    } catch (err: any) {
      setError(err?.message || "Could not save the role.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-ringo-indigo/30 bg-ringo-indigo/[0.03] p-3.5 flex flex-col gap-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Head Chef"
        className="w-full text-sm font-medium border border-ringo-border rounded-card px-3 py-2.5 bg-ringo-bg text-ringo-text"
      />

      <div className="flex flex-col gap-2.5 max-h-64 overflow-y-auto pr-1">
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ringo-muted mb-1">{group.labelKey === "loyalty" ? t.loyalty.permissionGroup : group.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.permissions.map((p) => {
                const active = selected.has(p);
                const disabled = !canGrant(p) && !active;
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggle(p)}
                    className={`text-[11px] font-medium px-2 py-1 rounded-full border transition ${
                      active
                        ? "bg-ringo-indigo text-white border-ringo-indigo"
                        : disabled
                        ? "border-ringo-border/50 text-ringo-muted/40 cursor-not-allowed"
                        : "border-ringo-border text-ringo-muted hover:border-ringo-indigo/40"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-ringo-coral">{error}</p>}

      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2 rounded-full text-xs font-semibold border border-ringo-border text-ringo-text hover:bg-ringo-muted/10 transition">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex-[2] flex items-center justify-center gap-2 py-2 rounded-full text-xs font-semibold bg-ringo-indigo text-white hover:brightness-110 transition disabled:opacity-70"
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          Save role
        </button>
      </div>
    </div>
  );
}

function DeleteRoleButton({ profileId, roleId, onDeleted }: { profileId: string; roleId: string; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const doDelete = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/team/roles/${roleId}?profileId=${profileId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not delete this role.");
      onDeleted();
    } catch (err: any) {
      setError(err?.message || "Could not delete this role.");
      setBusy(false);
    }
  };

  if (confirming) {
    return (
      <span className="flex items-center gap-1">
        {error && <span className="text-[10px] text-ringo-coral mr-1">{error}</span>}
        <button onClick={doDelete} disabled={busy} aria-label="Confirm delete" className="w-8 h-8 rounded-full flex items-center justify-center text-ringo-coral hover:bg-ringo-coral/10 transition">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        </button>
        <button onClick={() => setConfirming(false)} aria-label="Cancel delete" className="w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10 transition">
          <X size={14} />
        </button>
      </span>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} aria-label="Delete role" className="w-8 h-8 rounded-full flex items-center justify-center text-ringo-muted hover:bg-ringo-coral/10 hover:text-ringo-coral transition">
      <Trash2 size={14} />
    </button>
  );
}
