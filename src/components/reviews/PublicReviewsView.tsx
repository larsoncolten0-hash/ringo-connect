"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { fmtDate } from "@/components/loyalty/format";

// The public reviews page body. Shows only what the server passed in: a first name and last initial, stars, words, the owner's reply. No e-mail, phone or id ever reaches this component.
type Data = { count: number; average: number | null; items: Array<{ reviewer: string; rating: number; body: string | null; owner_reply: string | null; created_at: string }> };

export default function PublicReviewsView({ username, name, data }: { username: string; name: string; data: Data }) {
  const { t, locale } = useLanguage();
  const p = t.loyalty.retention.public;
  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <Link href={`/${username}`} className="text-sm text-ringo-muted underline">{p.back}</Link>
      <h1 className="mt-3 font-display text-xl font-medium text-ringo-text">{name} · {p.title}</h1>
      {data.average !== null && <p className="mt-1 text-sm font-medium text-ringo-text">{"★".repeat(Math.round(data.average))}{"☆".repeat(5 - Math.round(data.average))} {p.average(data.average.toFixed(1), data.count)}</p>}
      {data.items.length === 0 ? (
        <p className="mt-6 text-sm text-ringo-muted">{p.none}</p>
      ) : (
        <ul className="mt-5 flex flex-col gap-4">
          {data.items.map((r, i) => (
            <li key={i} className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4">
              <p className="text-sm font-semibold text-ringo-text">{r.reviewer} <span className="font-normal text-amber-500">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span></p>
              <p className="text-xs text-ringo-muted">{fmtDate(r.created_at, locale)}</p>
              {r.body && <p className="mt-2 whitespace-pre-line text-sm text-ringo-text">{r.body}</p>}
              {r.owner_reply && <p className="mt-2 rounded-lg bg-ringo-border/20 p-2 text-sm text-ringo-text"><span className="font-medium">{p.reply}: </span>{r.owner_reply}</p>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
