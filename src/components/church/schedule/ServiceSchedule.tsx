"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { WEEKDAY_ORDER_MONDAY_FIRST } from "@/lib/church/schedule/occurrences";
import type { Translations } from "@/lib/i18n/translations";
import { churchErrorText } from "../lifecycle/errorText";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, EmptyState, ErrorLine, Field, INPUT, ListSkeleton, NoticeBar, churchApi, useNotice } from "../people/shared";

export interface ServiceRow {
  id: string;
  title_en: string | null;
  title_fr: string | null;
  description_en: string | null;
  description_fr: string | null;
  location: string | null;
  weekday: number;
  start_time: string;
  end_time: string;
  timezone: string;
  is_enabled: boolean;
  updated_at: string;
}
interface ListBody {
  items: ServiceRow[];
  limit: number;
  can_edit: boolean;
}
export interface ServiceFormState {
  /** null = a new service */
  id: string | null;
  title_en: string;
  title_fr: string;
  description_en: string;
  description_fr: string;
  location: string;
  weekday: number;
  start_time: string;
  end_time: string;
  timezone: string;
  is_enabled: boolean;
}

/** The timezone this device uses, as the suggested default for a new service; never assumed beyond a suggestion the person can change. */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
export const blankForm = (timezone: string = deviceTimezone()): ServiceFormState => ({ id: null, title_en: "", title_fr: "", description_en: "", description_fr: "", location: "", weekday: 0, start_time: "09:00", end_time: "12:00", timezone, is_enabled: true });

const toForm = (row: ServiceRow): ServiceFormState => ({
  id: row.id,
  title_en: row.title_en ?? "",
  title_fr: row.title_fr ?? "",
  description_en: row.description_en ?? "",
  description_fr: row.description_fr ?? "",
  location: row.location ?? "",
  weekday: row.weekday,
  start_time: row.start_time,
  end_time: row.end_time,
  timezone: row.timezone,
  is_enabled: row.is_enabled,
});

const nullable = (v: string): string | null => (v.trim() === "" ? null : v);
const bodyOf = (f: ServiceFormState) => ({
  title_en: nullable(f.title_en),
  title_fr: nullable(f.title_fr),
  description_en: nullable(f.description_en),
  description_fr: nullable(f.description_fr),
  location: nullable(f.location),
  weekday: f.weekday,
  start_time: f.start_time,
  end_time: f.end_time,
  timezone: f.timezone.trim(),
  is_enabled: f.is_enabled,
});

/** The schedule screen's own sentence for a server code, falling back to the shared church sentences (so its codes never change what another screen says). */
const scheduleError = (t: Translations, code: string): string => (t.churchSchedule.errors as Record<string, string>)[code] ?? churchErrorText(t, code);
const nameOf = (row: { title_en: string | null; title_fr: string | null }, locale: string, fallback: string) => (locale === "fr" ? row.title_fr || row.title_en : row.title_en || row.title_fr) || fallback;

// The church's regular weekly services, set once. Every change names the version it is based on, so two people editing at once never overwrite each other silently. A removed service is archived,
// never deleted. The server and the database decide what is allowed; this screen only says it earlier and in the visitor's language.
export default function ServiceSchedule() {
  const { t } = useLanguage();
  const c = t.churchSchedule;
  const [data, setData] = useState<ListBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<ServiceFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [removing, setRemoving] = useState<ServiceRow | null>(null);
  const [rowError, setRowError] = useState("");
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const r = await churchApi<ListBody>("/api/church/services");
    setLoading(false);
    if (r.ok) setData(r.body);
    else setLoadError(scheduleError(t, r.code));
  }, [t]);
  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!form) return;
    setSaving(true);
    setFormError("");
    const current = form.id ? data?.items.find((x) => x.id === form.id) : null;
    const body: Record<string, unknown> = bodyOf(form);
    if (current) body.expected_updated_at = current.updated_at;
    const r = await churchApi(form.id ? `/api/church/services/${form.id}` : "/api/church/services", { method: form.id ? "PATCH" : "POST", body });
    setSaving(false);
    if (!r.ok) {
      if (r.code === "stale") {
        setForm(null);
        show(c.notices.stale);
        await load();
        return;
      }
      return setFormError(scheduleError(t, r.code));
    }
    show(form.id ? c.notices.saved : c.notices.added);
    setForm(null);
    await load();
  };

  const toggle = async (row: ServiceRow) => {
    setRowError("");
    const r = await churchApi(`/api/church/services/${row.id}`, { method: "PATCH", body: { is_enabled: !row.is_enabled, expected_updated_at: row.updated_at } });
    if (!r.ok) {
      if (r.code === "stale") show(c.notices.stale);
      else setRowError(scheduleError(t, r.code));
      await load();
      return;
    }
    show(row.is_enabled ? c.notices.switchedOff : c.notices.switchedOn);
    await load();
  };

  const remove = async (): Promise<string> => {
    if (!removing) return "";
    const r = await churchApi(`/api/church/services/${removing.id}?expected_updated_at=${encodeURIComponent(removing.updated_at)}`, { method: "DELETE" });
    if (!r.ok) {
      if (r.code === "stale") {
        setRemoving(null);
        show(c.notices.stale);
        await load();
        return "";
      }
      return scheduleError(t, r.code);
    }
    setRemoving(null);
    show(c.notices.removed);
    await load();
    return "";
  };

  return (
    <ServiceScheduleView
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
        setForm(toForm(row));
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

export interface ServiceScheduleViewProps {
  data: ListBody | null;
  loading: boolean;
  loadError: string;
  notice: string;
  rowError: string;
  form: ServiceFormState | null;
  saving: boolean;
  formError: string;
  removing: ServiceRow | null;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (row: ServiceRow) => void;
  onForm: (next: ServiceFormState) => void;
  onCancelForm: () => void;
  onSubmit: () => void;
  onToggle: (row: ServiceRow) => void;
  onAskRemove: (row: ServiceRow | null) => void;
  onRemove: () => Promise<string>;
}

/** Presentation only: every state of the screen is drawn from its props. */
export function ServiceScheduleView(p: ServiceScheduleViewProps) {
  const { t, locale } = useLanguage();
  const c = t.churchSchedule;
  const atLimit = !!p.data && p.data.items.length >= p.data.limit;
  const canEdit = !!p.data?.can_edit;

  return (
    <section aria-labelledby="church-schedule-heading" className="mb-10">
      <h2 id="church-schedule-heading" className="font-display text-lg font-semibold text-ringo-text">
        {c.title}
      </h2>
      <p className="mb-1 mt-1 text-sm leading-relaxed text-ringo-muted">{c.subtitle}</p>
      <p className="mb-4 text-xs leading-relaxed text-ringo-muted">{c.timezoneNote}</p>
      <NoticeBar message={p.notice} />
      {p.loadError ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
          <ErrorLine message={`${c.list.loadError} ${p.loadError}`} />
          <button type="button" className={BTN_SECONDARY} onClick={p.onRetry}>
            {t.churchPeople.common.retry}
          </button>
        </div>
      ) : p.loading && !p.data ? (
        <ListSkeleton rows={2} />
      ) : p.data ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ringo-muted" aria-live="polite">
              {c.list.count(p.data.items.length)}
            </p>
            {canEdit && !p.form && (
              <button type="button" className={BTN_PRIMARY} onClick={p.onAdd} disabled={atLimit}>
                <Plus size={16} aria-hidden="true" />
                {c.list.add}
              </button>
            )}
          </div>
          {!canEdit && <p className="mb-3 text-xs text-ringo-muted">{c.list.readOnly}</p>}
          {atLimit && !p.form && canEdit && <p className="mb-3 text-xs text-ringo-muted">{c.list.limitReached(p.data.limit)}</p>}
          {p.form && <ServiceForm form={p.form} saving={p.saving} error={p.formError} onChange={p.onForm} onCancel={p.onCancelForm} onSubmit={p.onSubmit} />}
          {p.rowError && (
            <div className="mb-3">
              <ErrorLine message={p.rowError} />
            </div>
          )}
          {p.data.items.length === 0 ? (
            !p.form && <EmptyState icon={<CalendarClock size={22} />} title={c.list.emptyTitle} body={c.list.emptyBody} />
          ) : (
            <ul className="flex flex-col gap-2">
              {[...p.data.items]
                .sort((a, b) => WEEKDAY_ORDER_MONDAY_FIRST.indexOf(a.weekday) - WEEKDAY_ORDER_MONDAY_FIRST.indexOf(b.weekday) || (a.start_time < b.start_time ? -1 : 1))
                .map((row) => {
                  const name = nameOf(row, locale, c.unnamed);
                  return (
                    <li key={row.id} className="flex flex-col gap-2 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ringo-text [overflow-wrap:anywhere]">{name}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ringo-muted">
                          <Badge tone="child">{c.weekdays[row.weekday]}</Badge>
                          <span>{`${row.start_time} - ${row.end_time}`}</span>
                          <span>{row.timezone}</span>
                          {!row.is_enabled && <Badge tone="inactive">{c.list.offBadge}</Badge>}
                        </p>
                        {row.location && <p className="mt-1 text-xs text-ringo-muted [overflow-wrap:anywhere]">{row.location}</p>}
                      </div>
                      {canEdit && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button type="button" className={ICON_BTN} aria-label={c.actions.edit(name)} title={c.actions.edit(name)} onClick={() => p.onEdit(row)}>
                            <Pencil size={16} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className={ICON_BTN}
                            aria-label={row.is_enabled ? c.actions.switchOff(name) : c.actions.switchOn(name)}
                            title={row.is_enabled ? c.actions.switchOff(name) : c.actions.switchOn(name)}
                            onClick={() => p.onToggle(row)}
                          >
                            {row.is_enabled ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                          </button>
                          <button type="button" className={ICON_BTN} aria-label={c.actions.remove(name)} title={c.actions.remove(name)} onClick={() => p.onAskRemove(row)}>
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </>
      ) : null}
      {p.removing && (
        <ConfirmDialog title={c.actions.removeTitle} body={c.actions.removeBody(nameOf(p.removing, locale, c.unnamed))} confirmLabel={c.actions.removeConfirm} danger onCancel={() => p.onAskRemove(null)} onConfirm={p.onRemove} />
      )}
    </section>
  );
}

const ICON_BTN =
  "ringo-tactile inline-flex h-11 w-11 items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-indigo/[0.06] hover:text-ringo-indigo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40";

function timezoneChoices(current: string): string[] {
  let all: string[] = [];
  try {
    all = ((Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined) ?? [];
  } catch {
    all = [];
  }
  return Array.from(new Set([current, deviceTimezone(), "Africa/Douala", ...all].filter(Boolean)));
}

function ServiceForm({ form, saving, error, onChange, onCancel, onSubmit }: { form: ServiceFormState; saving: boolean; error: string; onChange: (f: ServiceFormState) => void; onCancel: () => void; onSubmit: () => void }) {
  const { t } = useLanguage();
  const c = t.churchSchedule;
  const zones = useMemo(() => timezoneChoices(form.timezone), [form.timezone]);
  const hasName = form.title_en.trim() !== "" || form.title_fr.trim() !== "";
  const filled = hasName && form.start_time !== "" && form.end_time !== "" && form.start_time < form.end_time && form.timezone.trim() !== "";
  return (
    <form
      className="mb-4 flex flex-col gap-4 rounded-2xl border border-ringo-indigo/30 bg-ringo-surface p-4"
      aria-labelledby="church-schedule-form-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (filled && !saving) onSubmit();
      }}
    >
      <h3 id="church-schedule-form-title" className="font-display text-base font-semibold text-ringo-text">
        {form.id ? c.form.editTitle : c.form.addTitle}
      </h3>
      <Field id="service-title-en" label={c.form.titleEn} hint={c.form.titleHint}>
        <input id="service-title-en" className={INPUT} type="text" maxLength={80} aria-describedby="service-title-en-hint" value={form.title_en} onChange={(e) => onChange({ ...form, title_en: e.target.value })} />
      </Field>
      <Field id="service-title-fr" label={c.form.titleFr}>
        <input id="service-title-fr" className={INPUT} type="text" maxLength={80} value={form.title_fr} onChange={(e) => onChange({ ...form, title_fr: e.target.value })} />
      </Field>
      <Field id="service-weekday" label={c.form.weekday}>
        <select id="service-weekday" className={INPUT} value={form.weekday} onChange={(e) => onChange({ ...form, weekday: Number(e.target.value) })}>
          {WEEKDAY_ORDER_MONDAY_FIRST.map((d) => (
            <option key={d} value={d}>
              {c.weekdays[d]}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="service-start" label={c.form.start}>
          <input id="service-start" className={INPUT} type="time" required value={form.start_time} onChange={(e) => onChange({ ...form, start_time: e.target.value })} />
        </Field>
        <Field id="service-end" label={c.form.end}>
          <input id="service-end" className={INPUT} type="time" required value={form.end_time} onChange={(e) => onChange({ ...form, end_time: e.target.value })} />
        </Field>
      </div>
      <Field id="service-timezone" label={c.form.timezone} hint={c.form.timezoneHint}>
        <input id="service-timezone" className={INPUT} type="text" list="service-timezone-list" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} aria-describedby="service-timezone-hint" value={form.timezone} onChange={(e) => onChange({ ...form, timezone: e.target.value })} />
        <datalist id="service-timezone-list">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </Field>
      <Field id="service-description-en" label={c.form.descriptionEn}>
        <textarea id="service-description-en" className={INPUT} rows={2} maxLength={400} value={form.description_en} onChange={(e) => onChange({ ...form, description_en: e.target.value })} />
      </Field>
      <Field id="service-description-fr" label={c.form.descriptionFr}>
        <textarea id="service-description-fr" className={INPUT} rows={2} maxLength={400} value={form.description_fr} onChange={(e) => onChange({ ...form, description_fr: e.target.value })} />
      </Field>
      <Field id="service-location" label={c.form.location} hint={c.form.locationHint}>
        <input id="service-location" className={INPUT} type="text" maxLength={160} aria-describedby="service-location-hint" value={form.location} onChange={(e) => onChange({ ...form, location: e.target.value })} />
      </Field>
      <label className="flex min-h-[44px] items-center gap-2 text-sm text-ringo-text">
        <input id="service-enabled" type="checkbox" className="h-4 w-4" checked={form.is_enabled} onChange={(e) => onChange({ ...form, is_enabled: e.target.checked })} />
        {c.form.enabled}
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
