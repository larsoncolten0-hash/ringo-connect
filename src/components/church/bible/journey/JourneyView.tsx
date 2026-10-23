"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, Circle, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { churchErrorText } from "../../lifecycle/errorText";
import { BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, ErrorLine, ListSkeleton, NoticeBar, churchApi, useNotice } from "../../people/shared";

export interface JourneySession {
  id: string;
  position: number;
  title_en: string | null;
  title_fr: string | null;
  scripture_ref_en: string | null;
  scripture_ref_fr: string | null;
  note_en: string | null;
  note_fr: string | null;
}
export interface JourneyData {
  program: { id: string; title_en: string | null; title_fr: string | null; description_en: string | null; description_fr: string | null };
  church: { username: string | null; name: string | null };
  sessions: JourneySession[];
  enrollment: { joined_at: string } | null;
  completed: string[];
  total: number;
  done: number;
}
type Lang = "en" | "fr";
const pick = (en: string | null, fr: string | null, lang: Lang): { text: string; fallback: boolean } => {
  const own = lang === "fr" ? fr : en;
  if (own) return { text: own, fallback: false };
  return { text: (lang === "fr" ? en : fr) ?? "", fallback: true };
};

// One Bible programme as a visitor sees it. SIGNED IN: they can follow it, tick the days they have done and stop following. NOT SIGNED IN: they read it and are asked to sign in to My Ringo (nothing is
// recorded about an anonymous reader). Progress is private to the visitor: every call below goes to /api/customer/bible/**, which knows the visitor only from their own session cookie.
export default function JourneyView({ programId, signedIn, preloaded }: { programId: string; signedIn: boolean; preloaded?: JourneyData | null }) {
  const { t, locale } = useLanguage();
  const lang: Lang = locale === "fr" ? "fr" : "en";
  const c = t.churchBible.journey;
  const [data, setData] = useState<JourneyData | null>(preloaded ?? null);
  const [loading, setLoading] = useState(signedIn);
  const [missing, setMissing] = useState(!signedIn && !preloaded);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [leaving, setLeaving] = useState(false);
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    if (!signedIn) return;
    setLoading(true);
    setLoadError("");
    const r = await churchApi<JourneyData>(`/api/customer/bible/${programId}`);
    setLoading(false);
    if (r.ok) {
      setData(r.body);
      setMissing(false);
    } else if (r.status === 404) {
      setMissing(true);
      setData(null);
    } else setLoadError(churchErrorText(t, r.code));
  }, [programId, signedIn, t]);
  useEffect(() => {
    load();
  }, [load]);

  const join = async () => {
    setBusy("join");
    setError("");
    const r = await churchApi(`/api/customer/bible/${programId}/join`, { method: "POST", body: {} });
    setBusy("");
    if (!r.ok) return setError(churchErrorText(t, r.code));
    show(c.joined);
    await load();
  };

  const toggle = async (s: JourneySession, done: boolean) => {
    if (!data) return;
    setBusy(s.id);
    setError("");
    const before = data;
    // optimistic: the box flips at once and is put back if the server refuses
    setData({ ...data, completed: done ? [...data.completed, s.id] : data.completed.filter((x) => x !== s.id), done: data.done + (done ? 1 : -1) });
    const r = await churchApi(`/api/customer/bible/${programId}/progress`, { method: "POST", body: { session_id: s.id, done } });
    setBusy("");
    if (!r.ok) {
      setData(before);
      setError(r.status >= 500 || r.status === 0 ? c.saveError : churchErrorText(t, r.code));
    }
  };

  const leave = async (): Promise<string> => {
    const r = await churchApi(`/api/customer/bible/${programId}`, { method: "DELETE" });
    if (!r.ok) return churchErrorText(t, r.code);
    setLeaving(false);
    show(c.left);
    await load();
    return "";
  };

  if (loading && !data) return <ListSkeleton rows={4} />;
  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
        <ErrorLine message={`${c.loadError} ${loadError}`} />
        <button type="button" className={BTN_SECONDARY} onClick={load}>
          {c.retry}
        </button>
      </div>
    );
  }
  if (missing || !data) {
    return (
      <div className="rounded-3xl border border-dashed border-ringo-border bg-ringo-surface/60 px-6 py-12 text-center">
        <h2 className="font-display text-base font-semibold">{c.notFoundTitle}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ringo-muted">{c.notFoundBody}</p>
      </div>
    );
  }

  return (
    <JourneyBody
      lang={lang}
      data={data}
      signedIn={signedIn}
      notice={notice}
      error={error}
      busyId={busy}
      leaving={leaving}
      onJoin={join}
      onToggle={toggle}
      onAskLeave={setLeaving}
      onLeave={leave}
    />
  );
}

export interface JourneyBodyProps {
  lang: Lang;
  data: JourneyData;
  signedIn: boolean;
  notice: string;
  error: string;
  /** "join", or the id of the session being saved, or "". */
  busyId: string;
  leaving: boolean;
  onJoin: () => void;
  onToggle: (s: JourneySession, done: boolean) => void;
  onAskLeave: (v: boolean) => void;
  onLeave: () => Promise<string>;
}

// The presentational half: the programme, the visitor's progress and the days, from the data it is given. Exported so every state (not signed in, not joined, joined, finished, French fallback) can be
// rendered and checked offline.
export function JourneyBody(p: JourneyBodyProps) {
  const { t } = useLanguage();
  const c = t.churchBible.journey;
  const { lang, data, signedIn, error, busyId } = p;
  const title = pick(data.program.title_en, data.program.title_fr, lang);
  const description = pick(data.program.description_en, data.program.description_fr, lang);
  const joined = !!data.enrollment;
  const percent = data.total > 0 ? Math.round((data.done / data.total) * 100) : 0;
  const finished = joined && data.total > 0 && data.done >= data.total;

  return (
    <div className="flex flex-col gap-5">
      <NoticeBar message={p.notice} />
      <div>
        {data.church.username && (
          <Link href={`/${data.church.username}`} className="mb-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-ringo-indigo hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">
            {c.backToChurch(data.church.name || data.church.username)}
          </Link>
        )}
        <h2 className="font-display text-xl font-semibold leading-snug [overflow-wrap:anywhere]">{title.text}</h2>
        {description.text && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ringo-muted [overflow-wrap:anywhere]">{description.text}</p>}
        {(title.fallback || (description.text && description.fallback)) && <p className="mt-2 text-xs text-ringo-muted">{c.shownIn(c.languageName[lang === "fr" ? "en" : "fr"])}</p>}
      </div>

      {!signedIn ? (
        <div className="rounded-3xl border border-ringo-border bg-ringo-surface p-5">
          <h3 className="font-display text-base font-semibold">{c.signInTitle}</h3>
          <p className="mt-1 text-sm leading-relaxed text-ringo-muted">{c.signInBody}</p>
          <Link href="/my-ringo/signin" className={`${BTN_PRIMARY} mt-4`}>
            {c.signIn}
          </Link>
        </div>
      ) : !joined ? (
        <div className="rounded-3xl border border-ringo-border bg-ringo-surface p-5">
          <p className="text-sm leading-relaxed text-ringo-muted">{c.privacy}</p>
          <ErrorLine message={error} />
          <button type="button" className={`${BTN_PRIMARY} mt-4`} onClick={p.onJoin} disabled={busyId === "join"}>
            {busyId === "join" && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
            {busyId === "join" ? c.joining : c.join}
          </button>
        </div>
      ) : (
        <div className="rounded-3xl border border-ringo-border bg-ringo-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold" id="journey-progress-label">
              {c.progressLabel}
            </p>
            <p className="text-sm text-ringo-muted" aria-live="polite">
              {c.progress(data.done, data.total)}
            </p>
          </div>
          <div role="progressbar" aria-labelledby="journey-progress-label" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done} className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ringo-muted/20">
            <div className="h-full rounded-full bg-ringo-indigo transition-all" style={{ width: `${percent}%` }} />
          </div>
          {finished && <p className="mt-3 text-sm font-medium text-emerald-700">{c.completed}</p>}
          <ErrorLine message={error} />
        </div>
      )}

      <section aria-labelledby="journey-days-heading">
        <h3 id="journey-days-heading" className="mb-2 font-display text-base font-semibold">
          {c.daysHeading}
        </h3>
        <ol className="flex flex-col gap-2">
          {data.sessions.map((s) => {
            const st = pick(s.title_en, s.title_fr, lang);
            const ref = pick(s.scripture_ref_en, s.scripture_ref_fr, lang).text;
            const note = pick(s.note_en, s.note_fr, lang).text;
            const done = data.completed.includes(s.id);
            return (
              <li key={s.id} className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${done ? "border-emerald-600/30 bg-emerald-50/60" : "border-ringo-border/70 bg-ringo-surface"}`}>
                {joined ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={done}
                    aria-label={done ? c.markUndone(st.text) : c.markDone(st.text)}
                    onClick={() => p.onToggle(s, !done)}
                    disabled={busyId === s.id}
                    className="-ml-2 -mt-1 inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 disabled:opacity-60"
                  >
                    {done ? <Check size={20} className="rounded-full bg-emerald-600 p-0.5 text-white" aria-hidden="true" /> : <Circle size={20} className="text-ringo-muted" aria-hidden="true" />}
                  </button>
                ) : (
                  <span className="mt-0.5 w-6 shrink-0 text-xs font-semibold text-ringo-muted">{s.position}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold [overflow-wrap:anywhere]">{st.text}</p>
                  {ref && <p className="mt-0.5 text-sm text-ringo-indigo [overflow-wrap:anywhere]">{ref}</p>}
                  {note && <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ringo-muted [overflow-wrap:anywhere]">{note}</p>}
                </div>
                {done && <span className="sr-only">{c.done}</span>}
              </li>
            );
          })}
        </ol>
      </section>

      {signedIn && joined && (
        <div>
          <button type="button" className={BTN_SECONDARY} onClick={() => p.onAskLeave(true)}>
            {c.leave}
          </button>
        </div>
      )}
      {p.leaving && <ConfirmDialog title={c.leaveTitle} body={c.leaveBody} confirmLabel={c.leaveConfirm} danger onCancel={() => p.onAskLeave(false)} onConfirm={p.onLeave} />}
    </div>
  );
}
