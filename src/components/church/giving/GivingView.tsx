"use client";

import { useCallback, useEffect, useState } from "react";
import { HandCoins, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { FUND_LIMIT, FUND_TEMPLATES } from "@/lib/church/giving/kinds";
import { churchErrorText } from "../lifecycle/errorText";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, EmptyState, ErrorLine, Field, INPUT, ListSkeleton, NoticeBar, churchApi, useNotice } from "../people/shared";
import GiftsPanel from "./GiftsPanel";
import GivingSwitch from "./GivingSwitch";

interface FundRow {
  id: string;
  kind: "giving" | "care";
  title_en: string;
  title_fr: string;
  description_en: string | null;
  description_fr: string | null;
  goal_xaf: number | null;
  status: "draft" | "open" | "closed";
  is_published: boolean;
  updated_at: string;
}
interface FormState {
  id: string | null;
  kind: "giving" | "care";
  title_en: string;
  title_fr: string;
  description_en: string;
  description_fr: string;
  goal: string;
  is_published: boolean;
  closed: boolean;
  open: boolean;
}
const blank = (): FormState => ({ id: null, kind: "giving", title_en: "", title_fr: "", description_en: "", description_fr: "", goal: "", is_published: false, closed: false, open: false });
const fromRow = (r: FundRow): FormState => ({ id: r.id, kind: r.kind, title_en: r.title_en, title_fr: r.title_fr, description_en: r.description_en ?? "", description_fr: r.description_fr ?? "", goal: r.goal_xaf === null ? "" : String(r.goal_xaf), is_published: r.is_published, closed: r.status === "closed", open: r.status === "open" });

// The giving and care funds of the church. These are DEFINITIONS only: a title, a description and a goal. Nothing here collects or shows money, and the screen says so. Every change names the version
// it is based on. The server and the database decide what is allowed; this screen only says it earlier and in the person's language.
export default function GivingView() {
  const { t, locale } = useLanguage();
  const c = t.churchExpansion.giving;
  const g = t.churchExpansion.gifts;
  const [available, setAvailable] = useState(false);
  const [items, setItems] = useState<FundRow[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [removing, setRemoving] = useState<FundRow | null>(null);
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    setLoadError("");
    const r = await churchApi<{ items: FundRow[] }>("/api/church/giving-funds");
    if (r.ok) setItems(r.body.items);
    else setLoadError(churchErrorText(t, r.code));
    // whether the platform has opened collection (the server answers; a failure just means "not available")
    const f = await churchApi<{ giving_available?: boolean }>("/api/church/features");
    setAvailable(f.ok && f.body.giving_available === true);
  }, [t]);
  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!form) return;
    const goal = form.goal.trim() === "" ? null : Number(form.goal.replace(/[\s,]/g, ""));
    setSaving(true);
    setFormError("");
    const current = form.id ? items?.find((x) => x.id === form.id) : null;
    const body: Record<string, unknown> = { title_en: form.title_en, title_fr: form.title_fr, description_en: form.description_en, description_fr: form.description_fr, goal_xaf: goal, is_published: form.is_published };
    if (current) {
      body.expected_updated_at = current.updated_at;
      body.status = form.closed ? "closed" : form.open && available ? "open" : "draft";
    } else body.kind = form.kind;
    const r = await churchApi(form.id ? `/api/church/giving-funds/${form.id}` : "/api/church/giving-funds", { method: form.id ? "PATCH" : "POST", body });
    setSaving(false);
    if (!r.ok) {
      if (r.code === "stale") await load();
      return setFormError(churchErrorText(t, r.code));
    }
    show(c.form.saved);
    setForm(null);
    await load();
  };

  const remove = async (): Promise<string> => {
    if (!removing) return "";
    const r = await churchApi(`/api/church/giving-funds/${removing.id}?expected_updated_at=${encodeURIComponent(removing.updated_at)}`, { method: "DELETE" });
    if (!r.ok) return churchErrorText(t, r.code);
    setRemoving(null);
    setForm(null);
    await load();
    return "";
  };

  if (form) {
    const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
    return (
      <section aria-labelledby="church-fund-form-title" className="flex flex-col gap-4">
        <h1 id="church-fund-form-title" className="font-display text-xl font-semibold text-ringo-text">
          {form.id ? c.form.editTitle : c.form.newTitle}
        </h1>
        <div className="flex flex-col gap-4 rounded-card border border-ringo-border bg-ringo-surface p-4 sm:p-5">
          <Field id="fu-kind" label={c.form.kind} hint={c.form.kindHelp}>
            <select id="fu-kind" className={`${INPUT} sm:max-w-[240px]`} value={form.kind} disabled={form.id !== null} onChange={(e) => set("kind", e.target.value === "care" ? "care" : "giving")}>
              <option value="giving">{c.kind.giving}</option>
              <option value="care">{c.kind.care}</option>
            </select>
          </Field>
          {!form.id && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-ringo-text">{g.templateTitle}</p>
              <p className="text-xs text-ringo-muted">{g.templateHint}</p>
              <div className="flex flex-wrap gap-2">
                {FUND_TEMPLATES.map((tpl) => (
                  <button key={tpl.key} type="button" className={BTN_SECONDARY} onClick={() => setForm((f) => (f ? { ...f, kind: tpl.kind, title_en: tpl.title_en, title_fr: tpl.title_fr, description_en: tpl.description_en, description_fr: tpl.description_fr } : f))}>
                    {locale === "fr" ? tpl.title_fr : tpl.title_en}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Field id="fu-title-en" label={c.form.titleEn}>
            <input id="fu-title-en" className={INPUT} value={form.title_en} maxLength={120} onChange={(e) => set("title_en", e.target.value)} autoComplete="off" />
          </Field>
          <Field id="fu-title-fr" label={c.form.titleFr}>
            <input id="fu-title-fr" className={INPUT} value={form.title_fr} maxLength={120} onChange={(e) => set("title_fr", e.target.value)} autoComplete="off" />
          </Field>
          <Field id="fu-desc-en" label={c.form.descriptionEn} hint={c.form.descriptionHelp} optional>
            <textarea id="fu-desc-en" className={INPUT} rows={4} maxLength={600} value={form.description_en} onChange={(e) => set("description_en", e.target.value)} />
          </Field>
          <Field id="fu-desc-fr" label={c.form.descriptionFr} optional>
            <textarea id="fu-desc-fr" className={INPUT} rows={4} maxLength={600} value={form.description_fr} onChange={(e) => set("description_fr", e.target.value)} />
          </Field>
          <Field id="fu-goal" label={c.form.goal} hint={c.form.goalHelp} optional>
            <input id="fu-goal" className={`${INPUT} sm:max-w-[240px]`} type="text" inputMode="numeric" value={form.goal} onChange={(e) => set("goal", e.target.value)} autoComplete="off" />
          </Field>
          <label htmlFor="fu-published" className="flex min-h-[44px] items-center gap-3 text-sm font-medium text-ringo-text">
            <input id="fu-published" type="checkbox" className="h-5 w-5 rounded border-ringo-border accent-ringo-indigo" checked={form.is_published} onChange={(e) => set("is_published", e.target.checked)} />
            {c.form.published}
          </label>
          {form.id && available && !form.closed && (
            <label htmlFor="fu-open" className="flex min-h-[44px] items-center gap-3 text-sm font-medium text-ringo-text">
              <input id="fu-open" type="checkbox" className="h-5 w-5 rounded border-ringo-border accent-ringo-indigo" checked={form.open} onChange={(e) => set("open", e.target.checked)} />
              <span>
                {g.open}
                <span className="block text-xs font-normal text-ringo-muted">{g.openHelp}</span>
              </span>
            </label>
          )}
          {form.kind === "care" && (
            <p role="note" className="rounded-card border border-ringo-border bg-ringo-bg p-3 text-sm leading-relaxed text-ringo-muted">
              {g.careClosure}
            </p>
          )}
          {form.id && (
            <label htmlFor="fu-closed" className="flex min-h-[44px] items-center gap-3 text-sm font-medium text-ringo-text">
              <input id="fu-closed" type="checkbox" className="h-5 w-5 rounded border-ringo-border accent-ringo-indigo" checked={form.closed} onChange={(e) => set("closed", e.target.checked)} />
              {c.form.closed}
            </label>
          )}
          <ErrorLine message={formError} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={submit} disabled={saving} className={BTN_PRIMARY}>
              {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
              {saving ? c.form.saving : c.form.save}
            </button>
            <button type="button" onClick={() => setForm(null)} disabled={saving} className={BTN_SECONDARY}>
              {c.form.cancel}
            </button>
            {form.id && (
              <button type="button" onClick={() => setRemoving(items?.find((x) => x.id === form.id) ?? null)} className={`${BTN_SECONDARY} ml-auto text-ringo-coral`}>
                <Trash2 size={15} aria-hidden="true" />
                {c.form.remove}
              </button>
            )}
          </div>
        </div>
        {removing && <ConfirmDialog title={c.form.removeTitle} body={c.form.removeBody} confirmLabel={c.form.removeConfirm} danger onConfirm={remove} onCancel={() => setRemoving(null)} />}
      </section>
    );
  }

  const atLimit = (items?.length ?? 0) >= FUND_LIMIT;
  const money = (n: number) => new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US").format(n);
  return (
    <section aria-labelledby="church-giving-title" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 id="church-giving-title" className="font-display text-xl font-semibold text-ringo-text">
            {c.title}
          </h1>
          <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-ringo-muted">{c.intro}</p>
        </div>
        <button type="button" onClick={() => { setFormError(""); setForm(blank()); }} disabled={atLimit} className={BTN_PRIMARY}>
          <Plus size={16} aria-hidden="true" />
          {c.add}
        </button>
      </header>
      <GivingSwitch />
      <p role="note" className="rounded-card border border-ringo-border bg-ringo-surface p-3 text-sm leading-relaxed text-ringo-muted">
        {available ? g.availableNote : c.notAvailable}
      </p>
      <NoticeBar message={notice} />
      {loadError ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorLine message={loadError} />
          <button type="button" onClick={load} className={BTN_SECONDARY}>
            {c.retry}
          </button>
        </div>
      ) : items === null ? (
        <ListSkeleton rows={3} />
      ) : items.length === 0 ? (
        <EmptyState icon={<HandCoins size={22} aria-hidden="true" />} title={c.emptyTitle} body={c.emptyBody} />
      ) : (
        <>
          <p className="text-xs text-ringo-muted">{atLimit ? c.limit : c.count(items.length)}</p>
          <ul className="flex flex-col gap-2">
            {items.map((f) => {
              const title = locale === "fr" ? f.title_fr : f.title_en;
              return (
                <li key={f.id} className="flex items-center gap-3 rounded-card border border-ringo-border bg-ringo-surface p-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ringo-indigo/10 text-ringo-indigo" aria-hidden="true">
                    <HandCoins size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ringo-text">{title}</p>
                    <p className="mt-0.5 text-xs text-ringo-muted">{f.goal_xaf === null ? c.kind[f.kind] : `${c.kind[f.kind]} · ${c.goalLine(money(f.goal_xaf))}`}</p>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Badge tone={f.status === "closed" ? "inactive" : f.status === "open" ? "active" : "pending"}>{f.status === "closed" ? c.status.closed : f.status === "open" ? g.statusOpen : c.status.draft}</Badge>
                      <Badge tone={f.is_published ? "active" : "inactive"}>{f.is_published ? c.status.published : c.status.hidden}</Badge>
                    </span>
                  </div>
                  <button type="button" onClick={() => { setFormError(""); setForm(fromRow(f)); }} className={BTN_SECONDARY} aria-label={`${c.edit}: ${title}`}>
                    <Pencil size={15} aria-hidden="true" />
                    {c.edit}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {available && <GiftsPanel />}
    </section>
  );
}
