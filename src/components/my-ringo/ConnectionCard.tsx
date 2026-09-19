"use client";

import Link from "next/link";
import { Check, ChevronRight, Star } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getCategory } from "@/lib/categories";
import type { MyConnection } from "@/lib/customer/connections";
import CustomerAvatar from "./CustomerAvatar";

// One connected Ringo profile. The whole card opens that profile's normal
// public page (/[username]) — profile data is read from `profiles`, never
// copied. Status is always "Connected" here because only ACTIVE connections
// are listed.
export default function ConnectionCard({ connection, showDate = false }: { connection: MyConnection; showDate?: boolean }) {
  const { t, locale } = useLanguage();
  const { profile } = connection;
  const category = getCategory(profile.category)?.label[locale] ?? null;

  return (
    <Link
      href={`/${profile.username}`}
      aria-label={`${t.myRingo.connections.openProfile}: ${profile.name}`}
      className="group flex items-center gap-3.5 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-3.5 transition hover:border-ringo-indigo/40 hover:shadow-sm active:scale-[0.99]"
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
  );
}
