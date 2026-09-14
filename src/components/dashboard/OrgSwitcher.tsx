"use client";

import { useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { ChevronsUpDown, Check, Loader2 } from "lucide-react";
import MenuBackdrop from "@/components/ui/MenuBackdrop";
import { useOrgSwitch } from "@/lib/team/useOrgSwitch";
import { orgDisplayName, orgDisplaySubtitle, type OrgOption } from "@/lib/team/orgDisplay";

export type { OrgOption };

// Desktop sidebar organization switcher — only rendered by DashboardShell
// when someone belongs to more than one organization (their own, plus at
// least one they're a team member of). See src/lib/team/useOrgSwitch.ts
// for the actual switching logic, shared with the mobile equivalent in
// MobileMoreMenu.tsx.
export default function OrgSwitcher({ current, organizations }: { current: string; organizations: OrgOption[] }) {
  const [open, setOpen] = useState(false);
  const { switchTo, switchingTo } = useOrgSwitch();
  const ref = useRef<HTMLDivElement>(null);

  const currentOrg = organizations.find((o) => o.profileId === current);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-ringo-border/70 px-3 py-2.5 text-left transition hover:bg-ringo-muted/10"
      >
        <span className="min-w-0">
          <span className="block text-xs font-medium text-ringo-text truncate">{currentOrg ? orgDisplayName(currentOrg) : "Workspace"}</span>
          <span className="block text-[11px] text-ringo-muted truncate">{currentOrg ? orgDisplaySubtitle(currentOrg) : ""}</span>
        </span>
        {switchingTo ? <Loader2 size={14} className="animate-spin text-ringo-muted shrink-0" /> : <ChevronsUpDown size={14} className="text-ringo-muted shrink-0" />}
      </button>

      <AnimatePresence>{open && <MenuBackdrop key="backdrop" onClose={() => setOpen(false)} className="z-20" portal />}</AnimatePresence>

      {open && (
        <div className="absolute left-0 right-0 bottom-full mb-2 rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_8px_30px_-6px_rgba(15,23,42,0.15)] py-1.5 z-50 animate-dropdown-in max-h-64 overflow-y-auto">
          {organizations.map((org) => (
            <button
              key={org.profileId}
              onClick={() => {
                setOpen(false);
                switchTo(org.profileId, current);
              }}
              className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-sm text-ringo-text hover:bg-ringo-muted/10 transition-colors text-left"
            >
              <span className="min-w-0">
                <span className="block truncate">{orgDisplayName(org)}</span>
                <span className="block text-[11px] text-ringo-muted truncate">{orgDisplaySubtitle(org)}</span>
              </span>
              {org.profileId === current && <Check size={14} className="text-ringo-indigo shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
