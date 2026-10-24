"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import { churchErrorText } from "../lifecycle/errorText";
import { Badge, BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, ErrorLine, Field, INPUT, ListSkeleton, NoticeBar, churchApi, formatDay, useNotice } from "../people/shared";

export interface TestimonyItem {
  id: string;
  full_name: string;
  phone: string;
  group_label: string | null;
  lang: "en" | "fr";
  body: string;
  public_body: string | null;
  moderation_note: string | null;
  publish_consent: boolean;
  name_consent: boolean;
  consent_withdrawn_at: string | null;
  review_status: "submitted" | "under_review" | "approved" | "rejected";
  publication_status: "unpublished" | "published";
  created_at: string;
  updated_at: string;
}
export interface HistoryItem { id: string; action: string; created_at: string }
interface Can { review: boolean; edit: boolean; publish: boolean; unpublish: boolean; withdraw: boolean }
interface DetailBody { item: TestimonyItem; history: HistoryItem[]; can: Can }

const TONE = { submitted: "pending", under_review: "pending", approved: "active", rejected: "inactive" } as const;
type Pending = null | "approve" | "reject" | "publish" | "unpublish" | "withdraw_publication" | "withdraw_name";

/** The read-only part: the words, the person's permissions, the state and the history. Pure presentation. */
export function TestimonyReadOnly({ item, history }: { item: TestimonyItem; history: HistoryItem[] }) {
  const { t, locale } = useLanguage();
  const c = t.churchTestimonies.dashboard.detail;
  const list = t.churchTestimonies.dashboard.list;
  const lang = locale === "fr" ? "fr" : "en";
  const edited = item.public_body !== null;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-semibold text-ringo-text">{item.full_name}</h2>
        <p className="text-sm text-ringo-muted">
          {c.receivedOn(formatDay(item.created_at, lang))} · {c.phone}: +{item.phone} · {c.group}: {item.group_label ?? c.noGroup} · {c.language}: {c.languages[item.lang]}
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge tone={TONE[item.review_status]}>{list.review[item.review_status]}</Badge>
          <Badge tone={item.publication_status === "published" ? "leader" : "inactive"}>{item.publication_status === "published" ? c.onPage : c.notOnPage}</Badge>
        </div>
      </header>

      <section aria-labelledby="ct-original">
        <h3 id="ct-original" className="mb-1 text-sm font-semibold text-ringo-text">{edited ? c.original : c.testimony}</h3>
        <p className="whitespace-pre-line rounded-2xl bg-ringo-bg px-4 py-3 text-sm leading-relaxed text-ringo-text [overflow-wrap:anywhere]">{item.body}</p>
        {edited && (
          <>
            <h3 className="mb-1 mt-3 text-sm font-semibold text-ringo-text">{c.publicText}</h3>
            <p className="whitespace-pre-line rounded-2xl bg-ringo-bg px-4 py-3 text-sm leading-relaxed text-ringo-text [overflow-wrap:anywhere]">{item.public_body}</p>
          </>
        )}
      </section>

      <section aria-labelledby="ct-consent">
        <h3 id="ct-consent" className="mb-1 text-sm font-semibold text-ringo-text">{c.consentHeading}</h3>
        <ul className="flex flex-col gap-1 text-sm text-ringo-muted">
          <li>{item.publish_consent ? c.publishConsentYes : c.publishConsentNo}</li>
          {item.publish_consent && <li>{item.name_consent ? c.nameConsentYes : c.nameConsentNo}</li>}
          {item.consent_withdrawn_at && <li>{c.withdrawnOn(formatDay(item.consent_withdrawn_at, lang))}</li>}
        </ul>
      </section>

      <section aria-labelledby="ct-history">
        <h3 id="ct-history" className="mb-1 text-sm font-semibold text-ringo-text">{c.historyHeading}</h3>
        {history.length === 0 ? (
          <p className="text-sm text-ringo-muted">{c.historyEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {history.map((h) => (
              <li key={h.id} className="text-sm text-ringo-muted">
                {c.historyItem(c.actions[h.action] ?? h.action, formatDay(h.created_at, lang))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// One testimony: read it in full, move it through review, correct the text shown on the page (never the person's own words), write a private note, publish or take it down, and record a withdrawal of
// consent. The server and the database decide what is allowed (approval never publishes; publishing needs the person's consent, which staff can never grant); the controls only reflect it.
export default function TestimonyDetail({ id, caps }: { id: string; caps: ChurchCapabilities }) {
  const { t } = useLanguage();
  const c = t.churchTestimonies.dashboard.detail;
  const [data, setData] = useState<DetailBody | null>(null);
  const [loadError, setLoadError] = useState("");
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { notice, show } = useNotice();

  const apply = useCallback((d: DetailBody) => {
    setData(d);
    setText(d.item.public_body ?? d.item.body);
    setNote(d.item.moderation_note ?? "");
  }, []);
  const load = useCallback(async () => {
    setLoadError("");
    setStale(false);
    const r = await churchApi<DetailBody>(`/api/church/testimonies/${id}`);
    if (r.ok) apply(r.body);
    else setLoadError(churchErrorText(t, r.code));
  }, [id, apply, t]);
  useEffect(() => {
    load();
  }, [load]);

  /** Calls one change endpoint with the version that was reviewed, then reloads everything (the history changed too). */
  const call = async (path: string, method: "POST" | "PATCH", body: Record<string, unknown>, done: string): Promise<string> => {
    if (!data) return "";
    setBusy(true);
    setError("");
    const r = await churchApi(`/api/church/testimonies/${id}${path}`, { method, body: { ...body, expected_updated_at: data.item.updated_at } });
    setBusy(false);
    if (!r.ok) {
      if (r.code === "stale") setStale(true);
      const msg = churchErrorText(t, r.code);
      setError(msg);
      return msg;
    }
    setPending(null);
    show(done);
    await load();
    return "";
  };

  if (loadError)
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
        <ErrorLine message={`${c.loadError} ${loadError}`} />
        <button type="button" className={BTN_SECONDARY} onClick={load}>
          {t.churchPeople.common.retry}
        </button>
      </div>
    );
  if (!data) return <ListSkeleton rows={3} />;

  const { item, can } = data;
  const canPublishPermission = caps.publishTestimonies;
  const originalOrCurrent = item.public_body ?? item.body;
  const textChanged = text.trim() !== originalOrCurrent.trim();
  const noteChanged = note.trim() !== (item.moderation_note ?? "").trim();

  return (
    <div>
      <NoticeBar message={notice} />
      <Link href="/dashboard/church/testimonies" className="mb-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-ringo-indigo hover:bg-ringo-indigo/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">
        <ArrowLeft size={15} aria-hidden="true" />
        {c.back}
      </Link>

      {stale && (
        <div role="alert" className="mb-3 flex flex-col items-start gap-2 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
          <p className="text-sm text-ringo-coral">{c.stale}</p>
          <button type="button" className={BTN_SECONDARY} onClick={load}>
            {c.reload}
          </button>
        </div>
      )}

      <TestimonyReadOnly item={item} history={data.history} />

      <div className="mt-6 flex flex-col gap-6 border-t border-ringo-border/70 pt-5">
        {can.review && (
          <section aria-labelledby="ct-review" className="flex flex-col gap-2">
            <h3 id="ct-review" className="text-sm font-semibold text-ringo-text">{c.reviewHeading}</h3>
            <p className="text-xs text-ringo-muted">{c.approveNote}</p>
            <div className="flex flex-wrap gap-2">
              {item.review_status === "submitted" && (
                <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => call("/review", "POST", { status: "under_review" }, c.done.review)}>
                  {c.startReview}
                </button>
              )}
              {item.review_status !== "approved" && (
                <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => setPending("approve")}>
                  {c.approve}
                </button>
              )}
              {item.review_status !== "rejected" && (
                <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => setPending("reject")}>
                  {c.reject}
                </button>
              )}
              {(item.review_status === "approved" || item.review_status === "rejected") && (
                <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => call("/review", "POST", { status: "under_review" }, c.done.review)}>
                  {c.reopen}
                </button>
              )}
            </div>
          </section>
        )}

        <section aria-labelledby="ct-page" className="flex flex-col gap-2">
          <h3 id="ct-page" className="text-sm font-semibold text-ringo-text">{c.pageHeading}</h3>
          {item.publication_status === "published" ? (
            <p className="text-sm text-ringo-muted">{c.onPage}</p>
          ) : !item.publish_consent ? (
            <p className="text-sm text-ringo-muted">{c.publishBlockedConsent}</p>
          ) : item.review_status !== "approved" ? (
            <p className="text-sm text-ringo-muted">{c.publishBlockedApproval}</p>
          ) : !canPublishPermission ? (
            <p className="text-sm text-ringo-muted">{c.publishNeedsPermission}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {can.publish && (
              <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => setPending("publish")}>
                {c.publish}
              </button>
            )}
            {can.unpublish && (
              <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => setPending("unpublish")}>
                {c.unpublish}
              </button>
            )}
          </div>
        </section>

        {can.edit && (
          <section aria-labelledby="ct-edit" className="flex flex-col gap-3">
            <h3 id="ct-edit" className="text-sm font-semibold text-ringo-text">{c.editHeading}</h3>
            <p className="text-xs text-ringo-muted">{c.editHelp}</p>
            <Field id="ct-edit-text" label={c.editLabel}>
              <textarea id="ct-edit-text" className={`${INPUT} resize-y`} style={{ minHeight: "9rem" }} value={text} onChange={(e) => setText(e.target.value)} maxLength={3000} disabled={busy} />
              <span className="text-[11px] text-ringo-muted">{c.characters(text.length, 3000)}</span>
            </Field>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN_PRIMARY} disabled={busy || !textChanged || text.trim().length < 10} onClick={() => call("", "PATCH", { public_body: text }, c.saved)}>
                {busy ? c.saving : c.saveText}
              </button>
              {item.public_body !== null && (
                <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => call("", "PATCH", { public_body: null }, c.saved)}>
                  {c.revertText}
                </button>
              )}
            </div>
            <Field id="ct-note" label={c.noteLabel} hint={c.noteHelp} optional>
              <textarea id="ct-note" className={`${INPUT} resize-y`} style={{ minHeight: "5rem" }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} disabled={busy} />
            </Field>
            <div>
              <button type="button" className={BTN_SECONDARY} disabled={busy || !noteChanged} onClick={() => call("", "PATCH", { moderation_note: note.trim() === "" ? null : note }, c.saved)}>
                {c.saveNote}
              </button>
            </div>
          </section>
        )}

        {can.withdraw && (
          <section aria-labelledby="ct-withdraw" className="flex flex-col gap-2">
            <h3 id="ct-withdraw" className="text-sm font-semibold text-ringo-text">{c.withdrawHeading}</h3>
            <p className="text-xs text-ringo-muted">{c.withdrawHelp}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN_DANGER} disabled={busy} onClick={() => setPending("withdraw_publication")}>
                {c.withdrawPublication}
              </button>
              {item.name_consent && (
                <button type="button" className={BTN_SECONDARY} disabled={busy} onClick={() => setPending("withdraw_name")}>
                  {c.withdrawName}
                </button>
              )}
            </div>
          </section>
        )}

        <ErrorLine message={error} />
      </div>

      {pending === "approve" && <ConfirmDialog title={c.approveTitle} body={c.approveBody} confirmLabel={c.approveConfirm} onCancel={() => setPending(null)} onConfirm={() => call("/review", "POST", { status: "approved" }, c.done.review)} />}
      {pending === "reject" && <ConfirmDialog title={c.rejectTitle} body={c.rejectBody} confirmLabel={c.rejectConfirm} danger onCancel={() => setPending(null)} onConfirm={() => call("/review", "POST", { status: "rejected" }, c.done.review)} />}
      {pending === "publish" && <ConfirmDialog title={c.publishTitle} body={c.publishBody} confirmLabel={c.publishConfirm} onCancel={() => setPending(null)} onConfirm={() => call("/publish", "POST", { confirm: true }, c.done.published)} />}
      {pending === "unpublish" && <ConfirmDialog title={c.unpublishTitle} body={c.unpublishBody} confirmLabel={c.unpublishConfirm} onCancel={() => setPending(null)} onConfirm={() => call("/unpublish", "POST", { confirm: true }, c.done.unpublished)} />}
      {pending === "withdraw_publication" && <ConfirmDialog title={c.withdrawPublicationTitle} body={c.withdrawPublicationBody} confirmLabel={c.withdrawConfirm} danger onCancel={() => setPending(null)} onConfirm={() => call("/consent", "POST", { scope: "publication", confirm: true }, c.done.withdrawn)} />}
      {pending === "withdraw_name" && <ConfirmDialog title={c.withdrawNameTitle} body={c.withdrawNameBody} confirmLabel={c.withdrawConfirm} danger onCancel={() => setPending(null)} onConfirm={() => call("/consent", "POST", { scope: "name", confirm: true }, c.done.withdrawn)} />}
    </div>
  );
}
