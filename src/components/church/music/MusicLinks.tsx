"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Music2, Pencil, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { MUSIC_PLATFORM_IDS } from "@/lib/church/music/platforms";
import { churchErrorText } from "../lifecycle/errorText";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, EmptyState, ErrorLine, Field, INPUT, ListSkeleton, NoticeBar, churchApi, useNotice } from "../people/shared";

export interface MusicRow {
  id: string;
  platform: string;
  title: string;
  url: string;
  is_visible: boolean;
  sort_order: number;
  updated_at: string;
}
interface ListBody {
  items: MusicRow[];
  limit: number;
}
export interface MusicFormState {
  /** null = a new link */
  id: string | null;
  platform: string;
  title: string;
  url: string;
  is_visible: boolean;
}
export const blankForm = (): MusicFormState => ({ id: null, platform: "spotify", title: "", url: "", is_visible: true });

// The church's music links: where its music already lives (Spotify, YouTube, ...). A link-out only: nothing is uploaded, played or sold. Every change names the version it is based on, so two people
// editing at once never overwrite each other silently. The server and the database decide what is allowed; this screen only says it earlier and in the visitor's language.
export default function MusicLinks() {
  const { t } = useLanguage();
  const c = t.churchMusic;
  const [data, setData] = useState<ListBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<MusicFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [removing, setRemoving] = useState<MusicRow | null>(null);
  const [rowError, setRowError] = useState("");
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const r = await churchApi<ListBody>("/api/church/music");
    setLoading(false);
    if (r.ok) setData(r.body);
    else setLoadError(churchErrorText(t, r.code));
  }, [t]);
  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!form) return;
    setSaving(true);
    setFormError("");
    const current = form.id ? data?.items.find((x) => x.id === form.id) : null;
    const body: Record<string, unknown> = { platform: form.platform, title: form.title, url: form.url, is_visible: form.is_visible };
    if (current) body.expected_updated_at = current.updated_at;
    const r = await churchApi(form.id ? `/api/church/music/${form.id}` : "/api/church/music", { method: form.id ? "PATCH" : "POST", body });
    setSaving(false);
    if (!r.ok) {
      if (r.code === "stale") {
        setForm(null);
        show(c.notices.stale);
        await load();
        return;
      }
      return setFormError(churchErrorText(t, r.code));
    }
    show(form.id ? c.notices.saved : c.notices.added);
    setForm(null);
    await load();
  };

  const toggle = async (row: MusicRow) => {
    setRowError("");
    const r = await churchApi(`/api/church/music/${row.id}`, { method: "PATCH", body: { is_visible: !row.is_visible, expected_updated_at: row.updated_at } });
    if (!r.ok) {
      if (r.code === "stale") show(c.notices.stale);
      else setRowError(churchErrorText(t, r.code));
      await load();
      return;
    }
    show(row.is_visible ? c.notices.hidden : c.notices.shown);
    await load();
  };

  const remove = async (): Promise<string> => {
    if (!removing) return "";
    const r = await churchApi(`/api/church/music/${removing.id}?expected_updated_at=${encodeURIComponent(removing.updated_at)}`, { method: "DELETE" });
    if (!r.ok) {
      if (r.code === "stale") {
        setRemoving(null);
        show(c.notices.stale);
        await load();
        return "";
      }
      return churchErrorText(t, r.code);
    }
    setRemoving(null);
    show(c.notices.removed);
    await load();
    return "";
  };

  return (
    <MusicLinksView
      data={data}
      loading={loading}
      loadError={loadError}
      notice={notice}
      rowError={rowError}
      form={form}
      saving={saving}
      formError={formError}
      removing={removing}
      onRetry={load}
      onAdd={() => {
        setFormError("");
        setForm(blankForm());
      }}
      onEdit={(row) => {
        setFormError("");
        setForm({ id: row.id, platform: row.platform, title: row.title, url: row.url, is_visible: row.is_visible });
      }}
      onForm={setForm}
      onCancelForm={() => setForm(null)}
      onSubmit={submit}
      onToggle={toggle}
      onAskRemove={setRemoving}
      onRemove={remove}
    />
  );
}

export interface MusicLinksViewProps {
  data: ListBody | null;
  loading: boolean;
  loadError: string;
  notice: string;
  rowError: string;
  form: MusicFormState | null;
  saving: boolean;
  formError: string;
  removing: MusicRow | null;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (row: MusicRow) => void;
  onForm: (next: MusicFormState) => void;
  onCancelForm: () => void;
  onSubmit: () => void;
  onToggle: (row: MusicRow) => void;
  onAskRemove: (row: MusicRow | null) => void;
  onRemove: () => Promise<string>;
}

/** Presentation only: every state of the screen is drawn from its props. */
export function MusicLinksView(p: MusicLinksViewProps) {
  const { t } = useLanguage();
  const c = t.churchMusic;
  const platformName = (id: string) => (c.platforms as Record<string, string>)[id] ?? id;
  const atLimit = !!p.data && p.data.items.length >= p.data.limit;

  return (
    <div>
      <p className="mb-4 text-sm leading-relaxed text-ringo-muted">{c.subtitle}</p>
      <NoticeBar message={p.notice} />
      {p.loadError ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
          <ErrorLine message={`${c.list.loadError} ${p.loadError}`} />
          <button type="button" className={BTN_SECONDARY} onClick={p.onRetry}>
            {t.churchPeople.common.retry}
          </button>
        </div>
      ) : p.loading && !p.data ? (
        <ListSkeleton rows={3} />
      ) : p.data ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ringo-muted" aria-live="polite">
              {c.list.count(p.data.items.length)}
            </p>
            {!p.form && (
              <button type="button" className={BTN_PRIMARY} onClick={p.onAdd} disabled={atLimit}>
                <Plus size={16} aria-hidden="true" />
                {c.list.add}
              </button>
            )}
          </div>
          {atLimit && !p.form && <p className="mb-3 text-xs text-ringo-muted">{c.list.limitReached(p.data.limit)}</p>}
          {p.form && <MusicForm form={p.form} saving={p.saving} error={p.formError} onChange={p.onForm} onCancel={p.onCancelForm} onSubmit={p.onSubmit} />}
          {p.rowError && (
            <div className="mb-3">
              <ErrorLine message={p.rowError} />
            </div>
          )}
          {p.data.items.length === 0 ? (
            !p.form && <EmptyState icon={<Music2 size={22} />} title={c.list.emptyTitle} body={c.list.emptyBody} />
          ) : (
            <ul className="flex flex-col gap-2">
              {p.data.items.map((row) => (
                <li key={row.id} className="flex flex-col gap-2 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ringo-text [overflow-wrap:anywhere]">{row.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ringo-muted">
                      <Badge tone="child">{platformName(row.platform)}</Badge>
                      {!row.is_visible && <Badge tone="inactive">{c.list.hiddenBadge}</Badge>}
                    </p>
                    <p className="mt-1 text-xs text-ringo-muted [overflow-wrap:anywhere]">{row.url}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" className={ICON_BTN} aria-label={c.actions.edit(row.title)} title={c.actions.edit(row.title)} onClick={() => p.onEdit(row)}>
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={ICON_BTN}
                      aria-label={row.is_visible ? c.actions.hide(row.title) : c.actions.show(row.title)}
                      title={row.is_visible ? c.actions.hide(row.title) : c.actions.show(row.title)}
                      onClick={() => p.onToggle(row)}
                    >
                      {row.is_visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                    </button>
                    <button type="button" className={ICON_BTN} aria-label={c.actions.remove(row.title)} title={c.actions.remove(row.title)} onClick={() => p.onAskRemove(row)}>
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
      {p.removing && <ConfirmDialog title={c.actions.removeTitle} body={c.actions.removeBody(p.removing.title)} confirmLabel={c.actions.removeConfirm} danger onCancel={() => p.onAskRemove(null)} onConfirm={p.onRemove} />}
    </div>
  );
}

const ICON_BTN =
  "ringo-tactile inline-flex h-11 w-11 items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-indigo/[0.06] hover:text-ringo-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40";

function MusicForm({ form, saving, error, onChange, onCancel, onSubmit }: { form: MusicFormState; saving: boolean; error: string; onChange: (f: MusicFormState) => void; onCancel: () => void; onSubmit: () => void }) {
  const { t } = useLanguage();
  const c = t.churchMusic;
  const filled = form.title.trim() !== "" && form.url.trim() !== "";
  return (
    <form
      className="mb-4 flex flex-col gap-4 rounded-2xl border border-ringo-indigo/30 bg-ringo-surface p-4"
      aria-labelledby="church-music-form-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (filled && !saving) onSubmit();
      }}
    >
      <h2 id="church-music-form-title" className="font-display text-base font-semibold text-ringo-text">
        {form.id ? c.form.editTitle : c.form.addTitle}
      </h2>
      <Field id="music-platform" label={c.form.platform}>
        <select id="music-platform" className={INPUT} value={form.platform} onChange={(e) => onChange({ ...form, platform: e.target.value })}>
          {MUSIC_PLATFORM_IDS.map((id) => (
            <option key={id} value={id}>
              {(c.platforms as Record<string, string>)[id]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="music-title" label={c.form.title} hint={c.form.titleHint}>
        <input id="music-title" className={INPUT} type="text" maxLength={80} aria-describedby="music-title-hint" value={form.title} onChange={(e) => onChange({ ...form, title: e.target.value })} />
      </Field>
      <Field id="music-url" label={c.form.url} hint={c.form.urlHint}>
        <input id="music-url" className={INPUT} type="url" inputMode="url" autoComplete="off" maxLength={500} aria-describedby="music-url-hint" value={form.url} onChange={(e) => onChange({ ...form, url: e.target.value })} />
      </Field>
      <label className="flex min-h-[44px] items-center gap-2 text-sm text-ringo-text">
        <input id="music-visible" type="checkbox" className="h-4 w-4" checked={form.is_visible} onChange={(e) => onChange({ ...form, is_visible: e.target.checked })} />
        {c.form.visible}
      </label>
      <ErrorLine message={error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={BTN_SECONDARY} onClick={onCancel} disabled={saving}>
          {c.form.cancel}
        </button>
        <button type="submit" className={BTN_PRIMARY} disabled={!filled || saving}>
          {saving ? c.form.saving : c.form.save}
        </button>
      </div>
    </form>
  );
}
