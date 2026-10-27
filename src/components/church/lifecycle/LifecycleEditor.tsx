"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Eye, Loader2, Send, Trash2, Undo2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import { Badge, BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, ErrorLine, Field, INPUT, ListSkeleton, NoticeBar, churchApi, useNotice } from "../people/shared";
import { churchErrorText } from "./errorText";
import { ANNOUNCEMENT_DURATIONS, announcementEnd } from "@/lib/church/week";
import PreviewDialog from "./PreviewDialog";
import PictureField from "./PictureField";
import AudienceField from "./AudienceField";
import type { FieldDef, FormValues, Lang, LifecycleConfig } from "./types";

interface Meta {
  id: string;
  status: "draft" | "published";
  state: string;
  updated_at: string;
}
interface Can {
  edit: boolean;
  delete: boolean;
  publish: boolean;
  unpublish: boolean;
}
type Pending = null | "publish" | "unpublish" | "delete";

const doualaToday = (): string => new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
const keysOf = (f: FieldDef): string[] => (f.bilingual ? [`${f.key}_en`, `${f.key}_fr`] : [f.key]);

function toForm(config: LifecycleConfig, item: Record<string, any>, today: string): FormValues {
  const f = config.blank(today);
  for (const def of config.fields) for (const k of keysOf(def)) f[k] = def.kind === "checkbox" ? item[k] === true : typeof item[k] === "string" ? item[k] : "";
  return f;
}

// Create or edit one entry (event, announcement, Bible program). ONE explicit "Save draft" button (no hidden autosave). Publish, unpublish and delete are separate, confirmed actions that act on the
// SAVED version (unsaved changes must be saved first, so what was reviewed is what goes live) and carry the updated_at that was loaded, so they are refused if someone else changed the entry
// meanwhile. The server and the database decide what is allowed; the buttons only reflect it.
export default function LifecycleEditor({ id, caps, config, extra }: { id?: string; caps: ChurchCapabilities; config: LifecycleConfig; extra?: (meta: Meta, can: Can, helpers: { dirty: boolean; reload: () => void }) => ReactNode }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const c = config.texts.editor;
  const f = config.texts.fields;
  const [form, setForm] = useState<FormValues>(() => config.blank(doualaToday()));
  const [saved, setSaved] = useState<FormValues>(() => config.blank(doualaToday()));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [can, setCan] = useState<Can>({ edit: config.caps.manage(caps), delete: false, publish: false, unpublish: false });
  const [loading, setLoading] = useState(!!id);
  const [loadError, setLoadError] = useState("");
  const [lang, setLang] = useState<Lang>(locale === "fr" ? "fr" : "en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const { notice, show } = useNotice();

  const apply = useCallback(
    (item: Record<string, any>, today: string, canNext?: Can) => {
      const next = toForm(config, item, today);
      setForm(next);
      setSaved(next);
      setMeta({ id: item.id, status: item.status, state: item.state, updated_at: item.updated_at });
      if (canNext) setCan(canNext);
    },
    [config]
  );

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError("");
    setStale(false);
    const r = await churchApi<{ item: Record<string, any>; can: Can; today: string }>(`${config.apiPath}/${id}`);
    setLoading(false);
    if (!r.ok) {
      setLoadError(churchErrorText(t, r.code));
      return;
    }
    apply(r.body.item, r.body.today, r.body.can);
  }, [id, apply, config.apiPath, t]);
  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));
  const readOnly = !can.edit || busy;
  const anyReady = config.ready(form, "en") || config.ready(form, "fr");
  const live = meta?.status === "published";

  // a new entry's body: the form, minus an empty picture and the fields that depend on it
  const createBody = (): FormValues => {
    const b: FormValues = { ...form };
    for (const d of config.fields) {
      if (d.kind !== "image" || String(b[d.key] ?? "") !== "") continue;
      delete b[d.key];
      for (const x of config.fields.filter((y) => y.visibleWhen === d.key)) delete b[x.key];
    }
    return b;
  };

  const save = async () => {
    setBusy(true);
    setError("");
    const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== saved[k]));
    const r = meta
      ? await churchApi<{ id?: string; item: Record<string, any> }>(`${config.apiPath}/${meta.id}`, { method: "PATCH", body: { ...changed, expected_updated_at: meta.updated_at } })
      : await churchApi<{ id?: string; item: Record<string, any> }>(config.apiPath, { method: "POST", body: createBody() });
    setBusy(false);
    if (!r.ok) {
      if (r.code === "stale") setStale(true);
      setError(churchErrorText(t, r.code));
      return;
    }
    if (!meta) {
      show(c.created);
      setSaved(form);
      router.replace(`${config.pagePath}/${r.body.id}`);
      return;
    }
    const item = r.body.item;
    if (item) apply(item, doualaToday());
    show(c.saved);
  };

  const act = async (kind: "publish" | "unpublish"): Promise<string> => {
    if (!meta) return "";
    const r = await churchApi<{ item: Record<string, any> }>(`${config.apiPath}/${meta.id}/${kind}`, { method: "POST", body: { confirm: true, expected_updated_at: meta.updated_at } });
    if (!r.ok) {
      if (r.code === "stale") setStale(true);
      return churchErrorText(t, r.code);
    }
    const item = r.body.item;
    setPending(null);
    // refresh the flags: after publishing, unpublish becomes available and vice versa
    setMeta({ id: item.id, status: item.status, state: item.state, updated_at: item.updated_at });
    const isLive = item.status === "published";
    setCan({ publish: !isLive && config.caps.publish(caps), unpublish: isLive && config.caps.publish(caps), edit: isLive ? config.caps.publish(caps) : config.caps.manage(caps), delete: isLive ? config.caps.publish(caps) : config.caps.manage(caps) });
    show(kind === "publish" ? c.published : c.unpublished);
    return "";
  };

  const remove = async (): Promise<string> => {
    if (!meta) return "";
    const r = await churchApi(`${config.apiPath}/${meta.id}?expected_updated_at=${encodeURIComponent(meta.updated_at)}`, { method: "DELETE" });
    if (!r.ok) {
      if (r.code === "stale") setStale(true);
      return churchErrorText(t, r.code);
    }
    setSaved(form); // nothing left to protect
    router.push(config.pagePath);
    return "";
  };

  if (loading) return <ListSkeleton rows={3} />;
  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
        <ErrorLine message={`${c.loadError} ${loadError}`} />
        <button type="button" className={BTN_SECONDARY} onClick={load}>
          {t.churchPeople.common.retry}
        </button>
      </div>
    );
  }

  const L = lang;
  const p = config.idPrefix;
  const control = (def: FieldDef, key: string, fid: string) => {
    const tx = f[def.key] ?? { label: def.key };
    // a dependent field (the care "the person agreed" box) only shows once the field it depends on has a value
    if (def.visibleWhen && String(form[def.visibleWhen] ?? "") === "") return null;
    if (def.kind === "image") {
      const dependents = config.fields.filter((d) => d.visibleWhen === def.key);
      return (
        <Field key={key} id={fid} label={tx.label} hint={tx.help} optional>
          <PictureField
            value={String(form[key] ?? "")}
            disabled={readOnly}
            labels={{ choose: tx.options?.choose ?? "", remove: tx.options?.remove ?? "" }}
            onChange={(url) => {
              set(key, url);
              if (url === "") for (const d of dependents) set(d.key, false);
            }}
          />
        </Field>
      );
    }
    if (def.kind === "audience") {
      return (
        <Field key={key} id={fid} label={tx.label} hint={tx.help} optional>
          <AudienceField id={fid} value={String(form[key] ?? "")} onChange={(v) => set(key, v)} disabled={readOnly} labels={tx.options ?? {}} />
        </Field>
      );
    }
    if (def.kind === "checkbox") {
      return (
        <label key={key} htmlFor={fid} className="flex min-h-[44px] items-center gap-3 text-sm font-medium text-ringo-text">
          <input id={fid} type="checkbox" className="h-5 w-5 rounded border-ringo-border accent-ringo-indigo" checked={form[key] === true} onChange={(e) => set(key, e.target.checked)} disabled={readOnly} />
          {tx.label}
        </label>
      );
    }
    const value = String(form[key] ?? "");
    if (def.kind === "select") {
      return (
        <Field key={key} id={fid} label={tx.label} hint={tx.help} optional={def.optional}>
          <select id={fid} className={INPUT} value={value} disabled={readOnly} onChange={(e) => set(key, e.target.value)}>
            {(def.choices ?? []).map((v) => (
              <option key={v} value={v}>
                {tx.options?.[v] ?? v}
              </option>
            ))}
          </select>
        </Field>
      );
    }
    const common = { id: fid, className: INPUT, value, disabled: readOnly, placeholder: tx.placeholder, onChange: (e: { target: { value: string } }) => set(key, e.target.value) };
    if (def.kind === "date" && def.presets === "announcement") {
      // How long an announcement stays on the public page: quick choices that fill in the last day (counted from today, Cameroon time), or a date picked by hand.
      const today = doualaToday();
      const chips: { id: string; value: string }[] = [...ANNOUNCEMENT_DURATIONS.map((d) => ({ id: d as string, value: announcementEnd(d, today) ?? "" })), { id: "none", value: "" }];
      return (
        <Field key={key} id={fid} label={tx.label} hint={tx.help}>
          <div role="group" aria-labelledby={`${fid}-label`} className="flex flex-wrap gap-1.5">
            <span id={`${fid}-label`} className="sr-only">
              {tx.label}
            </span>
            {chips.map((chip) => {
              const on = value === chip.value;
              return (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={on}
                  disabled={readOnly}
                  onClick={() => set(key, chip.value)}
                  className={`min-h-[44px] rounded-full border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 disabled:opacity-60 ${on ? "border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo" : "border-ringo-border text-ringo-muted hover:text-ringo-text"}`}
                >
                  {tx.options?.[chip.id] ?? chip.id}
                </button>
              );
            })}
          </div>
          <label htmlFor={fid} className="mt-2 text-xs font-medium text-ringo-muted">
            {tx.options?.date ?? tx.label}
          </label>
          <input {...common} type="date" autoComplete="off" min="2020-01-01" max="2100-12-31" aria-describedby={tx.help ? `${fid}-hint` : undefined} />
        </Field>
      );
    }
    return (
      <Field key={key} id={fid} label={tx.label} hint={tx.help} optional={def.optional}>
        {def.kind === "textarea" ? (
          <>
            <textarea {...common} className={`${INPUT} resize-y`} style={{ minHeight: `${(def.rows ?? 5) * 1.6}rem` }} maxLength={def.max} />
            {def.max ? <span className="text-[11px] text-ringo-muted">{c.characters(value.length, def.max)}</span> : null}
          </>
        ) : (
          <input
            {...common}
            type={def.kind === "date" ? "date" : def.kind === "time" ? "time" : def.kind === "url" ? "url" : "text"}
            maxLength={def.max}
            autoComplete="off"
            inputMode={def.kind === "url" ? "url" : undefined}
            {...(def.kind === "date" ? { min: "2020-01-01", max: "2100-12-31" } : {})}
          />
        )}
      </Field>
    );
  };
  const plainFields = config.fields.filter((d) => !d.bilingual);
  const perLang = config.fields.filter((d) => d.bilingual);

  return (
    <div>
      <NoticeBar message={notice} />
      <Link
        href={config.pagePath}
        onClick={(e) => {
          if (dirty && !window.confirm(c.leaveWarning)) e.preventDefault();
        }}
        className="mb-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-ringo-indigo hover:bg-ringo-indigo/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40"
      >
        <ArrowLeft size={15} aria-hidden="true" />
        {c.back}
      </Link>
      <h2 className="mb-3 font-display text-lg font-semibold text-ringo-text">{meta ? c.editTitle : c.newTitle}</h2>

      {live && can.edit && <p className="mb-3 rounded-2xl px-4 py-3 text-sm font-medium text-amber-800 ring-1 ring-amber-600/25">{c.liveBanner}</p>}
      {!can.edit && meta && <p className="mb-3 text-sm text-ringo-muted">{c.viewOnly}</p>}
      {stale && (
        <div role="alert" className="mb-3 flex flex-col items-start gap-2 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
          <p className="text-sm text-ringo-coral">{c.stale}</p>
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            {c.reload}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-5">
        {plainFields.length > 0 && <div className="grid gap-4 sm:grid-cols-2">{plainFields.map((d) => control(d, d.key, `${p}-${d.key}`))}</div>}

        <div>
          <div role="tablist" aria-label={c.languageTabs} className="mb-3 inline-flex rounded-full border border-ringo-border bg-ringo-surface p-1">
            {(["en", "fr"] as const).map((l) => (
              <button
                key={l}
                id={`${p}-tab-${l}`}
                role="tab"
                type="button"
                aria-selected={lang === l}
                aria-controls={`${p}-panel-${l}`}
                onClick={() => setLang(l)}
                className={`flex min-h-[40px] items-center gap-2 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 ${lang === l ? "bg-ringo-indigo text-white" : "text-ringo-muted hover:text-ringo-text"}`}
              >
                {c.languages[l]}
                <span className={`h-2 w-2 rounded-full ${config.ready(form, l) ? "bg-emerald-400" : "bg-ringo-muted/40"}`} aria-hidden="true" />
              </button>
            ))}
          </div>
          <div id={`${p}-panel-${L}`} role="tabpanel" aria-labelledby={`${p}-tab-${L}`} className="flex flex-col gap-4">
            <p className="text-xs text-ringo-muted">
              <Badge tone={config.ready(form, L) ? "active" : "inactive"}>{config.ready(form, L) ? c.languageReady : c.languageIncomplete}</Badge>
            </p>
            {perLang.map((d) => control(d, `${d.key}_${L}`, `${p}-${d.key}-${L}`))}
          </div>
        </div>

        <ErrorLine message={error} />
        {dirty && <p className="text-xs font-medium text-amber-800">{c.unsaved}</p>}
        {meta && !can.publish && !live && can.edit && <p className="text-xs text-ringo-muted">{c.publishNeedsPermission}</p>}
        {meta && can.publish && dirty && <p className="text-xs text-ringo-muted">{c.saveFirst}</p>}
        {meta && can.publish && !live && !anyReady && !dirty && <p className="text-xs text-ringo-muted">{c.needsReady}</p>}

        <div className="flex flex-col gap-2 border-t border-ringo-border/70 pt-4 sm:flex-row sm:flex-wrap sm:items-center">
          {can.edit && (
            <button type="button" className={BTN_PRIMARY} onClick={save} disabled={busy || !dirty}>
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
              {busy ? c.saving : live ? c.save : c.saveDraft}
            </button>
          )}
          <button type="button" className={BTN_SECONDARY} onClick={() => setPreviewing(true)}>
            <Eye size={15} aria-hidden="true" />
            {c.preview}
          </button>
          {meta && can.publish && (
            <button type="button" className={BTN_SECONDARY} onClick={() => setPending("publish")} disabled={busy || dirty || !anyReady}>
              <Send size={15} aria-hidden="true" />
              {c.publish}
            </button>
          )}
          {meta && can.unpublish && (
            <button type="button" className={BTN_SECONDARY} onClick={() => setPending("unpublish")} disabled={busy || dirty}>
              <Undo2 size={15} aria-hidden="true" />
              {c.unpublish}
            </button>
          )}
          {meta && can.delete && (
            <button type="button" className={`${BTN_DANGER} sm:ml-auto`} onClick={() => setPending("delete")} disabled={busy}>
              <Trash2 size={15} aria-hidden="true" />
              {c.delete}
            </button>
          )}
        </div>
      </div>

      {meta && extra ? extra(meta, can, { dirty, reload: load }) : null}

      {previewing && <PreviewDialog config={config} form={form} initialLanguage={lang} onClose={() => setPreviewing(false)} />}
      {pending === "publish" && <ConfirmDialog title={c.publishTitle} body={c.publishBody} confirmLabel={c.publishConfirm} onCancel={() => setPending(null)} onConfirm={() => act("publish")} />}
      {pending === "unpublish" && <ConfirmDialog title={c.unpublishTitle} body={c.unpublishBody} confirmLabel={c.unpublishConfirm} onCancel={() => setPending(null)} onConfirm={() => act("unpublish")} />}
      {pending === "delete" && <ConfirmDialog title={live ? c.deleteLiveTitle : c.deleteDraftTitle} body={live ? c.deleteLiveBody : c.deleteDraftBody} confirmLabel={c.deleteConfirm} danger onCancel={() => setPending(null)} onConfirm={remove} />}
    </div>
  );
}
