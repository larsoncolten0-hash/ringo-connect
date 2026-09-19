"use client";

import Link from "next/link";
import { Check, ChevronRight, Star } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getCategory } from "@/lib/categories";
import type { MyConnection } from "@/lib/customer/connections";
import CustomerAvatar from "./CustomerAvatar";

// One connected Ringo profile. The main area opens that profile's normal
// public page (/[username]) — profile data is read from `profiles`, never
// copied. Status is always "Connected" here because only ACTIVE connections
// are listed. When `onDisconnect` is given (the Connections page), a
// separate, deliberately quiet Disconnect action sits below the link so it
// can't be triggered by accident while tapping the card.
export default function ConnectionCard({
  connection,
  showDate = false,
  onDisconnect,
}: {
  connection: MyConnection;
  showDate?: boolean;
  onDisconnect?: (connection: MyConnection) => void;
}) {
  const { t, locale } = useLanguage();
  const { profile } = connection;
  const category = getCategory(profile.category)?.label[locale] ?? null;

  return (
    <div className="overflow-hidden rounded-2xl border border-ringo-border/70 bg-ringo-surface transition hover:border-ringo-indigo/40 hover:shadow-sm">
      <Link
        href={`/${profile.username}`}
        aria-label={`${t.myRingo.connections.openProfile}: ${profile.name}`}
        className="group flex items-center gap-3.5 p-3.5 transition active:scale-[0.99]"
      >
        <CustomerAvatar name={profile.name} avatarUrl={profile.avatarUrl} className="w-12 h-12 text-base" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-ringo-text">{profile.name}</p>
            {connection.isFavorite && (
              <Star size={13} className="shrink-0 fill-amber-400 text-amber-400" aria-label={t.myRingo.connections.favorite} />
            )}
          </div>
          <p className="truncate text-xs text-ringo-muted">
            @{profile.username}
            {category ? ` · ${category}` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
              <Check size={11} /> {t.myRingo.connections.statusConnected}
            </span>
            {showDate && (
              <span className="text-[11px] text-ringo-muted" suppressHydrationWarning>
                {t.myRingo.connections.connectedOn(
                  new Date(connection.connectedAt).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                )}
              </span>
            )}
          </div>
        </div>
        <ChevronRight size={18} className="shrink-0 text-ringo-muted transition group-hover:translate-x-0.5" />
      </Link>

      {onDisconnect && (
        <div className="flex justify-end border-t border-ringo-border/60 px-3.5 py-1.5">
          <button
            type="button"
            onClick={() => onDisconnect(connection)}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-ringo-muted transition hover:bg-red-500/10 hover:text-red-600"
          >
            {t.myRingo.disconnect.action}
          </button>
        </div>
      )}
    </div>
  );
}
