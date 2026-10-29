"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { api } from "@/components/loyalty/format";

// The signed-in customer's reviews of the businesses they are connected to. A review can be written only after a real interaction (the server decides: can_review); churches and ministries are not
// listed at all. The customer comes from the cookie; the page never sends an id of its own.
type Review = { rating: number; body: string | null; status: "published" | "hidden"; owner_reply: string | null };
type Item = { profile_id: string; profile_name: string; can_review: boolean; review: Review | null };

function Row({ item, onChange }: { item: Item; onChange: () => void }) {
  const { t } = useLanguage();
  const r = t.myRingo.connections.reviews;
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(item.review?.rating ?? 0);
  const [body, setBody] = useState(item.review?.body ?? "");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function save() {
    setMsg(null);
    const res = await api("/api/customer/reviews", { method: "PUT", body: { profile_id: item.profile_id, rating, body: body.trim() || null } });
    if (res.status === 200) {
      setEditing(false);
      setMsg({ kind: "ok", text: r.saved });
      onChange();
    } else setMsg({ kind: "error", text: r.failed });
  }
  async function remove() {
    const res = await api(`/api/customer/reviews?profile_id=${item.profile_id}`, { method: "DELETE" });
    if (res.status === 200) {
      setMsg({ kind: "ok", text: r.removed });
      setRating(0);
      setBody("");
      onChange();
    } else setMsg({ kind: "error", text: r.failed });
  }

  const form = item.can_review && (editing || !item.review);
  return (
    <li className="py-3">
      <p className="text-sm font-semibold text-ringo-text">{item.profile_name}</p>
      {!item.can_review && !item.review && <p className="text-xs text-ringo-muted">{r.needInteraction}</p>}
      {item.review && !editing && (
        <div className="mt-1">
          <p className="text-sm text-ringo-text" aria-label={r.stars(item.review.rating)}>{"★".repeat(item.review.rating)}{"☆".repeat(5 - item.review.rating)}</p>
          {item.review.body && <p className="whitespace-pre-line text-sm text-ringo-text">{item.review.body}</p>}
          {item.review.status === "hidden" && <p className="text-xs text-ringo-muted">{r.hidden}</p>}
          {item.review.owner_reply && <p className="mt-1 rounded-lg bg-ringo-border/20 p-2 text-xs text-ringo-text"><span className="font-medium">{r.ownerReply}: </span>{item.review.owner_reply}</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setEditing(true)} className="rounded-full border border-ringo-border px-3 py-1 text-xs font-medium text-ringo-text">{r.edit}</button>
            <button type="button" onClick={remove} className="rounded-full border border-ringo-border px-3 py-1 text-xs font-medium text-ringo-text">{r.remove}</button>
          </div>
        </div>
      )}
      {form && (
        <div className="mt-1">
          <div role="radiogroup" aria-label={r.rating} className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={r.stars(n)} onClick={() => setRating(n)} className={`text-2xl leading-none ${n <= rating ? "text-amber-500" : "text-ringo-border"}`}>★</button>
            ))}
          </div>
          <textarea aria-label={r.placeholder} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={3} placeholder={r.placeholder} className="mt-2 w-full rounded-lg border border-ringo-border bg-transparent p-2 text-sm text-ringo-text" />
          <button type="button" onClick={save} disabled={rating < 1} className="mt-2 rounded-full bg-ringo-indigo px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50">{r.save}</button>
        </div>
      )}
      {msg && <p role="status" className={`mt-1 text-xs font-medium ${msg.kind === "ok" ? "text-emerald-600" : "text-red-500"}`}>{msg.text}</p>}
    </li>
  );
}

export default function ReviewsSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useLanguage();
  const r = t.myRingo.connections.reviews;
  const [items, setItems] = useState<Item[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api<{ items?: Item[] }>("/api/customer/reviews").then((res) => {
      if (alive) setItems(res.status === 200 && Array.isArray(res.data?.items) ? res.data!.items! : []);
    });
    return () => {
      alive = false;
    };
  }, [refreshKey, tick]);

  if (items === null) return null;
  return (
    <section className="mt-8 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4" aria-labelledby="reviews-title">
      <h2 id="reviews-title" className="text-sm font-semibold text-ringo-text">{r.title}</h2>
      <p className="mt-1 text-xs text-ringo-muted">{r.intro}</p>
      {items.length === 0 ? <p className="mt-3 text-xs text-ringo-muted">{r.empty}</p> : <ul className="mt-2 divide-y divide-ringo-border/50">{items.map((i) => <Row key={`${i.profile_id}:${i.review?.rating ?? 0}:${i.review?.body ?? ""}`} item={i} onChange={() => setTick((n) => n + 1)} />)}</ul>}
    </section>
  );
}
