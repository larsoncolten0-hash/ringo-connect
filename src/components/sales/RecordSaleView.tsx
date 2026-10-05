"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Users, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import { PAYMENT_METHODS } from "@/lib/documents/constants";
import { formatMoney } from "@/lib/documents/moneyFormat";
import { callApi, inputClass, labelClass, newRequestId, primaryButton, secondaryButton } from "@/components/documents/shared";
import { toLocalDateKey } from "@/lib/bookkeeping/summary";
import Disclosure from "@/components/ui/Disclosure";

// Record Sale: "I sold something." One short form in four parts: Sale (what, how many), Customer (optional), Payment, Summary. Saving is ONE atomic server operation that records the
// bookkeeping sale, reduces tracked stock and issues the receipt together (POST /api/sales -> sale_record). Nothing here computes a financial result: the
// total shown is only a preview, the database recomputes it exactly.

type Product = { id: string; name: string; price: string | null; product_type: string; tracked: boolean; stock: number | null };
type Item = { key: string; mode: "product" | "custom"; productId: string; description: string; quantity: string; unitPrice: string };
type Customer = { id: string; name: string };
type Recent = { id: string; number: string | null; total_minor: number | null; currency: string; issue_date: string | null; customer_name: string | null; status?: string };

const blank = (mode: Item["mode"]): Item => ({ key: newRequestId(), mode, productId: "", description: "", quantity: "1", unitPrice: "" });

export default function RecordSaleView() {
  const { t, locale } = useLanguage();
  const s = t.sales;
  const router = useRouter();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [currency, setCurrency] = useState("XAF");
  const [recent, setRecent] = useState<Recent[]>([]);
  const [items, setItems] = useState<Item[]>([blank("product")]);
  const [method, setMethod] = useState<string>("cash");
  const [date, setDate] = useState(() => toLocalDateKey(new Date(), "Africa/Douala"));
  const [note, setNote] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [picking, setPicking] = useState(false); // false: the owner types the customer's details (the default); true: they search their customer book
  const [dup, setDup] = useState<Customer | null>(null); // an existing customer with the same phone, offered instead of a second record
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Customer[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rid] = useState(newRequestId); // one id per open form: a double click or a retry replays the same sale instead of recording it twice
  const searchSeq = useRef(0);

  const errorText = useCallback((data: any) => {
    const code = typeof data?.error === "string" ? data.error : "generic";
    const detail = Array.isArray(data?.details) ? String(data.details[0] ?? "").split(":")[0] : "";
    return s.errors[code === "validation_failed" && detail && s.errors[detail] ? detail : code] ?? s.errors.generic;
  }, [s]);

  useEffect(() => {
    (async () => {
      const [p, r] = await Promise.all([callApi("GET", "/api/sales/products"), callApi("GET", "/api/sales")]);
      if (p.ok) { setProducts(p.data.items || []); if (p.data.currency) setCurrency(p.data.currency); } else setProducts([]);
      if (r.ok) setRecent(r.data.items || []);
    })();
  }, []);

  // customer search (debounced; a stale answer never overwrites a newer one)
  useEffect(() => {
    if (customer || !picking) return;
    const q = query.trim();
    if (q.length < 2) { setMatches([]); setSearched(false); return; }
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      const r = await callApi("GET", `/api/customers?q=${encodeURIComponent(q)}&status=active&limit=6`);
      if (seq !== searchSeq.current) return;
      setMatches(r.ok ? (r.data.items || []).map((c: any) => ({ id: c.id, name: c.name })) : []);
      setSearched(true);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, customer, picking]);

  const byId = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);
  const digits = currencyMinorDigits(currency);
  const lineMinor = (it: Item): number | null => {
    const p = it.mode === "product" ? byId.get(it.productId) : null;
    const price = it.unitPrice.trim() !== "" ? it.unitPrice.trim().replace(",", ".") : p?.price ?? "";
    const unit = parseMinor(price, digits);
    const qty = Number(it.quantity.trim().replace(",", "."));
    if (unit === null || !Number.isFinite(qty) || qty <= 0) return null;
    return Math.round(unit * qty);
  };
  const total = items.reduce<number | null>((sum, it) => { const m = lineMinor(it); return sum === null || m === null ? null : sum + m; }, 0);
  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it)));
  const phoneNeedsName = (newPhone.trim() !== "" || newLocation.trim() !== "") && newName.trim() === ""; // a phone or a location belongs to a named customer
  const ready = !phoneNeedsName && items.length > 0 && items.every((it) => (it.mode === "product" ? it.productId !== "" : it.description.trim() !== "") && lineMinor(it) !== null) && (total ?? 0) > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    let customerId = customer?.id ?? null;
    if (!customerId && newName.trim()) {
      // an existing customer with the same phone or e-mail is reported, never duplicated (the customer book's own rule): it is offered, not merged
      const c = await callApi("POST", "/api/receivables/customers", { name: newName.trim(), ...(newPhone.trim() ? { phone: newPhone.trim() } : {}), ...(newLocation.trim() ? { address: newLocation.trim() } : {}), client_request_id: newRequestId() });
      if (!c.ok) {
        setBusy(false);
        const existing = c.data?.existing;
        if (c.data?.error === "duplicate_customer" && typeof existing?.id === "string") return setDup({ id: existing.id, name: String(existing.name ?? "") });
        return setError(errorText(c.data));
      }
      customerId = c.data?.customer?.id ?? null;
    }
    const res = await callApi("POST", "/api/sales", {
      locale: locale === "en" ? "en" : "fr",
      lines: items.map((it) => it.mode === "product"
        ? { product_id: it.productId, quantity: it.quantity.trim(), ...(it.unitPrice.trim() ? { unit_price: it.unitPrice.trim() } : {}) }
        : { description: it.description.trim(), quantity: it.quantity.trim(), unit_price: it.unitPrice.trim() }),
      customer_id: customerId,
      method,
      sold_on: date,
      notes: note.trim() || undefined,
      client_request_id: rid,
    });
    setBusy(false);
    if (!res.ok) return setError(errorText(res.data));
    router.push(`/dashboard/documents/${encodeURIComponent(res.data.receipt.id)}?sale=1`);
  };

  const money = (minor: number | null) => (minor === null ? "—" : formatMoney(minor, currency, locale === "en" ? "en" : "fr"));
  const anyTracked = (products ?? []).some((p) => p.tracked);

  const section = "flex flex-col gap-4 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5";
  const Step = ({ n, title }: { n: number; title: string }) => (
    <h2 className="flex items-center gap-2.5 font-display text-base font-medium text-ringo-text">
      <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ringo-indigo/10 text-xs font-semibold text-ringo-indigo">{n}</span>
      {title}
    </h2>
  );

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em]">{s.title}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{s.intro}</p>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-5">
        <section className={section}>
          <Step n={1} title={s.whatSold} />
          {products === null && <div className="flex items-center gap-2 text-sm text-ringo-muted"><Loader2 size={16} className="animate-spin" /></div>}
          {products !== null && items.map((it) => {
            const p = it.mode === "product" ? byId.get(it.productId) : undefined;
            const qtyNum = Number(it.quantity.trim().replace(",", "."));
            return (
              <div key={it.key} className="flex flex-col gap-3 rounded-xl border border-ringo-border/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex rounded-card border border-ringo-border p-0.5 text-sm" role="group">
                    {(["product", "custom"] as const).map((m) => (
                      <button key={m} type="button" onClick={() => patch(it.key, { mode: m, productId: "", description: "", unitPrice: "" })}
                        className={`min-h-[44px] rounded-card px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50 ${it.mode === m ? "bg-ringo-indigo text-white" : "text-ringo-muted"}`}>
                        {m === "product" ? s.fromCatalogue : s.customItem}
                      </button>
                    ))}
                  </div>
                  {items.length > 1 && <button type="button" aria-label={s.removeItem} onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))} className="min-h-[44px] min-w-[44px] text-ringo-muted"><Trash2 size={16} className="mx-auto" /></button>}
                </div>
                {it.mode === "product" ? (
                  <label className={labelClass}>{s.product}
                    <select className={inputClass} value={it.productId} onChange={(e) => patch(it.key, { productId: e.target.value, unitPrice: "" })}>
                      <option value="">{s.chooseProduct}</option>
                      {(products ?? []).map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <label className={labelClass}>{s.description}<input className={inputClass} maxLength={300} value={it.description} onChange={(e) => patch(it.key, { description: e.target.value })} /></label>
                )}
                {it.mode === "product" && products.length === 0 && <p className="text-xs text-ringo-muted">{s.noProducts}</p>}
                {p && (
                  <p className={`text-xs ${p.tracked && p.stock !== null && Number.isFinite(qtyNum) && qtyNum > p.stock ? "text-rose-600" : "text-ringo-muted"}`}>
                    {p.tracked && p.stock !== null ? (Number.isFinite(qtyNum) && qtyNum > p.stock ? s.stockWarn(p.stock) : s.stockLeft(p.stock)) : s.stockNotTracked}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <label className={labelClass}>{s.quantity}<input className={inputClass} inputMode={it.mode === "product" ? "numeric" : "decimal"} value={it.quantity} onChange={(e) => patch(it.key, { quantity: e.target.value })} /></label>
                  <label className={labelClass}>{s.unitPrice} ({currency})
                    <input className={inputClass} inputMode="decimal" placeholder={p?.price ?? ""} value={it.unitPrice} onChange={(e) => patch(it.key, { unitPrice: e.target.value })} />
                  </label>
                </div>
                <p className="text-right text-xs text-ringo-muted tabular-nums">{s.lineTotal}: {money(lineMinor(it))}</p>
              </div>
            );
          })}
          {products !== null && items.length < 20 && (
            <button type="button" onClick={() => setItems((l) => [...l, blank("product")])} className={`${secondaryButton} w-fit`}><Plus size={15} />{s.addItem}</button>
          )}
          {products !== null && !anyTracked && products.length > 0 && (
            <div className="flex flex-col">
              <p className="text-xs text-ringo-muted">{s.trackHint}</p>
              <Link href="/dashboard/inventory" className="inline-flex min-h-[44px] w-fit items-center text-sm text-ringo-indigo underline">{s.openInventory}</Link>
            </div>
          )}
        </section>

        <section className={section}>
          <Step n={2} title={s.whoBought} />
          {customer ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-ringo-border/60 p-3 text-sm">
              <span><span className="text-ringo-muted">{s.pickedCustomer}: </span><span className="font-medium text-ringo-text">{customer.name}</span></span>
              <button type="button" onClick={() => { setCustomer(null); setQuery(""); }} className="inline-flex min-h-[44px] items-center gap-1 text-ringo-muted"><X size={14} />{s.clearCustomer}</button>
            </div>
          ) : picking ? (
            <div className="flex flex-col gap-2">
              <input className={inputClass} autoFocus placeholder={s.searchCustomer} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={s.searchCustomer} />
              {matches.length > 0 && (
                <ul className="flex flex-col divide-y divide-ringo-border/50 rounded-xl border border-ringo-border/60">
                  {matches.map((c) => <li key={c.id}><button type="button" onClick={() => { setCustomer(c); setMatches([]); setPicking(false); }} className="min-h-[44px] w-full px-3 text-left text-sm text-ringo-text">{c.name}</button></li>)}
                </ul>
              )}
              {searched && matches.length === 0 && <p className="text-xs text-ringo-muted">{s.noMatch}</p>}
              <button type="button" onClick={() => { setPicking(false); setQuery(""); setMatches([]); }} className="inline-flex min-h-[44px] w-fit items-center gap-1.5 text-sm text-ringo-muted underline underline-offset-2 hover:text-ringo-text">{s.enterNew}</button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className={labelClass}>{s.newCustomerName}
                  <input className={inputClass} maxLength={120} autoComplete="off" placeholder={s.namePlaceholder} value={newName} onChange={(e) => { setNewName(e.target.value); setDup(null); }} />
                </label>
                <label className={labelClass}><span>{s.customerPhone} <span className="font-normal">&middot; {s.optional}</span></span>
                  <input className={inputClass} type="tel" inputMode="tel" maxLength={40} autoComplete="off" value={newPhone} onChange={(e) => { setNewPhone(e.target.value); setDup(null); }} />
                </label>
              </div>
              <label className={labelClass}><span>{s.customerLocation} <span className="font-normal">&middot; {s.optional}</span></span>
                <input className={inputClass} maxLength={300} autoComplete="off" value={newLocation} onChange={(e) => { setNewLocation(e.target.value); setDup(null); }} />
              </label>
              {phoneNeedsName ? <p role="alert" className="text-xs text-rose-700 dark:text-rose-400">{s.errors.invalid_customer_name}</p> : <p className="text-xs text-ringo-muted">{s.walkIn}</p>}
              {dup && (
                <div role="status" className="flex flex-col gap-2 rounded-xl border border-ringo-indigo/30 bg-ringo-indigo/5 p-3 text-sm">
                  <p className="text-ringo-text">{s.dupFound(dup.name)}</p>
                  <button type="button" onClick={() => { setCustomer(dup); setDup(null); setNewName(""); setNewPhone(""); setNewLocation(""); }} className={`${secondaryButton} w-fit`}>{s.useDup(dup.name)}</button>
                </div>
              )}
              <button type="button" onClick={() => { setPicking(true); setDup(null); }} className="inline-flex min-h-[44px] w-fit items-center gap-1.5 text-sm text-ringo-muted underline underline-offset-2 hover:text-ringo-text"><Users size={15} />{s.chooseExisting}</button>
            </div>
          )}
        </section>

        <section className={section}>
          <Step n={3} title={s.howPaid} />
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={s.howPaid}>
            {PAYMENT_METHODS.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                className={`min-h-[44px] rounded-card border px-4 text-sm ${method === m ? "border-ringo-indigo bg-ringo-indigo text-white" : "border-ringo-border text-ringo-text"}`}>
                {t.documents.pdf.methods[m]}
              </button>
            ))}
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-ringo-muted">
            {s.paidOnlyNote}
            <Link href="/dashboard/documents/new?credit=1" className="inline-flex min-h-[44px] items-center text-ringo-indigo underline underline-offset-2">{s.createInvoice}</Link>
          </p>
          <Disclosure title={s.moreDetails}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={labelClass}>{s.date}<input className={inputClass} type="date" max={toLocalDateKey(new Date(), "Africa/Douala")} value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className={labelClass}><span>{s.note} <span className="font-normal">&middot; {s.optional}</span></span><input className={inputClass} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            </div>
          </Disclosure>
        </section>

        <section className={section}>
          <Step n={4} title={s.summary} />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs text-ringo-muted">{s.total} &middot; {currency}</p>
              <p className="text-3xl font-medium tabular-nums text-ringo-text" aria-live="polite">{money(total)}</p>
            </div>
            <button type="submit" disabled={busy || !ready} className={`${primaryButton} sm:min-w-[200px]`}>{busy ? s.saving : s.confirm}</button>
          </div>
          {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
        </section>
      </form>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ringo-text">{s.recent}</h2>
        {recent.length === 0 ? <p className="text-sm text-ringo-muted">{s.noRecent}</p> : (
          <ul className="flex flex-col divide-y divide-ringo-border/50 rounded-2xl border border-ringo-border/70 bg-ringo-surface">
            {recent.map((r) => (
              <li key={r.id}>
                <Link href={`/dashboard/documents/${r.id}`} className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className={r.status === "void" ? "text-ringo-muted line-through" : "text-ringo-text"}>{r.number} <span className="text-ringo-muted">· {r.customer_name || s.walkInShort}{r.status === "void" ? ` · ${t.documents.pdf.status.void}` : ""}</span></span>
                  <span className={`tabular-nums ${r.status === "void" ? "text-ringo-muted line-through" : "text-ringo-text"}`}>{r.total_minor === null ? "—" : formatMoney(r.total_minor, r.currency, locale === "en" ? "en" : "fr")}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
