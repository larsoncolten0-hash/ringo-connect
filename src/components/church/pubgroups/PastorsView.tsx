"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { PASTOR_LIMIT } from "@/lib/church/pubgroups/kinds";
import { churchErrorText } from "../lifecycle/errorText";
import PictureField from "../lifecycle/PictureField";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, EmptyState, ErrorLine, Field, INPUT, ListSkeleton, NoticeBar, churchApi, useNotice } from "../people/shared";

interface PastorRow {
  id: string;
  name: string;
  photo_url: string | null;
  word_en: string | null;
  word_fr: string | null;
  bio_en: string | null;
  bio_fr: string | null;
  sort_order: number;
  is_published: boolean;
  updated_at: string;
}
interface FormState {
  id: string | null;
  name: string;
  photo_url: string;
  word_en: string;
  word_fr: string;
  bio_en: string;
  bio_fr: string;
  sort_order: string;
  is_published: boolean;
}
const blank = (): FormState => ({ id: null, name: "", photo_url: "", word_en: "", word_fr: "", bio_en: "", bio_fr: "", sort_order: "0", is_published: false });
const fromRow = (r: PastorRow): FormState => ({ id: r.id, name: r.name, photo_url: r.photo_url ?? "", word_en: r.word_en ?? "", word_fr: r.word_fr ?? "", bio_en: r.bio_en ?? "", bio_fr: r.bio_fr ?? "", sort_order: String(r.sort_order), is_published: r.is_published });

// The Pastors page of the church: the pastors (photo, name, a short word, a biography) and the church's vision and mission. Every change names the version it is based on. The server and the database
// decide what is allowed; this screen only says it earlier and in the visitor's language.
export default function PastorsView() {
  const { t } = useLanguage();
  const c = t.churchExpansion.pastors;
  const [items, setItems] = useState<PastorRow[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [removing, setRemoving] = useState<PastorRow | null>(null);
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    setLoadError("");
    const r = await churchApi<{ items: PastorRow[] }>("/api/church/pastors");
    if (r.ok) setItems(r.body.items);
    else setLoadError(churchErrorText(t, r.code));
  }, [t]);
  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!form) return;
    const order = Number(form.sort_order);
    setSaving(true);
    setFormError("");
    const current = form.id ? items?.find((x) => x.id === form.id) : null;
    const body: Record<string, unknown> = { name: form.name, photo_url: form.photo_url, word_en: form.word_en, word_fr: form.word_fr, bio_en: form.bio_en, bio_fr: form.bio_fr, sort_order: Number.isFinite(order) ? Math.trunc(order) : 0, is_published: form.is_published };
    if (current) body.expected_updated_at = current.updated_at;
    const r = await churchApi(form.id ? `/api/church/pastors/${form.id}` : "/api/church/pastors", { method: form.id ? "PATCH" : "POST", body });
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
    const r = await churchApi(`/api/church/pastors/${removing.id}?expected_updated_at=${encodeURIComponent(removing.updated_at)}`, { method: "DELETE" });
    if (!r.ok) return churchErrorText(t, r.code);
    setRemoving(null);
    setForm(null);
    await load();
    return "";
  };

  if (form) {
    const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
    return (
      <section aria-labelledby="church-pastor-form-title" className="flex flex-col gap-4">
        <h1 id="church-pastor-form-title" className="font-display text-xl font-semibold text-ringo-text">
          {form.id ? c.form.editTitle : c.form.newTitle}
        </h1>
        <div className="flex flex-col gap-4 rounded-card border border-ringo-border bg-ringo-surface p-4 sm:p-5">
          <Field id="pa-name" label={c.form.name}>
            <input id="pa-name" className={INPUT} value={form.name} maxLength={80} placeholder={c.form.namePlaceholder} onChange={(e) => set("name", e.target.value)} autoComplete="off" />
          </Field>
          <Field id="pa-photo" label={c.form.photo} optional>
            <PictureField value={form.photo_url} labels={{ choose: c.form.choosePhoto, remove: c.form.removePhoto }} onChange={(url) => set("photo_url", url)} />
          </Field>
          <Field id="pa-word-en" label={c.form.wordEn} hint={c.form.wordHelp} optional>
            <textarea id="pa-word-en" className={INPUT} rows={3} maxLength={300} value={form.word_en} onChange={(e) => set("word_en", e.target.value)} />
          </Field>
          <Field id="pa-word-fr" label={c.form.wordFr} optional>
            <textarea id="pa-word-fr" className={INPUT} rows={3} maxLength={300} value={form.word_fr} onChange={(e) => set("word_fr", e.target.value)} />
          </Field>
          <Field id="pa-bio-en" label={c.form.bioEn} hint={c.form.bioHelp} optional>
            <textarea id="pa-bio-en" className={INPUT} rows={6} maxLength={3000} value={form.bio_en} onChange={(e) => set("bio_en", e.target.value)} />
          </Field>
          <Field id="pa-bio-fr" label={c.form.bioFr} optional>
            <textarea id="pa-bio-fr" className={INPUT} rows={6} maxLength={3000} value={form.bio_fr} onChange={(e) => set("bio_fr", e.target.value)} />
          </Field>
          <Field id="pa-order" label={c.form.order} hint={c.form.orderHelp}>
            <input id="pa-order" className={`${INPUT} sm:max-w-[160px]`} type="number" inputMode="numeric" min={0} max={1000} value={form.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
          </Field>
          <label htmlFor="pa-published" className="flex min-h-[44px] items-center gap-3 text-sm font-medium text-ringo-text">
            <input id="pa-published" type="checkbox" className="h-5 w-5 rounded border-ringo-border accent-ringo-indigo" checked={form.is_published} onChange={(e) => set("is_published", e.target.checked)} />
            {c.form.published}
          </label>
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
              <button
                type="button"
                onClick={() => setRemoving(items?.find((x) => x.id === form.id) ?? null)}
                className={`${BTN_SECONDARY} ml-auto text-ringo-coral`}
              >
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

  const atLimit = (items?.length ?? 0) >= PASTOR_LIMIT;
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="church-pastors-title" className="flex flex-col gap-4">
        <header className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 id="church-pastors-title" className="font-display text-xl font-semibold text-ringo-text">
              {c.title}
            </h1>
            <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-ringo-muted">{c.intro}</p>
          </div>
          <button type="button" onClick={() => { setFormError(""); setForm(blank()); }} disabled={atLimit} className={BTN_PRIMARY}>
            <Plus size={16} aria-hidden="true" />
            {c.add}
          </button>
        </header>
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
          <EmptyState icon={<UserRound size={22} aria-hidden="true" />} title={c.emptyTitle} body={c.emptyBody} />
        ) : (
          <>
            <p className="text-xs text-ringo-muted">{atLimit ? c.limit : c.count(items.length)}</p>
            <ul className="flex flex-col gap-2">
              {items.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-card border border-ringo-border bg-ringo-surface p-3">
                  {p.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photo_url} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ringo-indigo/10 text-ringo-indigo" aria-hidden="true">
                      <UserRound size={22} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ringo-text">{p.name}</p>
                    <Badge tone={p.is_published ? "active" : "inactive"}>{p.is_published ? c.status.published : c.status.hidden}</Badge>
                  </div>
                  <button type="button" onClick={() => { setFormError(""); setForm(fromRow(p)); }} className={BTN_SECONDARY} aria-label={`${c.edit}: ${p.name}`}>
                    <Pencil size={15} aria-hidden="true" />
                    {c.edit}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <AboutSection />
    </div>
  );
}

function AboutSection() {
  const { t } = useLanguage();
  const c = t.churchExpansion.pastors.about;
  const [row, setRow] = useState<{ vision_en: string; vision_fr: string; mission_en: string; mission_fr: string; is_published: boolean; updated_at: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    const r = await churchApi<{ item: Record<string, any> }>("/api/church/about");
    if (r.ok) {
      const i = r.body.item;
      setRow({ vision_en: i.vision_en ?? "", vision_fr: i.vision_fr ?? "", mission_en: i.mission_en ?? "", mission_fr: i.mission_fr ?? "", is_published: i.is_published === true, updated_at: i.updated_at ?? null });
    } else setError(churchErrorText(t, r.code));
  }, [t]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!row) return;
    setSaving(true);
    setError("");
    const { updated_at, ...rest } = row;
    const r = await churchApi("/api/church/about", { method: "PUT", body: updated_at ? { ...rest, expected_updated_at: updated_at } : rest });
    setSaving(false);
    if (!r.ok) {
      if (r.code === "stale") await load();
      return setError(churchErrorText(t, r.code));
    }
    show(c.saved);
    await load();
  };

  if (!row) return error ? <ErrorLine message={error} /> : <ListSkeleton rows={2} />;
  const set = <K extends keyof typeof row>(k: K, v: (typeof row)[K]) => setRow((r) => (r ? { ...r, [k]: v } : r));
  return (
    <section aria-labelledby="church-about-title" className="flex flex-col gap-4 rounded-card border border-ringo-border bg-ringo-surface p-4 sm:p-5">
      <div>
        <h2 id="church-about-title" className="font-display text-base font-semibold text-ringo-text">
          {c.title}
        </h2>
        <p className="mt-1 text-xs text-ringo-muted">{c.intro}</p>
      </div>
      <NoticeBar message={notice} />
      <Field id="ab-vision-en" label={c.visionEn} optional>
        <textarea id="ab-vision-en" className={INPUT} rows={4} maxLength={1500} value={row.vision_en} onChange={(e) => set("vision_en", e.target.value)} />
      </Field>
      <Field id="ab-vision-fr" label={c.visionFr} optional>
        <textarea id="ab-vision-fr" className={INPUT} rows={4} maxLength={1500} value={row.vision_fr} onChange={(e) => set("vision_fr", e.target.value)} />
      </Field>
      <Field id="ab-mission-en" label={c.missionEn} optional>
        <textarea id="ab-mission-en" className={INPUT} rows={4} maxLength={1500} value={row.mission_en} onChange={(e) => set("mission_en", e.target.value)} />
      </Field>
      <Field id="ab-mission-fr" label={c.missionFr} optional>
        <textarea id="ab-mission-fr" className={INPUT} rows={4} maxLength={1500} value={row.mission_fr} onChange={(e) => set("mission_fr", e.target.value)} />
      </Field>
      <label htmlFor="ab-published" className="flex min-h-[44px] items-center gap-3 text-sm font-medium text-ringo-text">
        <input id="ab-published" type="checkbox" className="h-5 w-5 rounded border-ringo-border accent-ringo-indigo" checked={row.is_published} onChange={(e) => set("is_published", e.target.checked)} />
        {c.published}
      </label>
      <ErrorLine message={error} />
      <div>
        <button type="button" onClick={save} disabled={saving} className={BTN_PRIMARY}>
          {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
          {saving ? c.saving : c.save}
        </button>
      </div>
    </section>
  );
}
