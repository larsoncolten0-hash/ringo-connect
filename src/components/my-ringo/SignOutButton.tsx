"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// Uses the EXISTING /api/customer/logout route (revokes this device's
// session and clears the cookie). A full navigation afterwards, not a client
// transition, so no cached My Ringo page stays in the router cache.
export default function SignOutButton() {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/customer/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } finally {
      window.location.replace("/my-ringo/signin");
    }
  };

  return (
    <button
      onClick={logout}
      disabled={busy}
      className="flex items-center justify-center gap-2 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-5 py-3.5 text-sm font-medium text-red-600 transition hover:bg-red-500/5 active:scale-[0.99] disabled:opacity-60"
    >
      {busy ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
      {busy ? t.myRingo.me.loggingOut : t.myRingo.me.logout}
    </button>
  );
}
