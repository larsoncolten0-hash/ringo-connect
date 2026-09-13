"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, LogOut, Volume2, VolumeX, Bell, BellOff } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { useSound } from "@/components/SoundProvider";
import { usePushToggle } from "@/lib/push/usePushToggle";
import AddToHomeScreenMenuItem from "@/components/dashboard/AddToHomeScreenMenuItem";

export default function AvatarMenu({
  email,
  username,
  avatarUrl,
  planName,
}: {
  email: string;
  username: string;
  avatarUrl?: string | null;
  planName: string;
}) {
  const { t } = useLanguage();
  const { enabled: soundEnabled, setEnabled: setSoundEnabled } = useSound();
  // Manual on/off control — the primary way in is now the proactive
  // PushPermissionPrompt shown on page load (see DashboardShell.tsx), so
  // this only matters for someone who dismissed that or wants to turn it
  // back off later.
  const { status: pushStatus, busy: pushBusy, toggle: togglePush } = usePushToggle("/api/push/subscribe");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const initial = username?.[0]?.toUpperCase() || "?";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center bg-ringo-indigo text-white text-sm font-medium ring-2 ring-transparent hover:ring-ringo-indigo/30 transition"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={username} className="w-full h-full object-cover" />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_8px_30px_-6px_rgba(15,23,42,0.15)] py-1.5 z-50 animate-dropdown-in">
          <div className="px-3.5 py-3 border-b border-ringo-border/70">
            <p className="text-sm font-medium text-ringo-text truncate">@{username}</p>
            <p className="text-xs text-ringo-muted truncate">{email}</p>
            <span className="inline-block mt-2 text-[10px] font-medium uppercase tracking-wide text-ringo-indigo bg-ringo-indigo/10 px-2 py-0.5 rounded-full">
              {planName} {t.account.plan}
            </span>
          </div>

          <Link
            href={`/${username}`}
            target="_blank"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3.5 py-2.5 text-sm text-ringo-text hover:bg-ringo-muted/10 transition-colors"
          >
            <ExternalLink size={14} />
            {t.account.viewPage}
          </Link>
          {/* Global sound preference — the closest thing this dashboard has
              to a dedicated Settings page, so it lives here. Toggling it
              doesn't close the menu (unlike the links above it) since it's
              a switch someone might flip and immediately want to see
              reflected, not a navigation action. */}
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            aria-pressed={soundEnabled}
            className="flex items-center justify-between gap-2 w-full px-3.5 py-2.5 text-sm text-ringo-text hover:bg-ringo-muted/10 transition-colors text-left"
          >
            <span className="flex items-center gap-2">
              {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
              {t.account.soundEffects}
            </span>
            <span
              className={`relative w-8 h-[18px] rounded-full transition-colors shrink-0 ${
                soundEnabled ? "bg-ringo-indigo" : "bg-ringo-muted/30"
              }`}
            >
              <span
                className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                  soundEnabled ? "translate-x-[16px]" : "translate-x-[2px]"
                }`}
              />
            </span>
          </button>
          {pushStatus !== "unsupported" && (
            <button
              onClick={togglePush}
              disabled={pushBusy}
              aria-pressed={pushStatus === "on"}
              className="flex items-center justify-between gap-2 w-full px-3.5 py-2.5 text-sm text-ringo-text hover:bg-ringo-muted/10 transition-colors text-left disabled:opacity-60"
            >
              <span className="flex items-center gap-2">
                {pushStatus === "on" ? <Bell size={14} /> : <BellOff size={14} />}
                {t.account.pushNotifications}
              </span>
              <span
                className={`relative w-8 h-[18px] rounded-full transition-colors shrink-0 ${
                  pushStatus === "on" ? "bg-ringo-indigo" : "bg-ringo-muted/30"
                }`}
              >
                <span
                  className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                    pushStatus === "on" ? "translate-x-[16px]" : "translate-x-[2px]"
                  }`}
                />
              </span>
            </button>
          )}
          <AddToHomeScreenMenuItem onNavigate={() => setOpen(false)} />
          <Link
            href="/auth/logout"
            className="flex items-center gap-2 px-3.5 py-2.5 text-sm text-ringo-coral hover:bg-ringo-coral/10 transition-colors"
          >
            <LogOut size={14} />
            {t.account.logout}
          </Link>
        </div>
      )}
    </div>
  );
}