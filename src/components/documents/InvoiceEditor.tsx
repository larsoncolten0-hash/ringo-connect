"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { createClient } from "@/lib/supabase/client";
import { addMinor, currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import { LIMITS } from "@/lib/documents/constants";
import { formatMoney } from "@/lib/documents/moneyFormat";
import { computeLine } from "@/lib/documents/totals";
import { bpToPercentText } from "@/lib/documents/validation";
import { parseDetail, errorKey } from "@/lib/documents/uiErrors";
import { ConfirmModal } from "./DocModals";
import { callApi, inputClass, labelClass, newRequestId, primaryButton, secondaryButton, useErrorText } from "./shared";
import Disclosure from "@/components/ui/Disclosure";

type LineState = { key: string; description: string; quantity: string; unit_price: string; discount: string; showDiscount: boolean; product_id: string | null };
const blankLine = (): LineState => ({ key: newRequestId(), description: "", quantity: "1", unit_price: "", discount: "", showDiscount: false, product_id: null });

type Biz = { profile_id: string; profile: any | null; suggestion: { display_name: string }; currency: string };
type Product = { id: string; name: string; price: number | string | null };

/**
 * Create / edit an invoice DRAFT (also: start a corrected invoice from a voided one). The totals shown while typing are a presentation
 * estimate: what is saved, numbered and printed is always what the database calculates. Nothing here can set a number, a date or a total.
 */
export default function InvoiceEditor({ mode, id, correctId, credit = false }: { mode: "new" | "edit"; id?: string; correctId?: string; credit?: boolean }) {
  const { t, locale } = useLanguage();
  const u = t.documents.ui;
  const cr = t.receivables.ui;
  const router = useRouter();
  const errorText = useErrorText();
  const requestId = useRef(newRequestId());

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [biz, setBiz] = useState<Biz | null>(null);
  const [docId, setDocId] = useState<string | null>(mode === "edit" ? id ?? null : null);
  const [replacesId, setReplacesId] = useState<string | null>(mode === "new" && correctId ? correctId : null);
  const [docLocale, setDocLocale] = useState<"en" | "fr">(locale === "en" ? "en" : "fr");
  const [cust, setCust] = useState({ name: "", phone: "", email: "", address: "", tax_id: "" });
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [lines, setLines] = useState<LineState[]>([blankLine()]);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState(false);
  const [serverTotals, setServerTotals] = useState<{ subtotal: number; discount: number; tax: number; total: number } | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  // Phase 3 (credit sale): an optional contact from the owner's own book, and an optional deposit recorded right after issuing. Both go through
  // the existing APIs (link: /api/receivables/documents/<id>/customer, deposit: the normal /api/documents/<id>/payments). Nothing here is required
  // for a plain invoice, and if the Phase 3 API is not available the editor behaves exactly as before.
  const [contacts, setContacts] = useState<{ id: string; name: string; phone: string | null; email: string | null }[] | null>(null);
  const [pickedContact, setPickedContact] = useState("");
  const [deposit, setDeposit] = useState({ amount: "", method: "cash" });
  const depositRequestId = useRef(newRequestId());
  const [notice, setNotice] = useState<{ text: string; docId: string } | null>(null);

  const currency = biz?.currency ?? "XAF";
  const digits = currencyMinorDigits(currency);
  const taxConfigured = !!biz?.profile && biz.profile.tax_label && biz.profile.tax_rate_bp !== null && biz.profile.tax_rate_bp !== undefined;
  const rateBp: number | null = taxEnabled && taxConfigured ? biz!.profile.tax_rate_bp : null;
  const touch = () => { setSaved(false); setServerTotals(null); };

  // ------------------------------------------------------------------ load (business details, and the draft / the invoice to correct)
  useEffect(() => {
    (async () => {
      const [b, d] = await Promise.all([
        callApi("GET", "/api/documents/business-profile"),
        mode === "edit" && id ? callApi("GET", `/api/documents/${encodeURIComponent(id)}`) : correctId ? callApi("GET", `/api/documents/${encodeURIComponent(correctId)}`) : Promise.resolve(null),
      ]);
      if (!b.ok) { setLoadError(errorText(b.data)); return setLoading(false); }
      setBiz(b.data);
      callApi("GET", "/api/receivables/customers").then((c) => { if (c.ok) setContacts(c.data.items); });
      if (mode === "new" && correctId) callApi("GET", `/api/receivables/documents/${encodeURIComponent(correctId)}/customer`).then((l) => { if (l.ok && l.data.customer) setPickedContact(l.data.customer.id); });
      let form: any = null;
      if (d) {
        if (!d.ok) { setLoadError(errorText(d.data)); return setLoading(false); }
        if (mode === "edit") {
          if (!d.data.draft) return router.replace(`/dashboard/documents/${id}`);   // issued documents are not editable
          form = d.data.draft;
          setReplacesId(d.data.replaces_document_id ?? null);
        } else {
          form = d.data.correction_form;
          if (!form) { setLoadError(u.errors.notFound); return setLoading(false); }
        }
      }
      if (form) {
        setDocLocale(form.locale === "en" ? "en" : "fr");
        const c = form.customer || {};
        setCust({ name: c.name ?? "", phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "", tax_id: c.tax_id ?? "" });
        setDueDate(form.due_date ?? "");
        setNotes(form.notes ?? "");
        setTerms(form.terms ?? "");
        setTaxEnabled(!!form.tax_enabled && !!b.data.profile?.tax_label);
        setLines(form.lines.length ? form.lines.map((l: any) => ({ key: newRequestId(), description: l.description, quantity: trimZeros(l.quantity), unit_price: trimZeros(l.unit_price), discount: Number(l.discount_amount) > 0 ? trimZeros(l.discount_amount) : "", showDiscount: Number(l.discount_amount) > 0, product_id: l.product_id ?? null })) : [blankLine()]);
      } else {
        setTerms(b.data.profile?.default_terms ?? "");
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------ estimate (presentation only)
  const preview = useMemo(() => {
    const per = lines.map((l) => computeLine({ quantity: l.quantity, unitPrice: l.unit_price, discount: l.showDiscount ? l.discount : undefined }, currency, rateBp));
    if (lines.length === 0 || per.some((r) => !r.ok)) return { per, totals: null };
    let sub = 0, dis = 0, tax = 0, tot = 0;
    for (const r of per) if (r.ok) { sub = addMinor(sub, r.line.grossMinor); dis = addMinor(dis, r.line.discountMinor); tax = addMinor(tax, r.line.taxMinor); tot = addMinor(tot, r.line.totalMinor); }
    return { per, totals: { subtotal: sub, discount: dis, tax, total: tot } };
  }, [lines, currency, rateBp]);
  const shown = serverTotals ?? preview.totals;

  const setLine = (key: string, patch: Partial<LineState>) => { touch(); setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))); };

  const loadProducts = async () => {
    if (products || !biz) return;
    const { data } = await createClient().from("products").select("id, name, price").eq("profile_id", biz.profile_id).order("sort_order", { ascending: true }).limit(200);
    setProducts((data as Product[]) || []);
  };
  const addProduct = (pid: string) => {
    const p = products?.find((x) => x.id === pid);
    if (!p) return;
    touch();
    const line: LineState = { ...blankLine(), description: p.name, unit_price: p.price === null || p.price === undefined ? "" : trimZeros(String(p.price)), product_id: p.id };
    setLines((ls) => (ls.length === 1 && ls[0].description === "" && ls[0].unit_price === "" ? [line] : [...ls, line]));
  };

  // ------------------------------------------------------------------ save / issue
  const save = async (): Promise<string | null> => {
    setError("");
    setLineErrors({});
    setBusy(true);
    const customer: Record<string, string> = {};
    for (const [k, v] of Object.entries(cust)) if (v.trim() !== "") customer[k] = v;
    const body: Record<string, unknown> = {
      locale: docLocale, customer: Object.keys(customer).length ? customer : null, due_date: dueDate || null, notes: notes || null, terms: terms || null, tax_enabled: taxEnabled && !!taxConfigured,
      lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, ...(l.showDiscount && l.discount.trim() !== "" ? { discount_amount: l.discount } : {}), ...(l.product_id ? { product_id: l.product_id } : {}) })),
      ...(replacesId ? { replaces_document_id: replacesId } : {}),
      ...(docId ? {} : { client_request_id: requestId.current }),
    };
    const r = docId ? await callApi("PUT", `/api/documents/${encodeURIComponent(docId)}`, body) : await callApi("POST", "/api/documents", body);
    setBusy(false);
    if (!r.ok) {
      if (r.data?.error === "validation_failed" && Array.isArray(r.data.details)) {
        const le: Record<number, string> = {};
        let general = "";
        for (const d of r.data.details as string[]) {
          const { code, line } = parseDetail(d);
          const msg = t.documents.ui.errors[errorKey(code)] ?? u.errors.validation;
          if (line !== null) le[line] = le[line] ?? msg; else general = general || msg;
        }
        setLineErrors(le);
        setError(general || u.errors.validation);
      } else setError(errorText(r.data));
      return null;
    }
    const doc = r.data.document;
    const newId: string = doc.id;
    if (!docId) {
      setDocId(newId);
      // keep the typed state; just make the address bar point at the draft (no remount, no lost input)
      window.history.replaceState(null, "", `/dashboard/documents/${newId}/edit`);
    }
    const mm = (v: unknown) => parseMinor(v, digits) ?? 0;
    setServerTotals({ subtotal: mm(doc.subtotal), discount: mm(doc.discount_total), tax: mm(doc.tax_total), total: mm(doc.total) });
    setSaved(true);
    return newId;
  };

  const issueNow = async (): Promise<string | null> => {
    if (!docId) return u.errors.generic;
    const r = await callApi("POST", `/api/documents/${encodeURIComponent(docId)}/issue`);
    if (!r.ok) return errorText(r.data);
    // Phase 3: link the contact and record the deposit AFTER the invoice is issued, through the normal APIs. A failure here never undoes the
    // issued invoice: the owner is told exactly what is left to do and can do it from the invoice.
    const problems: string[] = [];
    if (pickedContact) {
      const l = await callApi("PUT", `/api/receivables/documents/${encodeURIComponent(docId)}/customer`, { customer_id: pickedContact });
      if (!l.ok) problems.push(cr.linkFailed);
    }
    if (credit && deposit.amount.trim() !== "") {
      const d = await callApi("POST", `/api/documents/${encodeURIComponent(docId)}/payments`, { amount: deposit.amount.trim(), method: deposit.method, client_request_id: depositRequestId.current });
      if (!d.ok) problems.push(cr.depositFailed);
    }
    if (problems.length > 0) { setNotice({ text: problems.join(" "), docId }); return null; }
    router.push(`/dashboard/documents/${docId}`);
    return null;
  };

  const creditMissing = (): string | null => {
    if (!credit) return null;
    if (cust.name.trim() === "") return cr.creditNeedCustomer;
    if (!dueDate) return cr.creditNeedDue;
    return null;
  };

  if (loading) return <div className="py-12 flex items-center justify-center text-ringo-muted"><Loader2 size={20} className="animate-spin" /><span className="sr-only">{u.loading}</span></div>;
  if (loadError) return <div className="flex flex-col items-start gap-3"><p role="alert" className="text-sm text-rose-600">{loadError}</p><Link href="/dashboard/documents" className={secondaryButton}>{u.back}</Link></div>;

  const seller = biz?.profile;
  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div className="flex flex-col gap-1">
        <Link href="/dashboard/documents" className="inline-flex min-h-[44px] items-center text-sm text-ringo-muted hover:text-ringo-text w-fit">← {u.back}</Link>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em]">{credit && !docId ? cr.creditSaleTitle : mode === "edit" || docId ? u.editTitle : u.newTitle}</h1>
        {credit && <p className="text-sm text-ringo-muted">{cr.creditSaleIntro}</p>}
        {replacesId && <p className="text-sm text-ringo-muted">{u.correctsInvoice}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-4 py-3 text-sm" title={u.sellerHint}>
        {seller ? (
          <p className="min-w-0 break-words"><span className="text-ringo-muted">{u.sellerFrom}: </span><span className="font-medium text-ringo-text">{seller.display_name}</span></p>
        ) : (
          <p className="text-ringo-muted">{u.sellerMissing}{biz?.suggestion?.display_name ? ` (${biz.suggestion.display_name})` : ""}</p>
        )}
        <Link href="/dashboard/documents/settings" className="ringo-tactile inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-ringo-border px-4 text-sm font-semibold text-ringo-indigo hover:border-ringo-indigo/40 hover:bg-ringo-indigo/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">{u.editBusiness}</Link>
      </div>

      <Card n={1} title={u.customerSection}>
        {contacts && contacts.length > 0 && (
          <label className={labelClass}>
            {cr.pickContact}
            <select value={pickedContact} onChange={(e) => {
              const c = contacts.find((x) => x.id === e.target.value);
              touch();
              setPickedContact(e.target.value);
              if (c) setCust({ ...cust, name: c.name, phone: c.phone ?? "", email: c.email ?? "" });
            }} className={inputClass}>
              <option value="">{cr.pickContactNone}</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label className={labelClass}>{u.customerName}<input value={cust.name} onChange={(e) => { touch(); setCust({ ...cust, name: e.target.value }); }} maxLength={LIMITS.customerName} className={inputClass} /></label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className={labelClass}>{u.customerPhone}<input value={cust.phone} onChange={(e) => { touch(); setCust({ ...cust, phone: e.target.value }); }} maxLength={LIMITS.customerPhone} inputMode="tel" className={inputClass} /></label>
          <label className={labelClass}>{u.customerEmail}<input value={cust.email} onChange={(e) => { touch(); setCust({ ...cust, email: e.target.value }); }} maxLength={LIMITS.customerEmail} inputMode="email" className={inputClass} /></label>
        </div>
        <Disclosure title={u.moreCustomer} defaultOpen={!!(cust.address || cust.tax_id)}>
          <label className={labelClass}>{u.customerAddress}<textarea value={cust.address} onChange={(e) => { touch(); setCust({ ...cust, address: e.target.value }); }} maxLength={LIMITS.customerAddress} rows={2} className={inputClass} /></label>
          <label className={labelClass}>{u.customerTaxId}<input value={cust.tax_id} onChange={(e) => { touch(); setCust({ ...cust, tax_id: e.target.value }); }} maxLength={LIMITS.customerTaxId} className={inputClass} /></label>
        </Disclosure>
      </Card>

      <Card n={2} title={u.linesSection}>
        {lines.map((l, i) => {
          const r = preview.per[i];
          return (
            <div key={l.key} className={`rounded-xl border p-3 flex flex-col gap-3 ${lineErrors[i] ? "border-rose-500/60" : "border-ringo-border/60"}`}>
              <label className={labelClass}>
                {u.lineDescription}
                <textarea value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} maxLength={LIMITS.description} rows={2} className={inputClass} />
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <label className={labelClass}>{u.lineQuantity}<input value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} inputMode="decimal" className={inputClass} /></label>
                <label className={labelClass}>{u.lineUnitPrice}<input value={l.unit_price} onChange={(e) => setLine(l.key, { unit_price: e.target.value })} inputMode="decimal" className={inputClass} /></label>
                <div className={`${labelClass} col-span-2 sm:col-span-1`}>{u.lineTotal}<div className={`${inputClass} bg-ringo-muted/5 tabular-nums`}>{r?.ok ? formatMoney(r.line.totalMinor, currency, locale) : "—"}</div></div>
              </div>
              {l.showDiscount ? (
                <label className={labelClass}>{u.lineDiscount}<input value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} inputMode="decimal" className={inputClass} /></label>
              ) : (
                <button type="button" onClick={() => setLine(l.key, { showDiscount: true })} className="self-start ringo-tactile inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-ringo-border px-4 text-xs font-semibold text-ringo-indigo hover:border-ringo-indigo/40 hover:bg-ringo-indigo/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">{u.addDiscount}</button>
              )}
              {lineErrors[i] && <p role="alert" className="text-xs text-rose-600">{lineErrors[i]}</p>}
              {lines.length > 1 && (
                <button type="button" onClick={() => { touch(); setLines((ls) => ls.filter((x) => x.key !== l.key)); }} className="ringo-tactile self-end inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-rose-500/30 px-4 text-xs font-semibold text-rose-600 hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40">
                  <Trash2 size={13} />{u.removeLine}
                </button>
              )}
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={lines.length >= LIMITS.maxLines} onClick={() => { touch(); setLines((ls) => [...ls, blankLine()]); }} className={secondaryButton}><Plus size={15} />{u.addLine}</button>
          <select aria-label={u.fromProducts} defaultValue="" onFocus={loadProducts} onMouseDown={loadProducts} onChange={(e) => { addProduct(e.target.value); e.target.value = ""; }} className={`${inputClass} sm:w-auto`}>
            <option value="">{u.fromProducts}</option>
            {(products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {lines.length >= LIMITS.maxLines && <p className="text-xs text-ringo-muted">{u.maxLines}</p>}
      </Card>

      <Card n={3} title={u.paymentSection}>
        <label className={labelClass}>
          {u.dueDateLabel}
          <input type="date" value={dueDate} onChange={(e) => { touch(); setDueDate(e.target.value); }} className={inputClass} />
          {seller?.default_due_days !== null && seller?.default_due_days !== undefined && <span className="font-normal">{u.dueDateDefault(seller.default_due_days)}</span>}
        </label>
        <p className="text-xs text-ringo-muted">{u.issueDateAuto}</p>
        <Disclosure title={u.moreDetails}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className={labelClass}>
              {u.language}
              <select value={docLocale} onChange={(e) => { touch(); setDocLocale(e.target.value === "en" ? "en" : "fr"); }} className={inputClass}>
                <option value="fr">{u.languageFr}</option>
                <option value="en">{u.languageEn}</option>
              </select>
            </label>
            <div className={labelClass}>{u.currency}<div className={`${inputClass} bg-ringo-muted/5`}>{currency}</div></div>
          </div>
          <label className={labelClass}>{u.notes}<textarea value={notes} onChange={(e) => { touch(); setNotes(e.target.value); }} maxLength={LIMITS.notes} rows={3} className={inputClass} /></label>
          <label className={labelClass}>{u.terms}<textarea value={terms} onChange={(e) => { touch(); setTerms(e.target.value); }} maxLength={LIMITS.terms} rows={3} className={inputClass} /></label>
        </Disclosure>
      </Card>

      <Card n={4} title={u.summarySection}>
        {taxConfigured ? (
          <label className="flex items-center gap-2 text-sm text-ringo-text">
            <input type="checkbox" checked={taxEnabled} onChange={(e) => { touch(); setTaxEnabled(e.target.checked); }} className="accent-ringo-indigo" />
            {u.taxToggle(biz!.profile.tax_label, `${bpToPercentText(biz!.profile.tax_rate_bp)}%`)}
          </label>
        ) : (
          <p className="text-sm text-ringo-muted">{u.taxOffHint}</p>
        )}
        <div className="flex flex-col gap-2 text-sm">
          <Row label={u.subtotal} value={shown ? formatMoney(shown.subtotal, currency, locale) : "—"} />
          {shown && shown.discount > 0 && <Row label={u.discountTotal} value={`-${formatMoney(shown.discount, currency, locale)}`} />}
          {rateBp !== null && <Row label={u.taxTotal} value={shown ? formatMoney(shown.tax, currency, locale) : "—"} />}
          <Row label={u.totalDue} value={shown ? formatMoney(shown.total, currency, locale) : "—"} strong />
          {!serverTotals && <p className="text-xs text-ringo-muted pt-1">{u.estimateNote}</p>}
        </div>
      </Card>

      {credit && !docId && (
        <Card title={cr.depositTitle}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className={labelClass}>{cr.depositAmount}<input value={deposit.amount} onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })} inputMode="decimal" className={inputClass} /></label>
            <label className={labelClass}>
              {cr.depositMethod}
              <select value={deposit.method} onChange={(e) => setDeposit({ ...deposit, method: e.target.value })} className={inputClass}>
                {Object.entries(t.documents.pdf.methods).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-ringo-muted">{cr.depositNote}</p>
        </Card>
      )}

      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {notice && (
        <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-ringo-text flex flex-col gap-2">
          <p>{notice.text}</p>
          <Link href={`/dashboard/documents/${notice.docId}`} className={`${secondaryButton} w-fit`}>{u.back}</Link>
        </div>
      )}
      {saved && <p role="status" className="text-sm text-emerald-600">{u.saved}</p>}
      <div className="flex flex-col sm:flex-row gap-2">
        <button onClick={() => save()} disabled={busy} className={secondaryButton}>{busy ? <><Loader2 size={15} className="animate-spin" />{u.saving}</> : u.saveDraft}</button>
        <button onClick={async () => { const missing = creditMissing(); if (missing) return setError(missing); if (await save()) setIssueOpen(true); }} disabled={busy} className={primaryButton}>{u.saveAndIssue}</button>
      </div>

      {issueOpen && <ConfirmModal title={u.issueTitle} body={u.issueBody} confirmLabel={u.issue} onClose={() => setIssueOpen(false)} onConfirm={issueNow} />}
    </div>
  );
}

function trimZeros(v: string): string {
  return /^\d+\.\d+$/.test(v) ? v.replace(/0+$/, "").replace(/\.$/, "") : v;
}

function Card({ title, n, children }: { title: string; n?: number; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 flex flex-col gap-4">
      <h2 className="flex items-center gap-2.5 font-display text-base font-medium text-ringo-text">
        {n && <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ringo-indigo/10 text-xs font-semibold text-ringo-indigo">{n}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? "text-base font-medium text-ringo-text" : "text-ringo-muted"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
