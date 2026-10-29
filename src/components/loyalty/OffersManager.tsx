"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { api, fmtDate, fmtMoney, newKey } from "@/components/loyalty/format";

// The business's offers: create, start, end, announce, and apply one at the till. An offer is announced ONLY to customers whose effective marketing consent allows the channel, and the business is
// shown counts, never who. Applying an offer needs no marketing consent (it is a discount at the till, not a message).
type Promo = {
  id: string; title: string; description: string | null; kind: "percent" | "amount"; value: number; currency: string | null; code: string;
  audience: string; starts_at: string | null; ends_at: string | null; max_redemptions: number | null; per_customer_limit: number;
  status: "draft" | "active" | "ended"; sent_at: string | null; redemptions: number; live: boolean;
};
type Hit = { connectionId: string; name: string; emailHint: string | null; phoneHint: string | null };
const AUDIENCES = ["all", "new", "returning", "vip", "inactive"] as const;
const EMPTY = { title: "", description: "", kind: "percent", value: "", code: "", audience: "all", ends_at: "", max_redemptions: "", per_customer_limit: "1" };

export default function OffersManager({ can }: { can: { scan: boolean; manage: boolean } }) {
  const { t, locale } = useLanguage();
  const o = t.loyalty.retention.offers;
  const seg = t.loyalty.retention.segments;
  const [items, setItems] = useState<Promo[] | null>(null);
  const [currency, setCurrency] = useState("XAF");
  const [form, setForm] = useState({ ...EMPTY });
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [preview, setPreview] = useState<Record<string, { email: number; push: number }>>({});
  const err = (code?: string) => (code && (o.errors as Record<string, string>)[code]) || o.errors.generic;

  async function load() {
    const r = await api<{ items?: Promo[]; currency?: string }>("/api/loyalty/promotions");
    if (r.status === 200 && Array.isArray(r.data?.items)) {
      setItems(r.data!.items!);
      if (r.data!.currency) setCurrency(r.data!.currency);
    } else setItems([]);
  }
  useEffect(() => {
    if (can.manage || can.scan) load();
    else setItems([]);
  }, [can.manage, can.scan]);

  const valueText = (p: Promo) => (p.kind === "percent" ? o.percentOff(p.value) : o.amountOff(fmtMoney(p.value, p.currency || currency, locale)));

  async function create() {
    setNotice(null);
    const value = Number(form.value);
    const body: Record<string, unknown> = { title: form.title, kind: form.kind, value, audience: form.audience, per_customer_limit: Number(form.per_customer_limit) || 1 };
    if (form.description.trim()) body.description = form.description.trim();
    if (form.code.trim()) body.code = form.code.trim();
    if (form.ends_at) body.ends_at = new Date(form.ends_at).toISOString();
    if (form.max_redemptions) body.max_redemptions = Number(form.max_redemptions);
    const r = await api<{ error?: string }>("/api/loyalty/promotions", { method: "POST", body });
    if (r.status === 201) {
      setForm({ ...EMPTY });
      setShowForm(false);
      await load();
    } else setNotice({ kind: "error", text: err(r.data?.error) });
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setNotice(null);
    const r = await api<{ error?: string }>(`/api/loyalty/promotions/${id}`, { method: "PATCH", body });
    if (r.status === 200) await load();
    else setNotice({ kind: "error", text: err(r.data?.error) });
  }
  async function remove(id: string) {
    const r = await api(`/api/loyalty/promotions/${id}`, { method: "DELETE" });
    if (r.status === 200) await load();
    else setNotice({ kind: "error", text: o.errors.generic });
  }
  async function showAudience(id: string) {
    const r = await api<{ email?: number; push?: number; error?: string }>(`/api/loyalty/promotions/${id}/audience`);
    if (r.status === 200) setPreview((p) => ({ ...p, [id]: { email: r.data?.email ?? 0, push: r.data?.push ?? 0 } }));
    else setNotice({ kind: "error", text: err(r.data?.error) });
  }
  async function announce(id: string) {
    const counts = preview[id];
    if (!counts) return showAudience(id);
    if (!window.confirm(o.sendConfirm(counts.email, counts.push))) return;
    const r = await api<{ email_sent?: number; push_sent?: number; error?: string }>(`/api/loyalty/promotions/${id}/send`, { method: "POST", body: { confirm: true } });
    if (r.status === 200) {
      setNotice({ kind: "ok", text: o.sent(r.data?.email_sent ?? 0, r.data?.push_sent ?? 0) });
      await load();
    } else setNotice({ kind: "error", text: err(r.data?.error) });
  }

  // ---- the till
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [picked, setPicked] = useState<Hit | null>(null);
  const [offerId, setOfferId] = useState("");
  const [amount, setAmount] = useState("");
  const [till, setTill] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const live = (items || []).filter((p) => p.live);

  async function search() {
    const r = await api<{ hits?: Hit[] }>(`/api/loyalty/customers/search?q=${encodeURIComponent(q)}`);
    setHits(r.status === 200 ? r.data?.hits ?? [] : []);
  }
  async function apply() {
    setTill(null);
    if (!picked || !offerId) return;
    const r = await api<{ outcome?: string; discount?: number; error?: string }>("/api/loyalty/promotions/redeem", {
      method: "POST",
      body: { connection_id: picked.connectionId, promotion_id: offerId, amount: Number(amount), key: newKey() },
    });
    const outcome = r.data?.outcome || r.data?.error;
    const text = (outcome && ((o.outcomes as Record<string, string>)[outcome] || (o.errors as Record<string, string>)[outcome])) || o.errors.generic;
    const p = (items || []).find((x) => x.id === offerId);
    setTill({ kind: r.status === 200 ? "ok" : "error", text: r.status === 200 && typeof r.data?.discount === "number" ? `${text} ${o.redeem.discount(fmtMoney(r.data.discount, p?.currency || currency, locale))}` : text });
    if (r.status === 200) {
      setAmount("");
      load();
    }
  }

  const field = "w-full rounded-lg border border-ringo-border bg-transparent p-2 text-sm text-ringo-text";
  const label = "block text-xs font-medium text-ringo-muted";

  return (
    <div className="flex flex-col gap-5">
      {can.manage && (
        <section className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ringo-text">{o.title}</h2>
              <p className="mt-1 text-sm text-ringo-muted">{o.intro}</p>
            </div>
            <button type="button" onClick={() => setShowForm((v) => !v)} className="shrink-0 rounded-full bg-ringo-indigo px-4 py-2 text-sm font-medium text-white">{showForm ? o.actions.cancel : o.create}</button>
          </div>
          <p className="mt-2 text-xs text-ringo-muted">{t.loyalty.retention.consentNote}</p>

          {showForm && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className={label}>{o.fields.title}</span><input className={field} maxLength={80} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
              <label className="sm:col-span-2"><span className={label}>{o.fields.description}</span><textarea className={field} rows={2} maxLength={400} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              <label><span className={label}>{o.fields.kind}</span>
                <select className={field} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="percent">{o.fields.percent}</option>
                  <option value="amount">{o.fields.amount}</option>
                </select>
              </label>
              <label><span className={label}>{form.kind === "percent" ? o.fields.valuePercent : `${o.fields.valueAmount} (${currency})`}</span><input className={field} inputMode="numeric" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value.replace(/\D/g, "") })} /></label>
              <label><span className={label}>{o.fields.code}</span><input className={field} maxLength={16} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} /><span className="text-xs text-ringo-muted">{o.fields.codeHint}</span></label>
              <label><span className={label}>{o.fields.audience}</span>
                <select className={field} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                  {AUDIENCES.map((a) => <option key={a} value={a}>{a === "all" ? o.fields.audienceAll : seg[a]}</option>)}
                </select>
              </label>
              <label><span className={label}>{o.fields.endsAt}</span><input type="datetime-local" className={field} value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label>
              <label><span className={label}>{o.fields.maxRedemptions}</span><input className={field} inputMode="numeric" value={form.max_redemptions} onChange={(e) => setForm({ ...form, max_redemptions: e.target.value.replace(/\D/g, "") })} /></label>
              <label><span className={label}>{o.fields.perCustomer}</span><input className={field} inputMode="numeric" value={form.per_customer_limit} onChange={(e) => setForm({ ...form, per_customer_limit: e.target.value.replace(/\D/g, "") })} /></label>
              <div className="sm:col-span-2"><button type="button" onClick={create} disabled={!form.title.trim() || !form.value} className="rounded-full bg-ringo-indigo px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{o.actions.save}</button></div>
            </div>
          )}

          {items !== null && items.length === 0 && !showForm && <p className="mt-4 text-sm text-ringo-muted">{o.empty}</p>}
          <ul className="mt-4 divide-y divide-ringo-border/50">
            {(items || []).map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ringo-text">{p.title} <span className="font-normal text-ringo-muted">· {valueText(p)}</span></p>
                    <p className="text-xs text-ringo-muted">
                      {o.fields.code}: <span className="font-mono">{p.code}</span> · {p.audience === "all" ? o.fields.audienceAll : seg[p.audience as keyof typeof seg]} · {p.live ? o.status.live : o.status[p.status]}{p.sent_at ? ` · ${o.status.sent}` : ""} · {o.uses(p.redemptions)}{p.ends_at ? ` · ${fmtDate(p.ends_at, locale)}` : ""}
                    </p>
                    {p.description && <p className="mt-1 text-sm text-ringo-text">{p.description}</p>}
                    {preview[p.id] && <p className="mt-1 text-xs text-ringo-text">{o.preview(preview[p.id].email, preview[p.id].push)} <span className="text-ringo-muted">· {o.previewNote}</span></p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {p.status === "draft" && <button type="button" onClick={() => patch(p.id, { status: "active" })} className="rounded-full bg-ringo-indigo px-3 py-1 text-xs font-medium text-white">{o.actions.activate}</button>}
                    {p.status === "active" && !p.sent_at && <button type="button" onClick={() => showAudience(p.id)} className="rounded-full border border-ringo-border px-3 py-1 text-xs font-medium text-ringo-text">{o.actions.preview}</button>}
                    {p.status === "active" && !p.sent_at && preview[p.id] && <button type="button" onClick={() => announce(p.id)} className="rounded-full bg-ringo-indigo px-3 py-1 text-xs font-medium text-white">{o.actions.send}</button>}
                    {p.status === "active" && <button type="button" onClick={() => patch(p.id, { status: "ended" })} className="rounded-full border border-ringo-border px-3 py-1 text-xs font-medium text-ringo-text">{o.actions.end}</button>}
                    {p.status === "draft" && <button type="button" onClick={() => remove(p.id)} className="rounded-full border border-ringo-border px-3 py-1 text-xs font-medium text-ringo-text">{o.actions.remove}</button>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {notice && <p role="status" className={`mt-3 text-xs font-medium ${notice.kind === "ok" ? "text-emerald-600" : "text-red-500"}`}>{notice.text}</p>}
        </section>
      )}

      {can.scan && (
        <section className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
          <h2 className="text-base font-semibold text-ringo-text">{o.redeem.title}</h2>
          <p className="mt-1 text-sm text-ringo-muted">{o.redeem.intro}</p>
          <div className="mt-3 flex gap-2">
            <input aria-label={o.redeem.customer} className={field} placeholder={o.redeem.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" onClick={search} disabled={q.trim().length < 3} className="shrink-0 rounded-full border border-ringo-border px-4 py-2 text-sm font-medium text-ringo-text disabled:opacity-50">{o.redeem.search}</button>
          </div>
          {hits.length > 0 && (
            <ul className="mt-2 divide-y divide-ringo-border/50">
              {hits.map((h) => (
                <li key={h.connectionId}>
                  <button type="button" onClick={() => { setPicked(h); setHits([]); }} className="w-full py-2 text-left text-sm text-ringo-text">
                    {h.name} <span className="text-xs text-ringo-muted">{[h.emailHint, h.phoneHint].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {picked && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <p className="text-sm font-semibold text-ringo-text sm:col-span-3">{o.redeem.customer}: {picked.name}</p>
              <label><span className={label}>{o.redeem.offer}</span>
                <select className={field} value={offerId} onChange={(e) => setOfferId(e.target.value)}>
                  <option value="" />
                  {live.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.code})</option>)}
                </select>
              </label>
              <label><span className={label}>{o.redeem.amount} ({currency})</span><input className={field} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} /></label>
              <div className="flex items-end"><button type="button" onClick={apply} disabled={!offerId || !amount} className="rounded-full bg-ringo-indigo px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{o.redeem.apply}</button></div>
            </div>
          )}
          {till && <p role="status" className={`mt-3 text-sm font-medium ${till.kind === "ok" ? "text-emerald-600" : "text-red-500"}`}>{till.text}</p>}
        </section>
      )}
    </div>
  );
}
