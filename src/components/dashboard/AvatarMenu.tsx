"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, LogOut } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

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