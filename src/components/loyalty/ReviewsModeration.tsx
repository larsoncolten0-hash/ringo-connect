"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { api, fmtDate } from "@/components/loyalty/format";

// The business's view of its reviews: hide or show one, reply once. It cannot change the rating or the words. The reviewer is shown as first name + initial only.
type Item = { id: string; reviewer: string; rating: number; body: string | null; status: "published" | "hidden"; owner_reply: string | null; created_at: string };

export default function ReviewsModeration({ available }: { available: boolean }) {
  const { t, locale } = useLanguage();
  const r = t.loyalty.retention.reviews;
  const [items, setItems] = useState<Item[] | null>(null);
  const [summary, setSummary] = useState<{ count: number; average: number | null } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);

  async function load() {
    const res = await api<{ items?: Item[]; summary?: { count: number; average: number | null } }>("/api/loyalty/reviews");
    if (res.status === 200 && Array.isArray(res.data?.items)) {
      setItems(res.data!.items!);
      setSummary(res.data!.summary ?? null);
    } else setItems([]);
  }
  useEffect(() => {
    if (available) load();
  }, [available]);

  async function patch(id: string, body: Record<string, unknown>) {
    setError(false);
    const res = await api(`/api/loyalty/reviews/${id}`, { method: "PATCH", body });
    if (res.status === 200) await load();
    else setError(true);
  }

  if (!available) return <p className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 text-sm text-ringo-muted">{r.churchUnavailable}</p>;

  return (
    <section className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
      <h2 className="text-base font-semibold text-ringo-text">{r.title}</h2>
      <p className="mt-1 text-sm text-ringo-muted">{r.intro}</p>
      {summary && summary.average !== null && <p className="mt-2 text-sm font-medium text-ringo-text">{r.average(summary.average.toFixed(1), summary.count)}</p>}
      {items === null ? null : items.length === 0 ? (
        <p className="mt-3 text-sm text-ringo-muted">{r.empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-ringo-border/50">
          {items.map((i) => (
            <li key={i.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ringo-text">
                    {i.reviewer} <span aria-label={`${i.rating} / 5`}>{"★".repeat(i.rating)}{"☆".repeat(5 - i.rating)}</span>
                  </p>
                  <p className="text-xs text-ringo-muted">{fmtDate(i.created_at, locale)}{i.status === "hidden" ? ` · ${r.hidden}` : ""}</p>
                  {i.body && <p className="mt-1 whitespace-pre-line text-sm text-ringo-text">{i.body}</p>}
                  {i.owner_reply && <p className="mt-2 rounded-lg bg-ringo-border/20 p-2 text-sm text-ringo-text">{i.owner_reply}</p>}
                </div>
                <button type="button" onClick={() => patch(i.id, { status: i.status === "hidden" ? "published" : "hidden" })} className="shrink-0 rounded-full border border-ringo-border px-3 py-1 text-xs font-medium text-ringo-text">
                  {i.status === "hidden" ? r.show : r.hide}
                </button>
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <textarea
                  aria-label={r.reply}
                  value={drafts[i.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [i.id]: e.target.value }))}
                  placeholder={r.replyPlaceholder}
                  maxLength={500}
                  rows={2}
                  className="min-w-0 flex-1 rounded-lg border border-ringo-border bg-transparent p-2 text-sm text-ringo-text"
                />
                <div className="flex gap-2 sm:flex-col">
                  <button type="button" disabled={!(drafts[i.id] ?? "").trim()} onClick={() => patch(i.id, { reply: drafts[i.id] }).then(() => setDrafts((d) => ({ ...d, [i.id]: "" })))} className="rounded-full bg-ringo-indigo px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
                    {r.saveReply}
                  </button>
                  {i.owner_reply && (
                    <button type="button" onClick={() => patch(i.id, { reply: null })} className="rounded-full border border-ringo-border px-3 py-1 text-xs font-medium text-ringo-text">
                      {r.removeReply}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="status" className="mt-2 text-xs font-medium text-red-500">{r.failed}</p>}
    </section>
  );
}
