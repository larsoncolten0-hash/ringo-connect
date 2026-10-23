"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, Loader2, Send, Trash2, Undo2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import { WORD_TEXT_FIELDS } from "@/lib/church/content/validation";
import { doualaDate, type PublicWord, type WordLang } from "@/lib/church/content/publicWord";
import { Badge, BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, ErrorLine, Field, INPUT, ListSkeleton, NoticeBar, churchApi, formatDay, useNotice } from "../people/shared";
import DailyWordPreviewDialog from "./DailyWordPreviewDialog";
import { contentErrorText } from "./shared";

type Form = { publish_on: string } & Record<(typeof WORD_TEXT_FIELDS)[number], string>;
interface WordMeta {
  id: string;
  status: "draft" | "published";
  state: "draft" | "scheduled" | "published";
  updated_at: string;
}
interface Can {
  edit: boolean;
  delete: boolean;
  publish: boolean;
  unpublish: boolean;
}
type Pending = null | "publish" | "unpublish" | "delete";

const emptyForm = (date: string): Form => ({ publish_on: date, title_en: "", title_fr: "", scripture_ref_en: "", scripture_ref_fr: "", scripture_text_en: "", scripture_text_fr: "", body_en: "", body_fr: "", prayer_en: "", prayer_fr: "" });
const toForm = (w: Record<string, any>): Form => {
  const f = emptyForm(String(w.publish_on || ""));
  for (const k of WORD_TEXT_FIELDS) f[k] = typeof w[k] === "string" ? w[k] : "";
  return f;
};
const complete = (f: Form, l: WordLang) => f[`title_${l}`].trim() !== "" && f[`body_${l}`].trim() !== "";

// Create or edit one Daily Word. ONE explicit "Save draft" button (no hidden autosave). Publish, schedule, unpublish and delete are separate, confirmed actions that act on the SAVED version (unsaved changes
// must be saved first, so what was reviewed is what goes live) and carry the updated_at that was loaded, so they are refused if someone else changed the entry meanwhile. The server and the database decide
// what is allowed; the buttons only reflect it.
export default function DailyWordEditor({ id, caps }: { id?: string; caps: ChurchCapabilities }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const c = t.churchContent.editor;
  const [form, setForm] = useState<Form>(() => emptyForm(doualaDate()));
  const [saved, setSaved] = useState<Form>(() => emptyForm(doualaDate()));
  const [meta, setMeta] = useState<WordMeta | null>(null);
  const [can, setCan] = useState<Can>({ edit: caps.manageContent, delete: false, publish: false, unpublish: false });
  const [today, setToday] = useState(doualaDate());
  const [loading, setLoading] = useState(!!id);
  const [loadError, setLoadError] = useState("");
  const [lang, setLang] = useState<WordLang>(locale === "fr" ? "fr" : "en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const { notice, show } = useNotice();

  const apply = useCallback((w: Record<string, any>, canNext?: Can) => {
    const f = toForm(w);
    setForm(f);
    setSaved(f);
    setMeta({ id: w.id, status: w.status, state: w.state, updated_at: w.updated_at });
    if (canNext) setCan(canNext);
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError("");
    setStale(false);
    const r = await churchApi<{ word: Record<string, any>; can: Can; today: string }>(`/api/church/content/${id}`);
    setLoading(false);
    if (!r.ok) {
      setLoadError(contentErrorText(t, r.code));
      return;
    }
    apply(r.body.word, r.body.can);
    setToday(r.body.today);
  }, [id, apply, t]);
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

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const readOnly = !can.edit || busy;
  const anyComplete = complete(form, "en") || complete(form, "fr");
  const live = meta?.status === "published";

  const save = async () => {
    setBusy(true);
    setError("");
    const r = meta
      ? await churchApi<{ word: Record<string, any> }>(`/api/church/content/${meta.id}`, {
          method: "PATCH",
          body: { ...Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== (saved as Record<string, string>)[k])), expected_updated_at: meta.updated_at },
        })
      : await churchApi<{ id: string; word: Record<string, any> }>("/api/church/content", { method: "POST", body: form });
    setBusy(false);
    if (!r.ok) {
      if (r.code === "stale") setStale(true);
      setError(contentErrorText(t, r.code));
      return;
    }
    if (!meta) {
      const created = r.body as { id: string; word: Record<string, any> };
      show(c.created);
      setSaved(form);
      router.replace(`/dashboard/church/content/${created.id}`);
      return;
    }
    const w = (r.body as { word: Record<string, any> }).word;
    if (w) {
      const f = toForm(w);
      setForm(f);
      setSaved(f);
      setMeta({ id: w.id, status: w.status, state: w.state, updated_at: w.updated_at });
    }
    show(c.saved);
  };

  const act = async (kind: "publish" | "unpublish"): Promise<string> => {
    if (!meta) return "";
    const r = await churchApi<{ word: Record<string, any> }>(`/api/church/content/${meta.id}/${kind}`, { method: "POST", body: { confirm: true, expected_updated_at: meta.updated_at } });
    if (!r.ok) {
      if (r.code === "stale") setStale(true);
      return contentErrorText(t, r.code);
    }
    const w = r.body.word;
    setPending(null);
    // refresh the flags: after publishing, unpublish becomes available and vice versa
    setMeta({ id: w.id, status: w.status, state: w.state, updated_at: w.updated_at });
    setCan((p) => ({ ...p, publish: w.status !== "published" && caps.publishContent, unpublish: w.status === "published" && caps.publishContent, edit: w.status === "published" ? caps.publishContent : caps.manageContent, delete: w.status === "published" ? caps.publishContent : caps.manageContent }));
    show(kind === "publish" ? (w.state === "scheduled" ? c.scheduled(formatDay(w.publish_on, locale)) : c.published) : c.unpublished);
    return "";
  };

  const remove = async (): Promise<string> => {
    if (!meta) return "";
    const r = await churchApi(`/api/church/content/${meta.id}?expected_updated_at=${encodeURIComponent(meta.updated_at)}`, { method: "DELETE" });
    if (!r.ok) {
      if (r.code === "stale") setStale(true);
      return contentErrorText(t, r.code);
    }
    setSaved(form); // nothing left to protect
    router.push("/dashboard/church/content");
    return "";
  };

  const word: PublicWord = {
    id: meta?.id || "00000000-0000-4000-8000-000000000000",
    publish_on: form.publish_on || today,
    title_en: form.title_en || null, title_fr: form.title_fr || null,
    scripture_ref_en: form.scripture_ref_en || null, scripture_ref_fr: form.scripture_ref_fr || null,
    scripture_text_en: form.scripture_text_en || null, scripture_text_fr: form.scripture_text_fr || null,
    body_en: form.body_en || null, body_fr: form.body_fr || null,
    prayer_en: form.prayer_en || null, prayer_fr: form.prayer_fr || null,
  };
  const futureDate = form.publish_on > today;
  const dateLabel = formatDay(form.publish_on, locale);

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
  const max = { title: 120, ref: 120, scripture: 1000, body: 4000, prayer: 1000 };
  const counter = (v: string, m: number) => <span className="text-[11px] text-ringo-muted">{c.characters(v.length, m)}</span>;

  return (
    <div>
      <NoticeBar message={notice} />
      <Link
        href="/dashboard/church/content"
        onClick={(e) => {
          if (dirty && !window.confirm(c.leaveWarning)) e.preventDefault();
        }}
        className="mb-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-ringo-indigo hover:bg-ringo-indigo/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40"
      >
        <ArrowLeft size={15} aria-hidden="true" />
        {c.back}
      </Link>
      <h2 className="mb-3 font-display text-lg font-semibold text-ringo-text">{meta ? c.editTitle : c.newTitle}</h2>

      {meta?.state === "scheduled" && <p className="mb-3 rounded-2xl px-4 py-3 text-sm font-medium text-amber-800 ring-1 ring-amber-600/25">{c.scheduledBanner(dateLabel)}</p>}
      {meta?.state === "published" && <p className="mb-3 rounded-2xl px-4 py-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-700/25">{c.publishedBanner(dateLabel)}</p>}
      {live && can.edit && <p className="mb-3 text-xs font-medium text-amber-800">{c.liveBanner}</p>}
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
        <Field id="dw-date" label={c.date} hint={c.dateHelp}>
          <input id="dw-date" type="date" className={`${INPUT} sm:max-w-xs`} value={form.publish_on} onChange={(e) => set("publish_on", e.target.value)} disabled={readOnly} min="2020-01-01" max="2100-12-31" aria-describedby="dw-date-hint" />
        </Field>

        <div>
          <div role="tablist" aria-label={c.languageTabs} className="mb-3 inline-flex rounded-full border border-ringo-border bg-ringo-surface p-1">
            {(["en", "fr"] as const).map((l) => (
              <button
                key={l}
                id={`dw-tab-${l}`}
                role="tab"
                type="button"
                aria-selected={lang === l}
                aria-controls={`dw-panel-${l}`}
                onClick={() => setLang(l)}
                className={`flex min-h-[40px] items-center gap-2 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 ${lang === l ? "bg-ringo-indigo text-white" : "text-ringo-muted hover:text-ringo-text"}`}
              >
                {c.languages[l]}
                <span className={`h-2 w-2 rounded-full ${complete(form, l) ? "bg-emerald-400" : "bg-ringo-muted/40"}`} aria-hidden="true" />
              </button>
            ))}
          </div>
          <div id={`dw-panel-${L}`} role="tabpanel" aria-labelledby={`dw-tab-${L}`} className="flex flex-col gap-4">
            <p className="text-xs text-ringo-muted">
              <Badge tone={complete(form, L) ? "active" : "inactive"}>{complete(form, L) ? c.languageReady : c.languageIncomplete}</Badge>
            </p>
            <Field id={`dw-title-${L}`} label={c.titleLabel}>
              <input id={`dw-title-${L}`} className={INPUT} value={form[`title_${L}`]} onChange={(e) => set(`title_${L}`, e.target.value)} maxLength={max.title} disabled={readOnly} placeholder={c.titlePlaceholder} autoComplete="off" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={`dw-ref-${L}`} label={c.reference} optional>
                <input id={`dw-ref-${L}`} className={INPUT} value={form[`scripture_ref_${L}`]} onChange={(e) => set(`scripture_ref_${L}`, e.target.value)} maxLength={max.ref} disabled={readOnly} placeholder={c.referencePlaceholder} autoComplete="off" />
              </Field>
            </div>
            <Field id={`dw-scripture-${L}`} label={c.scripture} optional>
              <textarea id={`dw-scripture-${L}`} className={`${INPUT} min-h-[100px] resize-y`} value={form[`scripture_text_${L}`]} onChange={(e) => set(`scripture_text_${L}`, e.target.value)} maxLength={max.scripture} disabled={readOnly} placeholder={c.scripturePlaceholder} />
              {counter(form[`scripture_text_${L}`], max.scripture)}
            </Field>
            <Field id={`dw-body-${L}`} label={c.body}>
              <textarea id={`dw-body-${L}`} className={`${INPUT} min-h-[180px] resize-y`} value={form[`body_${L}`]} onChange={(e) => set(`body_${L}`, e.target.value)} maxLength={max.body} disabled={readOnly} placeholder={c.bodyPlaceholder} />
              {counter(form[`body_${L}`], max.body)}
            </Field>
            <Field id={`dw-prayer-${L}`} label={c.prayer} optional>
              <textarea id={`dw-prayer-${L}`} className={`${INPUT} min-h-[80px] resize-y`} value={form[`prayer_${L}`]} onChange={(e) => set(`prayer_${L}`, e.target.value)} maxLength={max.prayer} disabled={readOnly} placeholder={c.prayerPlaceholder} />
              {counter(form[`prayer_${L}`], max.prayer)}
            </Field>
          </div>
        </div>

        <ErrorLine message={error} />
        {dirty && <p className="text-xs font-medium text-amber-800">{c.unsaved}</p>}
        {meta && !can.publish && !live && can.edit && <p className="text-xs text-ringo-muted">{c.publishNeedsPermission}</p>}
        {meta && can.publish && dirty && <p className="text-xs text-ringo-muted">{c.saveFirst}</p>}
        {meta && can.publish && !live && !anyComplete && !dirty && <p className="text-xs text-ringo-muted">{c.needsLanguage}</p>}

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
            <button type="button" className={BTN_SECONDARY} onClick={() => setPending("publish")} disabled={busy || dirty || !anyComplete}>
              <Send size={15} aria-hidden="true" />
              {futureDate ? c.schedule : c.publish}
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

      {previewing && <DailyWordPreviewDialog word={word} initialLanguage={lang} onClose={() => setPreviewing(false)} />}
      {pending === "publish" && (
        <ConfirmDialog
          title={futureDate ? c.scheduleTitle(dateLabel) : c.publishNowTitle}
          body={futureDate ? c.scheduleBody(dateLabel) : c.publishNowBody(dateLabel)}
          confirmLabel={futureDate ? c.scheduleConfirm : c.publishConfirm}
          onCancel={() => setPending(null)}
          onConfirm={() => act("publish")}
        />
      )}
      {pending === "unpublish" && <ConfirmDialog title={c.unpublishTitle} body={c.unpublishBody} confirmLabel={c.unpublishConfirm} onCancel={() => setPending(null)} onConfirm={() => act("unpublish")} />}
      {pending === "delete" && <ConfirmDialog title={live ? c.deleteLiveTitle : c.deleteDraftTitle} body={live ? c.deleteLiveBody : c.deleteDraftBody} confirmLabel={c.deleteConfirm} danger onCancel={() => setPending(null)} onConfirm={remove} />}
    </div>
  );
}
