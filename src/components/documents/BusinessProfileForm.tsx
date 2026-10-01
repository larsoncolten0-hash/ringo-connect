"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { LIMITS } from "@/lib/documents/constants";
import { bpToPercentText, percentToBp } from "@/lib/documents/validation";
import { callApi, inputClass, labelClass, primaryButton, secondaryButton, useErrorText } from "./shared";

// The identity printed on invoices and receipts. It is its OWN configuration: saving it never touches the public profile, and the public
// name is only offered as a suggestion the person can accept. Documents already issued keep the details they were issued with.
export default function BusinessProfileForm() {
  const { t } = useLanguage();
  const u = t.documents.ui;
  const errorText = useErrorText();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [f, setF] = useState({ display_name: "", legal_name: "", address: "", phone: "", email: "", tax_id: "", registration_no: "", default_terms: "", default_due_days: "", tax_label: "", tax_rate: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setSaved(false); setF((p) => ({ ...p, [k]: e.target.value })); };

  useEffect(() => {
    (async () => {
      const r = await callApi("GET", "/api/documents/business-profile");
      setLoading(false);
      if (!r.ok) return setLoadError(errorText(r.data));
      setSuggestion(r.data.suggestion?.display_name || "");
      const p = r.data.profile;
      if (p) {
        setF({
          display_name: p.display_name ?? "", legal_name: p.legal_name ?? "", address: p.address ?? "", phone: p.phone ?? "", email: p.email ?? "",
          tax_id: p.tax_id ?? "", registration_no: p.registration_no ?? "", default_terms: p.default_terms ?? "",
          default_due_days: p.default_due_days === null || p.default_due_days === undefined ? "" : String(p.default_due_days),
          tax_label: p.tax_label ?? "", tax_rate: p.tax_rate_bp === null || p.tax_rate_bp === undefined ? "" : bpToPercentText(p.tax_rate_bp),
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setError("");
    setSaved(false);
    if (f.display_name.trim() === "") return setError(u.errors.validation);
    const labelSet = f.tax_label.trim() !== "";
    const rateSet = f.tax_rate.trim() !== "";
    let rate: number | null = null;
    if (labelSet !== rateSet) return setError(u.taxHint);
    if (rateSet) {
      rate = percentToBp(f.tax_rate);
      if (rate === null) return setError(u.errors.validation);
    }
    setBusy(true);
    const r = await callApi("PUT", "/api/documents/business-profile", {
      display_name: f.display_name, legal_name: f.legal_name || null, address: f.address || null, phone: f.phone || null, email: f.email || null,
      tax_id: f.tax_id || null, registration_no: f.registration_no || null, default_terms: f.default_terms || null,
      default_due_days: f.default_due_days.trim() === "" ? null : Number(f.default_due_days),
      tax_label: labelSet ? f.tax_label : null, tax_rate_bp: rate,
    });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.data));
    setSaved(true);
  };

  if (loading) return <div className="py-12 flex items-center justify-center text-ringo-muted"><Loader2 size={20} className="animate-spin" /><span className="sr-only">{u.loading}</span></div>;
  if (loadError) return <p role="alert" className="text-sm text-rose-600">{loadError}</p>;

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div>
        <h1 className="font-display text-2xl font-medium text-ringo-text tracking-[-0.01em] mb-1">{u.settingsTitle}</h1>
        <p className="text-sm text-ringo-muted max-w-xl">{u.settingsHint}</p>
      </div>

      <div className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 flex flex-col gap-4">
        <label className={labelClass}>
          {u.displayName}
          <input value={f.display_name} onChange={set("display_name")} maxLength={LIMITS.displayName} className={inputClass} />
          {suggestion && f.display_name !== suggestion && (
            <button type="button" onClick={() => { setSaved(false); setF((p) => ({ ...p, display_name: suggestion })); }} className="self-start text-xs font-normal text-ringo-indigo hover:underline">
              {u.useSuggestion}: {suggestion}
            </button>
          )}
        </label>
        <label className={labelClass}>{u.legalName}<input value={f.legal_name} onChange={set("legal_name")} maxLength={LIMITS.legalName} className={inputClass} /></label>
        <label className={labelClass}>{u.address}<textarea value={f.address} onChange={set("address")} maxLength={LIMITS.address} rows={3} className={inputClass} /></label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className={labelClass}>{u.phone}<input value={f.phone} onChange={set("phone")} maxLength={LIMITS.phone} inputMode="tel" className={inputClass} /></label>
          <label className={labelClass}>{u.email}<input value={f.email} onChange={set("email")} maxLength={LIMITS.email} inputMode="email" className={inputClass} /></label>
          <label className={labelClass}>{u.taxId}<input value={f.tax_id} onChange={set("tax_id")} maxLength={LIMITS.taxId} className={inputClass} /></label>
          <label className={labelClass}>{u.registrationNo}<input value={f.registration_no} onChange={set("registration_no")} maxLength={LIMITS.registrationNo} className={inputClass} /></label>
        </div>
        <label className={labelClass}>{u.defaultTerms}<textarea value={f.default_terms} onChange={set("default_terms")} maxLength={LIMITS.terms} rows={3} className={inputClass} /></label>
        <label className={labelClass}>{u.defaultDueDays}<input value={f.default_due_days} onChange={set("default_due_days")} inputMode="numeric" className={inputClass} /></label>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-ringo-border/60 p-3">
          <legend className="px-1 text-xs font-medium text-ringo-muted">{u.taxSection}</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className={labelClass}>{u.taxName}<input value={f.tax_label} onChange={set("tax_label")} maxLength={LIMITS.taxLabel} className={inputClass} /></label>
            <label className={labelClass}>{u.taxRate}<input value={f.tax_rate} onChange={set("tax_rate")} inputMode="decimal" className={inputClass} /></label>
          </div>
          <p className="text-xs text-ringo-muted leading-relaxed">{u.taxHint}</p>
        </fieldset>

        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        {saved && <p role="status" className="text-sm text-emerald-600">{u.settingsSaved}</p>}
        <div className="flex">
          <button onClick={save} disabled={busy} className={primaryButton}>
            {busy ? <><Loader2 size={15} className="animate-spin" />{u.working}</> : u.save}
          </button>
        </div>
      </div>
    </div>
  );
}
