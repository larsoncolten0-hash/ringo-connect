"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Shared by every organization-switching UI (desktop OrgSwitcher, the
// mobile "More" menu's workspace section) so there's exactly one
// implementation of "how a switch actually happens" — never two competing
// mobile/desktop organization systems, just two places that render the
// same list and call this. See /api/team/switch-org's own comment: this
// only ever changes which of the CALLER'S OWN organizations is active, and
// every page/route still re-derives real access from auth.uid() on every
// request, so it can never grant access to one they don't belong to.
export function useOrgSwitch() {
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const router = useRouter();

  const switchTo = async (profileId: string, currentProfileId: string) => {
    if (profileId === currentProfileId) return;
    setSwitchingTo(profileId);
    try {
      const res = await fetch("/api/team/switch-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (res.ok) {
        // A full navigation (not just router.refresh()) — switching
        // organizations changes category-specific routes too (Restaurant
        // vs Music vs neither), so landing back on the main dashboard is
        // the one destination that's always valid regardless of which
        // organization-specific pages the previous workspace exposed.
        router.push("/dashboard");
        router.refresh();
      }
    } finally {
      setSwitchingTo(null);
    }
  };

  return { switchTo, switchingTo };
}
