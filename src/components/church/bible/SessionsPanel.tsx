"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import { churchErrorText } from "../lifecycle/errorText";
import { BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, ErrorLine, Field, INPUT, ListSkeleton, Modal, NoticeBar, churchApi, useNotice } from "../people/shared";

export interface SessionRow {
  id: string;
  position: number;
  title_en: string | null;
  title_fr: string | null;
  scripture_ref_en: string | null;
  scripture_ref_fr: string | null;
  note_en: string | null;
  note_fr: string | null;
  updated_at: string;
}
export interface Stats {
  enrolled: number;
  detailed: boolean;
  sessions: { id: string; position: number; completed: number | null }[];
}
interface Body {
  sessions: SessionRow[];
  stats: Stats | null;
  maxSessions: number;
}
type Lang = "en" | "fr";
type Form = Record<"title_en" | "title_fr" | "scripture_ref_en" | "scripture_ref_fr" | "note_en" | "note_fr", string>;
const blank: Form = { title_en: "", title_fr: "", scripture_ref_en: "", scripture_ref_fr: "", note_en: "", note_fr: "" };
const toForm = (s: SessionRow): Form => ({ title_en: s.title_en ?? "", title_fr: s.title_fr ?? "", scripture_ref_en: s.scripture_ref_en ?? "", scripture_ref_fr: s.scripture_ref_fr ?? "", note_en: s.note_en ?? "", note_fr: s.note_fr ?? "" });

// The days of a Bible programme, and (for people who may see it) how many people follow it. A day is a title, the scripture REFERENCE the church types (no Bible text is stored) and a note. While the
// programme is a draft the manage permission edits the days; once it is live only the publish permission does. The numbers never name anyone.
export default function SessionsPanel({ programId, live, caps }: { programId: string; live: boolean; caps: ChurchCapabilities }) {
  const { t, locale } = useLanguage();
  const lang: Lang = locale === "fr" ? "fr" : "en";
  const c = t.churchBible.sessions;
  const [data, setData] = useState<Body | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | { mode: "add" } | { mode: "edit"; session: SessionRow }>(null);
  const [deleting, setDeleting] = useState<SessionRow | null>(null);
  const { notice, show } = useNotice();
  const mayEdit = live ? caps.publishBible : caps.manageBible;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const r = await churchApi<Body>(`/api/church/bible/${programId}`);
    setLoading(false);
    if (!r.ok) return setLoadError(churchErrorText(t, r.code));
    setData(r.body);
  }, [programId, t]);
  useEffect(() => {
    load();
  }, [load]);

  const titleOf = (s: SessionRow) => (lang === "fr" ? s.title_fr || s.title_en : s.title_en || s.title_fr) || c.untitled;

  const move = async (s: SessionRow, direction: "up" | "down") => {
    setBusy(true);
    setError("");
    const r = await churchApi(`/api/church/bible/${programId}/sessions/${s.id}/move`, { method: "POST", body: { direction } });
    setBusy(false);
    if (!r.ok) return setError(churchErrorText(t, r.code));
    await load();
  };

  const remove = async (): Promise<string> => {
    if (!deleting) return "";
    const r = await churchApi(`/api/church/bible/${programId}/sessions/${deleting.id}?expected_updated_at=${encodeURIComponent(deleting.updated_at)}`, { method: "DELETE" });
    if (!r.ok) return churchErrorText(t, r.code);
    setDeleting(null);
    show(c.deleted);
    await load();
    return "";
  };

  if (loading && !data) return <ListSkeleton rows={2} />;
  if (loadError || !data) {
    return (
      <div className="mt-8 flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
        <ErrorLine message={loadError} />
        <button type="button" className={BTN_SECONDARY} onClick={load}>
          {t.churchPeople.common.retry}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8 flex flex-col gap-8 border-t border-ringo-border/70 pt-6">
      <NoticeBar message={notice} />
      <SessionsView
        lang={lang}
        data={data}
        caps={caps}
        live={live}
        mayEdit={mayEdit}
        busy={busy}
        error={error}
        onAdd={() => setDialog({ mode: "add" })}
        onMove={move}
        onEdit={(s) => setDialog({ mode: "edit", session: s })}
        onAskDelete={setDeleting}
      />

      {dialog && (
        <SessionDialog
          programId={programId}
          session={dialog.mode === "edit" ? dialog.session : null}
          initialLang={lang}
          onClose={() => setDialog(null)}
          onReload={async () => {
            setDialog(null);
            await load();
          }}
          onSaved={async (message) => {
            setDialog(null);
            show(message);
            await load();
          }}
        />
      )}
      {deleting && <ConfirmDialog title={c.deleteTitle} body={c.deleteBody(titleOf(deleting))} confirmLabel={c.deleteConfirm} danger onCancel={() => setDeleting(null)} onConfirm={remove} />}
    </div>
  );
}

export interface SessionsViewProps {
  lang: Lang;
  data: { sessions: SessionRow[]; stats: Stats | null; maxSessions: number };
  caps: ChurchCapabilities;
  live: boolean;
  mayEdit: boolean;
  busy: boolean;
  error: string;
  onAdd: () => void;
  onMove: (s: SessionRow, direction: "up" | "down") => void;
  onEdit: (s: SessionRow) => void;
  onAskDelete: (s: SessionRow) => void;
}

// The presentational half: the days and the participant counts, from the data it is given. Exported so every state (empty, full, view only, live without the publish permission, few or many participants) can be
// rendered and checked offline.
export function SessionsView(p: SessionsViewProps) {
  const { t } = useLanguage();
  const c = t.churchBible.sessions;
  const { lang, data, caps, live, mayEdit, busy } = p;
  const stats = data.stats;
  const completedOf = (id: string) => stats?.sessions.find((x) => x.id === id)?.completed ?? null;
  const titleOf = (s: SessionRow) => (lang === "fr" ? s.title_fr || s.title_en : s.title_en || s.title_fr) || c.untitled;
  return (
    <>
      <section aria-labelledby="bible-days-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="bible-days-heading" className="font-display text-base font-semibold text-ringo-text">
            {c.heading} <span className="text-sm font-normal text-ringo-muted">({c.count(data.sessions.length)})</span>
          </h3>
          {mayEdit && data.sessions.length < data.maxSessions && (
            <button type="button" className={BTN_PRIMARY} onClick={p.onAdd} disabled={busy}>
              <Plus size={16} aria-hidden="true" />
              {c.add}
            </button>
          )}
        </div>
        <p className="text-sm leading-relaxed text-ringo-muted">{c.help}</p>
        {!mayEdit && <p className="text-sm text-ringo-muted">{live && caps.manageBible ? c.liveNeedsPublish : c.viewOnly}</p>}
        {data.sessions.length >= data.maxSessions && <p className="text-sm text-ringo-muted">{c.limit(data.maxSessions)}</p>}
        <ErrorLine message={p.error} />
        {data.sessions.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-ringo-border px-4 py-6 text-center text-sm text-ringo-muted">{c.empty}</p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {data.sessions.map((s, i) => {
              const title = titleOf(s);
              const ref = (lang === "fr" ? s.scripture_ref_fr || s.scripture_ref_en : s.scripture_ref_en || s.scripture_ref_fr) || "";
              const done = completedOf(s.id);
              return (
                <li key={s.id} className="flex min-h-[56px] items-center gap-2 rounded-2xl border border-ringo-border/70 bg-ringo-surface px-3 py-2">
                  <span className="w-14 shrink-0 text-xs font-semibold text-ringo-muted">{c.position(i + 1)}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-ringo-text">{title}</span>
                    {ref && <span className="truncate text-xs text-ringo-muted">{ref}</span>}
                  </span>
                  {stats?.detailed && done !== null && <span className="shrink-0 text-xs text-ringo-muted">{t.churchBible.stats.finished(done, stats.enrolled)}</span>}
                  {mayEdit && (
                    <span className="flex shrink-0 items-center">
                      <IconButton label={c.moveUp(title)} onClick={() => p.onMove(s, "up")} disabled={busy || i === 0}>
                        <ArrowUp size={16} aria-hidden="true" />
                      </IconButton>
                      <IconButton label={c.moveDown(title)} onClick={() => p.onMove(s, "down")} disabled={busy || i === data.sessions.length - 1}>
                        <ArrowDown size={16} aria-hidden="true" />
                      </IconButton>
                      <IconButton label={c.edit(title)} onClick={() => p.onEdit(s)} disabled={busy}>
                        <Pencil size={16} aria-hidden="true" />
                      </IconButton>
                      <IconButton label={c.delete(title)} onClick={() => p.onAskDelete(s)} disabled={busy} danger>
                        <Trash2 size={16} aria-hidden="true" />
                      </IconButton>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {stats && (
        <section aria-labelledby="bible-stats-heading" className="flex flex-col gap-2">
          <h3 id="bible-stats-heading" className="flex items-center gap-2 font-display text-base font-semibold text-ringo-text">
            <Users size={16} className="text-ringo-indigo" aria-hidden="true" />
            {t.churchBible.stats.heading}
          </h3>
          <p className="text-sm font-medium text-ringo-text">{t.churchBible.stats.enrolled(stats.enrolled)}</p>
          <p className="text-xs leading-relaxed text-ringo-muted">{t.churchBible.stats.privacy}</p>
          {stats.enrolled > 0 && !stats.detailed && <p className="text-xs leading-relaxed text-ringo-muted">{t.churchBible.stats.small}</p>}
        </section>
      )}

    </>
  );
}

function IconButton({ label, onClick, disabled, danger = false, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-ringo-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 disabled:opacity-40 ${danger ? "hover:bg-ringo-coral/10 hover:text-ringo-coral" : "hover:bg-ringo-indigo/[0.06] hover:text-ringo-indigo"}`}
    >
      {children}
    </button>
  );
}

// Add or edit one day. ONE Save button; an edit carries the updated_at that was loaded, so it is refused (with a reload) if someone else changed the day meanwhile.
function SessionDialog({ programId, session, initialLang, onClose, onReload, onSaved }: { programId: string; session: SessionRow | null; initialLang: Lang; onClose: () => void; onReload: () => Promise<void>; onSaved: (message: string) => Promise<void> }) {
  const { t } = useLanguage();
  const c = t.churchBible.sessions;
  const d = c.dialog;
  const [form, setForm] = useState<Form>(session ? toForm(session) : blank);
  const [lang, setLang] = useState<Lang>(initialLang);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const hasTitle = form.title_en.trim() !== "" || form.title_fr.trim() !== "";
  const original = session ? toForm(session) : blank;
  const dirty = JSON.stringify(form) !== JSON.stringify(original);

  const save = async () => {
    if (!hasTitle) return setError(d.needsTitle);
    setBusy(true);
    setError("");
    const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== original[k as keyof Form]));
    const r = session
      ? await churchApi(`/api/church/bible/${programId}/sessions/${session.id}`, { method: "PATCH", body: { ...changed, expected_updated_at: session.updated_at } })
      : await churchApi(`/api/church/bible/${programId}/sessions`, { method: "POST", body: form });
    setBusy(false);
    if (!r.ok) {
      if (r.code === "stale") setStale(true);
      return setError(churchErrorText(t, r.code));
    }
    await onSaved(session ? c.saved : c.added);
  };

  return (
    <Modal title={session ? d.editTitle : d.addTitle} onClose={busy ? () => {} : onClose} wide labelledBy="bible-session-dialog-title">
      <div role="tablist" aria-label={d.languageTabs} className="inline-flex self-start rounded-full border border-ringo-border bg-ringo-surface p-1">
        {(["en", "fr"] as const).map((l) => (
          <button
            key={l}
            id={`bible-session-tab-${l}`}
            role="tab"
            type="button"
            aria-selected={lang === l}
            aria-controls={`bible-session-panel-${l}`}
            onClick={() => setLang(l)}
            className={`flex min-h-[40px] items-center gap-2 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 ${lang === l ? "bg-ringo-indigo text-white" : "text-ringo-muted hover:text-ringo-text"}`}
          >
            {d.languages[l]}
            <span className={`h-2 w-2 rounded-full ${form[`title_${l}`].trim() !== "" ? "bg-emerald-400" : "bg-ringo-muted/40"}`} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div id={`bible-session-panel-${lang}`} role="tabpanel" aria-labelledby={`bible-session-tab-${lang}`} className="flex flex-col gap-4">
        <Field id={`bible-session-title-${lang}`} label={d.title}>
          <input id={`bible-session-title-${lang}`} className={INPUT} value={form[`title_${lang}`]} onChange={(e) => set(`title_${lang}`, e.target.value)} maxLength={120} placeholder={d.titlePlaceholder} autoComplete="off" disabled={busy} />
        </Field>
        <Field id={`bible-session-ref-${lang}`} label={d.reference} optional>
          <input id={`bible-session-ref-${lang}`} className={INPUT} value={form[`scripture_ref_${lang}`]} onChange={(e) => set(`scripture_ref_${lang}`, e.target.value)} maxLength={120} placeholder={d.referencePlaceholder} autoComplete="off" disabled={busy} />
        </Field>
        <Field id={`bible-session-note-${lang}`} label={d.note} optional>
          <textarea id={`bible-session-note-${lang}`} className={`${INPUT} min-h-[96px] resize-y`} value={form[`note_${lang}`]} onChange={(e) => set(`note_${lang}`, e.target.value)} maxLength={1000} placeholder={d.notePlaceholder} disabled={busy} />
        </Field>
      </div>
      {stale && (
        <div role="alert" className="rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-3">
          <p className="text-sm text-ringo-coral">{d.stale}</p>
        </div>
      )}
      <ErrorLine message={error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={busy}>
          {d.cancel}
        </button>
        {stale ? (
          <button type="button" className={BTN_PRIMARY} onClick={onReload}>
            {d.reload}
          </button>
        ) : (
          <button type="button" className={BTN_PRIMARY} onClick={save} disabled={busy || !dirty || !hasTitle}>
            {busy ? d.saving : d.save}
          </button>
        )}
      </div>
    </Modal>
  );
}
