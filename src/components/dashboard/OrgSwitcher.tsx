"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { ChevronsUpDown, Check, Loader2 } from "lucide-react";
import MenuBackdrop from "@/components/ui/MenuBackdrop";

export interface OrgOption {
  profileId: string;
  name: string;
  isOwner: boolean;
  roleName: string | null;
}

// Only rendered by DashboardShell when someone belongs to more than one
// organization (their own, plus at least one they're a team member of) —
// see the product spec's "organization switching" requirement. Switching
// only ever changes which of the caller's OWN organizations is active (see
// /api/team/switch-org's own comment) — it can never grant access to one
// they don't belong to.
export default function OrgSwitcher({ current, organizations }: { current: string; organizations: OrgOption[] }) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  const currentOrg = organizations.find((o) => o.profileId === current);

  const handleSwitch = async (profileId: string) => {
    if (profileId === current) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const res = await fetch("/api/team/switch-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (res.ok) {
        setOpen(false);
        router.push("/dashboard");
        router.refresh();
      }
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-ringo-border/70 px-3 py-2.5 text-left transition hover:bg-ringo-muted/10"
      >
        <span className="min-w-0">
          <span className="block text-xs font-medium text-ringo-text truncate">{currentOrg?.name || "Workspace"}</span>
          <span className="block text-[11px] text-ringo-muted truncate">{currentOrg?.isOwner ? "Owner" : currentOrg?.roleName || "Team member"}</span>
        </span>
        {switching ? <Loader2 size={14} className="animate-spin text-ringo-muted shrink-0" /> : <ChevronsUpDown size={14} className="text-ringo-muted shrink-0" />}
      </button>

      <AnimatePresence>{open && <MenuBackdrop key="backdrop" onClose={() => setOpen(false)} className="z-20" portal />}</AnimatePresence>

      {open && (
        <div className="absolute left-0 right-0 bottom-full mb-2 rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_8px_30px_-6px_rgba(15,23,42,0.15)] py-1.5 z-50 animate-dropdown-in max-h-64 overflow-y-auto">
          {organizations.map((org) => (
            <button
              key={org.profileId}
              onClick={() => handleSwitch(org.profileId)}
              className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-sm text-ringo-text hover:bg-ringo-muted/10 transition-colors text-left"
            >
              <span className="min-w-0">
                <span className="block truncate">{org.name}</span>
                <span className="block text-[11px] text-ringo-muted truncate">{org.isOwner ? "Owner" : org.roleName || "Team member"}</span>
              </span>
              {org.profileId === current && <Check size={14} className="text-ringo-indigo shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
