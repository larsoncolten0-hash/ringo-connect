"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, Check, Flame, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { hexToRgba } from "@/lib/color";
import { allReadings, PLAN_DAYS, referenceOf } from "@/lib/church/bibleYear/plan";
import SectionShell from "./SectionShell";
import { SERIF } from "./churchTheme";

// The reader's own page of "The Bible in one year" (/{username}/church/bible-year). The plan is the same for every church and shows REFERENCES only (a book and chapters, to be read in the reader's own
// Bible). What this page knows about the reader comes from their own session (/api/customer/church-bible-year): whether they are connected, which day they are on, which days they ticked. Nothing about the
// reader is ever sent to the church. A visitor who is not connected is pointed to the church page to connect first.

interface PlanState {
  connected: boolean;
  enrolled: boolean;
  total: number;
  day?: number;
  finished?: boolean;
  today?: { day: number; en: string; fr: string; chapters: number } | null;
  done?: number[];
  streak?: number;
}

type Theme = { accent: string; accentText: string; textColor: string; borderTint: string; radiusClass: string };

export default function ChurchBibleYearBody({ profile, username, theme }: { profile: { id: string; name: string }; username: string; theme: Theme }) {
  const { t, locale } = useLanguage();
  const c = t.churchExpansion.bibleYear;
  const lang = locale === "fr" ? "fr" : "en";
  const [state, setState] = useState<PlanState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const base = "/api/customer/church-bible-year";

  const say = useCallback((code: string) => setError((c.errors as Record<string, string>)[code] ?? c.errors.generic), [c]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}?profile_id=${encodeURIComponent(profile.id)}`, { cache: "no-store" });
      if (res.status === 401) return setState({ connected: false, enrolled: false, total: PLAN_DAYS });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d) return setLoadError(true);
      setLoadError(false);
      setState(d as PlanState);
    } catch {
      setLoadError(true);
    }
  }, [profile.id]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (key: string, method: string, body?: unknown, query = "") => {
    setBusy(key);
    setError("");
    try {
      const res = await fetch(`${base}${query}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (!res.ok) return say(typeof d?.error === "string" ? d.error : "generic");
      if (method === "DELETE") return await load();
      setState(d as PlanState);
    } catch {
      say("generic");
    } finally {
      setBusy("");
    }
  };

  const doneSet = new Set(state?.done ?? []);
  const day = state?.day ?? 1;
  const ref = (n: number): string => {
    const r = allReadings()[n - 1];
    return r ? referenceOf(r, lang) : "";
  };
  const box = `border p-5 ${theme.radiusClass}`;
  const boxStyle = { borderColor: theme.borderTint, backgroundColor: hexToRgba("#FFFFFF", 0.6) } as const;
  const btn = "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full px-5 text-[0.95rem] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";
  const filled = { backgroundColor: theme.accent, color: "#FFFFFF", outlineColor: theme.accentText } as const;
  const outline = { border: `1.5px solid ${theme.borderTint}`, color: theme.textColor, outlineColor: theme.accentText } as const;

  return (
    <SectionShell t={t} headingId="church-bible-year-heading" heading={c.title} headingLevel="h1" intro={c.intro} accentText={theme.accentText} borderTint={theme.borderTint} textColor={theme.textColor}>
      <div className="mt-6 flex flex-col gap-6" aria-live="polite">
        {loadError ? (
          <div className={box} style={boxStyle}>
            <p className="text-sm">{c.loadError}</p>
            <button type="button" onClick={load} className={`${btn} mt-3`} style={outline}>
              {c.retry}
            </button>
          </div>
        ) : state === null ? (
          <div className={box} style={boxStyle} aria-busy="true">
            <p className="text-sm" style={{ opacity: 0.7 }}>
              ...
            </p>
          </div>
        ) : !state.enrolled ? (
          <div className={box} style={boxStyle}>
            <p className="flex items-start gap-2 text-sm leading-relaxed">
              <BookOpen size={16} className="mt-0.5 shrink-0" style={{ color: theme.accentText }} aria-hidden="true" />
              {c.scriptureNote}
            </p>
            {state.connected ? (
              <button type="button" disabled={busy === "start"} onClick={() => act("start", "POST", { profile_id: profile.id })} className={`${btn} mt-4`} style={filled}>
                {busy === "start" && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {busy === "start" ? c.starting : c.start}
              </button>
            ) : (
              <p className="mt-4 text-sm leading-relaxed">
                {c.needConnect}{" "}
                <a href={`/${encodeURIComponent(username)}`} className="font-semibold underline underline-offset-2" style={{ color: theme.accentText }}>
                  {c.connectLink}
                </a>
              </p>
            )}
            <p className="mt-3 text-xs leading-relaxed" style={{ opacity: 0.75 }}>
              {c.privacy}
            </p>
          </div>
        ) : (
          <>
            <div className={box} style={boxStyle}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.accentText }}>
                {c.today} - {c.dayOf(day, state.total)}
              </p>
              {state.finished ? (
                <p className="mt-2 text-[1.1rem] font-semibold" style={{ fontFamily: SERIF }}>
                  {c.finished}
                </p>
              ) : (
                <>
                  <p className="mt-2 text-[1.5rem] font-semibold leading-tight" style={{ fontFamily: SERIF }}>
                    {state.today ? state.today[lang] : ref(day)}
                  </p>
                  {state.today && <p className="mt-1 text-sm" style={{ opacity: 0.75 }}>{c.chaptersToday(state.today.chapters)}</p>}
                </>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={busy === `tick-${day}`}
                  aria-pressed={doneSet.has(day)}
                  onClick={() => act(`tick-${day}`, "PATCH", { profile_id: profile.id, day, done: !doneSet.has(day) })}
                  className={btn}
                  style={doneSet.has(day) ? outline : filled}
                >
                  {busy === `tick-${day}` ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                  {doneSet.has(day) ? c.markUndone : c.markDone}
                </button>
                {doneSet.has(day) && <span className="text-sm font-semibold" style={{ color: theme.accentText }}>{c.doneToday}</span>}
              </div>
              <div className="mt-5">
                <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: hexToRgba(theme.accent, 0.15) }} role="progressbar" aria-valuemin={0} aria-valuemax={state.total} aria-valuenow={doneSet.size} aria-label={c.progress(doneSet.size, state.total)}>
                  <div className="h-full rounded-full" style={{ width: `${Math.round((doneSet.size / state.total) * 100)}%`, backgroundColor: theme.accent }} />
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span>{c.progress(doneSet.size, state.total)}</span>
                  {(state.streak ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: theme.accentText }}>
                      <Flame size={14} aria-hidden="true" />
                      {c.streak(state.streak ?? 0)}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <section aria-labelledby="bible-year-next" className={box} style={boxStyle}>
              <h2 id="bible-year-next" className="text-[1.2rem] font-semibold" style={{ fontFamily: SERIF }}>
                {c.thisWeek}
              </h2>
              <ul className="mt-3 flex flex-col">
                {Array.from({ length: 6 }, (_, i) => day + 1 + i)
                  .filter((n) => n <= state.total)
                  .map((n, i) => (
                    <li key={n} className="flex items-baseline justify-between gap-4 py-2 text-sm" style={i > 0 ? { borderTop: `1px solid ${theme.borderTint}` } : undefined}>
                      <span style={{ opacity: 0.7 }}>{c.dayLabel(n)}</span>
                      <span className="font-medium">{ref(n)}</span>
                    </li>
                  ))}
              </ul>
            </section>

            <details className={box} style={boxStyle}>
              <summary className="min-h-[44px] cursor-pointer text-[1.05rem] font-semibold" style={{ fontFamily: SERIF }}>
                {c.fullPlan}
              </summary>
              <p className="mt-2 text-xs" style={{ opacity: 0.75 }}>
                {c.fullPlanHint}
              </p>
              <ol className="mt-3 flex flex-col">
                {allReadings().map((r) => {
                  const reachable = r.day <= day;
                  const read = doneSet.has(r.day);
                  const label = referenceOf(r, lang);
                  return (
                    <li key={r.day} className="flex items-center gap-3 py-1" style={r.day > 1 ? { borderTop: `1px solid ${theme.borderTint}` } : undefined}>
                      <button
                        type="button"
                        disabled={!reachable || busy === `tick-${r.day}`}
                        aria-pressed={read}
                        aria-label={read ? c.unreadLabel(r.day, label) : c.readLabel(r.day, label)}
                        onClick={() => act(`tick-${r.day}`, "PATCH", { profile_id: profile.id, day: r.day, done: !read })}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition focus-visible:outline focus-visible:outline-2 disabled:opacity-40"
                        style={{ borderColor: theme.borderTint, backgroundColor: read ? theme.accent : "transparent", color: read ? "#FFFFFF" : theme.textColor, outlineColor: theme.accentText }}
                      >
                        {read ? <Check size={16} aria-hidden="true" /> : <span className="text-xs tabular-nums" aria-hidden="true">{r.day}</span>}
                      </button>
                      <span className="min-w-0 flex-1 text-sm" style={r.day === day ? { fontWeight: 700 } : undefined}>
                        <span className="sr-only">{c.dayLabel(r.day)}: </span>
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </details>

            <div>
              {confirmLeave ? (
                <div className={box} style={boxStyle} role="alertdialog" aria-labelledby="bible-year-leave">
                  <p id="bible-year-leave" className="font-semibold">
                    {c.leaveTitle}
                  </p>
                  <p className="mt-1 text-sm">{c.leaveBody}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={busy === "leave"} onClick={async () => { await act("leave", "DELETE", undefined, `?profile_id=${encodeURIComponent(profile.id)}`); setConfirmLeave(false); }} className={btn} style={outline}>
                      {c.leaveConfirm}
                    </button>
                    <button type="button" onClick={() => setConfirmLeave(false)} className={btn} style={filled}>
                      {c.keep}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmLeave(true)} className={btn} style={outline}>
                  {c.leave}
                </button>
              )}
            </div>
            <p className="text-xs leading-relaxed" style={{ opacity: 0.75 }}>
              {c.privacy}
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium" style={{ color: "#B42318" }}>
            {error}
          </p>
        )}
      </div>
    </SectionShell>
  );
}
