"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { callInboxTool, savedRepliesUrl, toolErrorKey, type ToolErrorKey } from "@/lib/inbox/client";
import type { SavedReply } from "@/lib/inbox/data";
import { BODY_MAX, SAVED_REPLY_LIMIT, TITLE_MAX } from "@/lib/inbox/format";

// The owner's saved replies: add, edit, delete. Every change is one call to our own route (the profile comes from the session, never from here).
// A saved reply is only a template: using one (from the reply box in a conversation) inserts its text into the box, where it can be edited
// before the owner decides to send it. Nothing here sends a message.

type Draft = { id: string | null; title: string; body: string };

export default function SavedRepliesManager({ items, available, canDelete = true }: { items: SavedReply[]; available: boolean; canDelete?: boolean }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ToolErrorKey | null>(null);
  const inFlight = useRef(false);

  async function run(fn: () => ReturnType<typeof callInboxTool>, onOk: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const result = await fn();
    inFlight.current = false;
    setBusy(false);
    const key = toolErrorKey(result, "saved");
    setError(key);
    if (!key) {
      onOk();
      router.refresh();
    }
  }

  const save = () => {
    if (!draft) return;
    const body = { title: draft.title, body: draft.body };
    void run(() => (draft.id ? callInboxTool("PATCH", savedRepliesUrl(draft.id), body) : callInboxTool("POST", savedRepliesUrl(), body)), () => setDraft(null));
  };
  const remove = (id: string) => void run(() => callInboxTool("DELETE", savedRepliesUrl(id)), () => setConfirmId(null));

  const full = items.length >= SAVED_REPLY_LIMIT;
  const field = "block w-full rounded-card border border-ringo-border bg-transparent px-3 py-2 text-sm text-ringo-text placeholder:text-ringo-muted focus:border-ringo-indigo focus:outline-none";
  const secondary = "inline-flex min-h-[36px] items-center justify-center rounded-full border border-ringo-border px-4 text-xs font-medium text-ringo-text transition-colors hover:bg-ringo-surface disabled:opacity-60";
  const primary = "inline-flex min-h-[36px] items-center justify-center rounded-full bg-ringo-indigo px-4 text-xs font-medium text-white transition-opacity disabled:opacity-60";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/dashboard/inbox" className="inline-flex items-center gap-1.5 text-xs font-medium text-ringo-muted hover:text-ringo-text">
          <ArrowLeft size={14} aria-hidden="true" />
          {u.backToInbox}
        </Link>
        <h1 className="mt-2 font-display text-xl font-medium text-ringo-text">{u.savedRepliesTitle}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{u.savedRepliesIntro}</p>
      </div>

      {!available ? (
        <p role="alert" className="rounded-card border border-ringo-border p-4 text-sm text-ringo-muted">{u.savedRepliesUnavailable}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-ringo-muted">{u.savedCount(items.length)}</span>
            <button type="button" className={primary} disabled={busy || full || draft !== null} onClick={() => { setError(null); setDraft({ id: null, title: "", body: "" }); }}>
              {u.addSavedReply}
            </button>
          </div>

          {draft && (
            <form
              onSubmit={(e) => { e.preventDefault(); save(); }}
              className="flex flex-col gap-3 rounded-card border border-ringo-border p-4"
            >
              <label className="flex flex-col gap-1 text-xs font-medium text-ringo-text">
                {u.fieldTitle}
                <input className={field} value={draft.title} maxLength={TITLE_MAX} placeholder={u.titlePlaceholder} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ringo-text">
                {u.fieldMessage}
                <textarea className={`${field} min-h-[96px] resize-y`} rows={4} value={draft.body} maxLength={BODY_MAX} placeholder={u.messagePlaceholder} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
              </label>
              <div className="flex gap-2">
                <button type="submit" className={primary} disabled={busy}>{u.saveSavedReply}</button>
                <button type="button" className={secondary} disabled={busy} onClick={() => { setDraft(null); setError(null); }}>{u.cancel}</button>
              </div>
            </form>
          )}
          {error && <p role="alert" className="text-xs text-rose-700 dark:text-rose-400">{u[error]}</p>}

          {items.length === 0 && !draft ? (
            <div className="flex flex-col gap-3 rounded-card border border-dashed border-ringo-border p-4">
              <p className="text-sm text-ringo-text">{u.savedRepliesNone}</p>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ringo-muted">{u.quickStart}</p>
                <p className="mt-1 text-xs text-ringo-muted">{u.quickStartHint}</p>
              </div>
              <ul className="flex flex-wrap gap-2">
                {u.suggestions.map((s) => (
                  <li key={s.title}>
                    <button type="button" className={secondary} onClick={() => { setError(null); setDraft({ id: null, title: s.title, body: s.body }); }}>{s.title}</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 rounded-card border border-ringo-border p-3 sm:p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ringo-text">{r.title}</p>
                    <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-xs text-ringo-muted">{r.body}</p>
                  </div>
                  {confirmId === r.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-ringo-text">{u.confirmDelete}</span>
                      <button type="button" className="inline-flex min-h-[36px] items-center rounded-full bg-rose-600 px-4 text-xs font-medium text-white disabled:opacity-60" disabled={busy} onClick={() => remove(r.id)}>{u.confirmDeleteYes}</button>
                      <button type="button" className={secondary} disabled={busy} onClick={() => setConfirmId(null)}>{u.cancel}</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button type="button" className={secondary} disabled={busy} onClick={() => { setError(null); setDraft({ id: r.id, title: r.title, body: r.body }); }}>{u.edit}</button>
                      {canDelete && <button type="button" className={secondary} disabled={busy} onClick={() => { setError(null); setConfirmId(r.id); }}>{u.delete}</button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
