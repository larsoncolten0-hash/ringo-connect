"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, Network, Trash2, UsersRound } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { churchErrorText } from "../lifecycle/errorText";
import PictureField from "../lifecycle/PictureField";
import { Badge, BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, ErrorLine, Field, INPUT, ListSkeleton, NoticeBar, churchApi, useNotice } from "../people/shared";
import { PUBLIC_GROUP_KINDS, GROUP_PHOTO_LIMIT } from "@/lib/church/pubgroups/kinds";

interface GroupRow {
  id: string;
  kind: string;
  leader_name: string | null;
  leader_photo_url: string | null;
  description_en: string | null;
  description_fr: string | null;
  is_published: boolean;
  updated_at: string;
}
interface PhotoRow {
  id: string;
  image_url: string;
  updated_at: string;
}
interface FormState {
  leader_name: string;
  leader_photo_url: string;
  description_en: string;
  description_fr: string;
  is_published: boolean;
}
const toForm = (r: GroupRow | null): FormState => ({ leader_name: r?.leader_name ?? "", leader_photo_url: r?.leader_photo_url ?? "", description_en: r?.description_en ?? "", description_fr: r?.description_fr ?? "", is_published: r?.is_published ?? false });

// The church's public group pages (Men, Women, Youths, Children): a leader, a welcome text and photos. Nothing here lists a member. Each change names the version it is based on, so two people editing
// at once never overwrite each other silently. The server and the database decide what is allowed; this screen only says it earlier and in the visitor's language.
export default function PubGroupsView({ username, canManage }: { username: string | null; canManage: boolean }) {
  const { t } = useLanguage();
  const c = t.churchExpansion.groups;
  const [items, setItems] = useState<GroupRow[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError("");
    const r = await churchApi<{ items: GroupRow[] }>("/api/church/public-groups");
    if (r.ok) setItems(r.body.items);
    else setLoadError(churchErrorText(t, r.code));
  }, [t]);
  useEffect(() => {
    load();
  }, [load]);

  if (editing) {
    return <GroupEditor kind={editing} row={items?.find((g) => g.kind === editing) ?? null} username={username} canManage={canManage} onBack={() => setEditing(null)} onChanged={load} />;
  }

  return (
    <section aria-labelledby="church-pubgroups-title" className="flex flex-col gap-5">
      <header>
        <h1 id="church-pubgroups-title" className="font-display text-xl font-semibold text-ringo-text">
          {c.title}
        </h1>
        <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-ringo-muted">{c.intro}</p>
      </header>
      {loadError ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorLine message={loadError || c.loadError} />
          <button type="button" onClick={load} className={BTN_SECONDARY}>
            {c.retry}
          </button>
        </div>
      ) : items === null ? (
        <ListSkeleton rows={4} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {PUBLIC_GROUP_KINDS.map((kind) => {
            const row = items.find((g) => g.kind === kind);
            const label = (c.kinds as Record<string, string>)[kind];
            return (
              <li key={kind} className="flex flex-col gap-3 rounded-card border border-ringo-border bg-ringo-surface p-4">
                <div className="flex items-center gap-3">
                  <UsersRound size={20} className="shrink-0 text-ringo-indigo" aria-hidden="true" />
                  <h2 className="min-w-0 flex-1 truncate font-display text-base font-semibold text-ringo-text">{label}</h2>
                  <Badge tone={row ? (row.is_published ? "active" : "inactive") : "pending"}>{row ? (row.is_published ? c.status.published : c.status.hidden) : c.status.notSet}</Badge>
                </div>
                {row?.leader_name && <p className="truncate text-sm text-ringo-muted">{c.public.led(row.leader_name)}</p>}
                <div className="flex flex-wrap gap-2">
                  {canManage || row ? (
                    <button type="button" onClick={() => setEditing(kind)} className={row ? BTN_SECONDARY : BTN_PRIMARY} aria-label={`${row ? c.edit : c.setUp}: ${label}`}>
                      {row ? c.edit : c.setUp}
                    </button>
                  ) : null}
                  {row?.is_published && username && (
                    <a href={`/${encodeURIComponent(username)}/church/groups/${kind}`} target="_blank" rel="noopener noreferrer" className={BTN_SECONDARY}>
                      <ExternalLink size={15} aria-hidden="true" />
                      {c.viewPublic}
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="flex items-start gap-2 text-xs leading-relaxed text-ringo-muted">
        <Network size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        {c.childrenNote}
      </p>
    </section>
  );
}

function GroupEditor({ kind, row, username, canManage, onBack, onChanged }: { kind: string; row: GroupRow | null; username: string | null; canManage: boolean; onBack: () => void; onChanged: () => Promise<void> }) {
  const { t } = useLanguage();
  const c = t.churchExpansion.groups;
  const label = (c.kinds as Record<string, string>)[kind];
  const [form, setForm] = useState<FormState>(() => toForm(row));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const { notice, show } = useNotice();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError("");
    const body: Record<string, unknown> = { ...form };
    if (row) body.expected_updated_at = row.updated_at;
    else body.kind = kind;
    const r = await churchApi(row ? `/api/church/public-groups/${row.id}` : "/api/church/public-groups", { method: row ? "PATCH" : "POST", body });
    setSaving(false);
    if (!r.ok) {
      if (r.code === "stale") await onChanged();
      return setError(churchErrorText(t, r.code));
    }
    show(c.form.saved);
    await onChanged();
  };

  const remove = async (): Promise<string> => {
    if (!row) return "";
    const r = await churchApi(`/api/church/public-groups/${row.id}?expected_updated_at=${encodeURIComponent(row.updated_at)}`, { method: "DELETE" });
    if (!r.ok) return churchErrorText(t, r.code);
    setRemoving(false);
    await onChanged();
    onBack();
    return "";
  };

  const readOnly = !canManage;
  return (
    <section aria-labelledby="church-pubgroup-title" className="flex flex-col gap-5">
      <button type="button" onClick={onBack} className="inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-full px-2 text-sm font-semibold text-ringo-indigo hover:bg-ringo-indigo/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">
        <ArrowLeft size={16} aria-hidden="true" />
        {c.form.back}
      </button>
      <h1 id="church-pubgroup-title" className="font-display text-xl font-semibold text-ringo-text">
        {c.form.title(label)}
      </h1>
      {kind === "children" && <p className="rounded-2xl border border-ringo-border bg-ringo-surface px-4 py-3 text-sm leading-relaxed text-ringo-muted">{c.childrenNote}</p>}
      <NoticeBar message={notice} />
      <div className="flex flex-col gap-4 rounded-card border border-ringo-border bg-ringo-surface p-4 sm:p-5">
        <Field id="pg-leader" label={c.form.leaderName} hint={c.form.leaderNameHelp} optional>
          <input id="pg-leader" className={INPUT} value={form.leader_name} maxLength={80} disabled={readOnly} onChange={(e) => set("leader_name", e.target.value)} autoComplete="off" />
        </Field>
        <Field id="pg-leader-photo" label={c.form.leaderPhoto} optional>
          <PictureField value={form.leader_photo_url} disabled={readOnly} labels={{ choose: c.form.choosePhoto, remove: c.form.removePhoto }} onChange={(url) => set("leader_photo_url", url)} />
        </Field>
        <Field id="pg-desc-en" label={c.form.descriptionEn} hint={c.form.descriptionHelp} optional>
          <textarea id="pg-desc-en" className={INPUT} rows={4} maxLength={600} value={form.description_en} disabled={readOnly} onChange={(e) => set("description_en", e.target.value)} />
        </Field>
        <Field id="pg-desc-fr" label={c.form.descriptionFr} optional>
          <textarea id="pg-desc-fr" className={INPUT} rows={4} maxLength={600} value={form.description_fr} disabled={readOnly} onChange={(e) => set("description_fr", e.target.value)} />
        </Field>
        <label htmlFor="pg-published" className="flex min-h-[44px] items-start gap-3 text-sm font-medium text-ringo-text">
          <input id="pg-published" type="checkbox" className="mt-0.5 h-5 w-5 rounded border-ringo-border accent-ringo-indigo" checked={form.is_published} disabled={readOnly} onChange={(e) => set("is_published", e.target.checked)} aria-describedby="pg-published-hint" />
          <span>
            {c.form.published}
            <span id="pg-published-hint" className="mt-0.5 block text-xs font-normal text-ringo-muted">
              {c.form.publishedHelp}
            </span>
          </span>
        </label>
        <ErrorLine message={error} />
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={saving} className={BTN_PRIMARY}>
              {saving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
              {saving ? c.form.saving : c.form.save}
            </button>
            {row?.is_published && username && (
              <a href={`/${encodeURIComponent(username)}/church/groups/${kind}`} target="_blank" rel="noopener noreferrer" className={BTN_SECONDARY}>
                <ExternalLink size={15} aria-hidden="true" />
                {c.viewPublic}
              </a>
            )}
            {row && (
              <button type="button" onClick={() => setRemoving(true)} className={`${BTN_SECONDARY} ml-auto text-ringo-coral`}>
                <Trash2 size={15} aria-hidden="true" />
                {c.form.remove}
              </button>
            )}
          </div>
        )}
      </div>

      {row ? <Photos group={row} kind={kind} canManage={canManage} /> : <p className="text-sm text-ringo-muted">{c.photos.saveFirst}</p>}

      {removing && <ConfirmDialog title={c.form.removeTitle} body={c.form.removeBody} confirmLabel={c.form.removeConfirm} danger onConfirm={remove} onCancel={() => setRemoving(false)} />}
    </section>
  );
}

function Photos({ group, kind, canManage }: { group: GroupRow; kind: string; canManage: boolean }) {
  const { t } = useLanguage();
  const c = t.churchExpansion.groups.photos;
  const [photos, setPhotos] = useState<PhotoRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/church/public-groups/${group.id}/photos`;

  const load = useCallback(async () => {
    const r = await churchApi<{ items: PhotoRow[] }>(base);
    if (r.ok) setPhotos(r.body.items);
    else setError(churchErrorText(t, r.code));
  }, [base, t]);
  useEffect(() => {
    load();
  }, [load]);

  const add = async (url: string) => {
    if (!url) return;
    setBusy(true);
    setError("");
    const r = await churchApi(base, { method: "POST", body: { image_url: url } });
    setBusy(false);
    if (!r.ok) return setError(churchErrorText(t, r.code));
    await load();
  };
  const remove = async (p: PhotoRow) => {
    setBusy(true);
    setError("");
    const r = await churchApi(`${base}/${p.id}?expected_updated_at=${encodeURIComponent(p.updated_at)}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok && r.code !== "not_found") setError(churchErrorText(t, r.code));
    await load();
  };

  const count = photos?.length ?? 0;
  return (
    <div className="flex flex-col gap-3 rounded-card border border-ringo-border bg-ringo-surface p-4 sm:p-5">
      <div>
        <h2 className="font-display text-base font-semibold text-ringo-text">{c.title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-ringo-muted">{kind === "children" ? c.helpChildren : c.help}</p>
      </div>
      {photos === null ? (
        <ListSkeleton rows={2} />
      ) : photos.length === 0 ? (
        <p className="text-sm text-ringo-muted">{c.empty}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p, i) => (
            <li key={p.id} className="relative overflow-hidden rounded-2xl border border-ringo-border bg-ringo-bg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.image_url} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
              {canManage && (
                <button type="button" onClick={() => remove(p)} disabled={busy} aria-label={c.removeLabel(i + 1)} className={`${BTN_DANGER} absolute right-2 top-2 !min-h-[44px] !px-3`}>
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ringo-muted">{count >= GROUP_PHOTO_LIMIT ? c.limit : c.count(count)}</p>
      <ErrorLine message={error} />
      {canManage && count < GROUP_PHOTO_LIMIT && (
        <div aria-busy={busy}>
          <PictureField value="" onChange={add} disabled={busy} labels={{ choose: busy ? c.adding : c.add, remove: c.remove }} />
        </div>
      )}
    </div>
  );
}
