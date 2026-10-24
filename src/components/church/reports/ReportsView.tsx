"use client";

import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ReportModel, ReportSectionId } from "@/lib/church/reports/build";
import { REPORT_SECTIONS } from "@/lib/church/reports/build";
import { sectionFigures } from "@/lib/church/reports/csv";
import { addDays } from "@/lib/church/reports/period";
import { churchErrorText } from "../lifecycle/errorText";
import { BTN_PRIMARY, BTN_SECONDARY, ErrorLine, INPUT, ListSkeleton, churchApi, formatDay } from "../people/shared";

interface ReportBody {
  report: ReportModel;
  allowed: ReportSectionId[];
}

const doualaToday = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
const titleOf = (en: string | null, fr: string | null, lang: "en" | "fr") => (lang === "fr" ? fr || en : en || fr) || null;

/** The report itself, drawn from data already loaded. Pure presentation: no fetch, no storage. Counts only; there is no name anywhere in the model it draws. */
export function ReportSections({ report, lang }: { report: ReportModel; lang: "en" | "fr" }) {
  const { t } = useLanguage();
  const c = t.churchReports;
  const shown = REPORT_SECTIONS.filter((id) => report.sections[id] || report.failed.includes(id));
  if (shown.length === 0) return <p className="rounded-2xl border border-dashed border-ringo-border bg-ringo-surface/60 px-5 py-8 text-center text-sm text-ringo-muted">{c.state.noSections}</p>;

  return (
    <div className="flex flex-col gap-4">
      {shown.map((id) => {
        const failed = report.failed.includes(id);
        const scope = id === "people" ? c.scope.mixed : id === "groups" || id === "bible" ? c.scope.snapshot : c.scope.range;
        const figures = (c.figures as Record<string, Record<string, string>>)[id];
        const csvHref = `/api/church/reports?from=${report.period.from}&to=${report.period.to}&section=${id}&format=csv&lang=${lang}`;
        return (
          <section key={id} aria-labelledby={`report-${id}`} className="rounded-3xl border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 id={`report-${id}`} className="font-display text-base font-semibold text-ringo-text">
                  {c.sections[id]}
                </h2>
                <p className="text-xs text-ringo-muted">{scope}</p>
              </div>
              {!failed && (
                <a href={csvHref} download aria-label={c.csv.downloadLabel(c.sections[id])} className={BTN_SECONDARY}>
                  <Download size={16} aria-hidden="true" />
                  {c.csv.download}
                </a>
              )}
            </div>
            {failed ? (
              <ErrorLine message={c.state.failed} />
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {sectionFigures(id, report).map(([key, value]) => (
                    <div key={key} className="rounded-2xl bg-ringo-bg px-3 py-2.5">
                      <dt className="text-xs text-ringo-muted">{figures[key] ?? key}</dt>
                      <dd className="font-display text-lg font-semibold text-ringo-text">{value}</dd>
                    </div>
                  ))}
                </dl>
                {id === "attendance" && report.sections.attendance && <AttendanceTable data={report.sections.attendance} lang={lang} />}
                {id === "bible" && report.sections.bible && <BibleTable data={report.sections.bible} lang={lang} />}
              </>
            )}
          </section>
        );
      })}
      <p className="text-xs text-ringo-muted">{c.csv.note}</p>
    </div>
  );
}

function AttendanceTable({ data, lang }: { data: NonNullable<ReportModel["sections"]["attendance"]>; lang: "en" | "fr" }) {
  const { t } = useLanguage();
  const a = t.churchReports.attendance;
  if (data.events.length === 0) return <p className="mt-3 text-sm text-ringo-muted">{a.none}</p>;
  const max = Math.max(1, ...data.events.map((e) => e.total));
  return (
    <div className="mt-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <caption className="sr-only">{a.tableLabel}</caption>
          <thead>
            <tr className="border-b border-ringo-border/70 text-xs text-ringo-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">{a.date}</th>
              <th scope="col" className="py-2 pr-3 font-semibold">{a.event}</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">{a.present}</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">{a.visitors}</th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">{a.children}</th>
              <th scope="col" className="py-2 text-right font-semibold">{a.total}</th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.event_id} className="border-b border-ringo-border/40 align-top">
                <td className="whitespace-nowrap py-2 pr-3 text-ringo-muted">{formatDay(e.event_date, lang)}</td>
                <td className="py-2 pr-3 text-ringo-text">
                  {titleOf(e.title_en, e.title_fr, lang) ?? a.untitled}
                  {e.is_cancelled && <span className="ml-2 text-xs text-ringo-muted">({a.cancelled})</span>}
                  <span className="mt-1 block h-1.5 rounded-full bg-ringo-indigo/10" aria-hidden="true">
                    <span className="block h-1.5 rounded-full bg-ringo-indigo" style={{ width: `${Math.round((e.total / max) * 100)}%` }} />
                  </span>
                </td>
                {e.recorded ? (
                  <>
                    <td className="py-2 pr-3 text-right">{e.present}</td>
                    <td className="py-2 pr-3 text-right">{e.visitors}</td>
                    <td className="py-2 pr-3 text-right">{e.children}</td>
                    <td className="py-2 text-right font-semibold">{e.total}</td>
                  </>
                ) : (
                  <td colSpan={4} className="py-2 text-right text-xs text-ringo-muted">{a.notRecorded}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.truncated && <p className="mt-2 text-xs text-ringo-muted">{a.truncated(data.events.length)}</p>}
    </div>
  );
}

function BibleTable({ data, lang }: { data: NonNullable<ReportModel["sections"]["bible"]>; lang: "en" | "fr" }) {
  const { t } = useLanguage();
  const b = t.churchReports.bible;
  return (
    <div className="mt-4">
      {data.programs.length === 0 ? (
        <p className="text-sm text-ringo-muted">{b.none}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] text-left text-sm">
            <caption className="sr-only">{b.tableLabel}</caption>
            <thead>
              <tr className="border-b border-ringo-border/70 text-xs text-ringo-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">{b.program}</th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">{b.sessions}</th>
                <th scope="col" className="py-2 text-right font-semibold">{b.followers}</th>
              </tr>
            </thead>
            <tbody>
              {data.programs.map((p) => (
                <tr key={p.program_id} className="border-b border-ringo-border/40">
                  <td className="py-2 pr-3 text-ringo-text">{titleOf(p.title_en, p.title_fr, lang) ?? b.untitled}</td>
                  <td className="py-2 pr-3 text-right">{p.sessions}</td>
                  <td className="py-2 text-right font-semibold">{p.enrolled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-ringo-muted">{b.privacyNote}</p>
      {data.truncated && <p className="mt-1 text-xs text-ringo-muted">{b.truncated(data.programs.length)}</p>}
    </div>
  );
}

export default function ReportsView() {
  const { t, locale } = useLanguage();
  const c = t.churchReports;
  const lang = locale === "fr" ? "fr" : "en";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<ReportBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (f?: string, tt?: string) => {
      setLoading(true);
      setError("");
      const qs = f && tt ? `?from=${encodeURIComponent(f)}&to=${encodeURIComponent(tt)}` : "";
      const r = await churchApi<ReportBody>(`/api/church/reports${qs}`);
      setLoading(false);
      if (r.ok) {
        setData(r.body);
        setFrom(r.body.report.period.from);
        setTo(r.body.report.period.to);
      } else setError(churchErrorText(t, r.code));
    },
    [t]
  );
  useEffect(() => {
    load();
    // the first load uses the server's default range; later loads are explicit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preset = (days: number) => {
    const end = doualaToday();
    load(addDays(end, -(days - 1)), end);
  };
  const thisYear = () => {
    const end = doualaToday();
    load(`${end.slice(0, 4)}-01-01`, end);
  };

  return (
    <div>
      <p className="mb-1 text-sm leading-relaxed text-ringo-muted">{c.subtitle}</p>
      <p className="mb-4 text-xs text-ringo-muted">{c.privacy}</p>

      <form
        className="mb-5 rounded-3xl border border-ringo-border/70 bg-ringo-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (from && to) load(from, to);
        }}
      >
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-ringo-text">{c.range.legend}</legend>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-xs text-ringo-muted">
              {c.range.from}
              <input id="church-report-from" type="date" className={INPUT} value={from} min="2020-01-01" onChange={(e) => setFrom(e.target.value)} required />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-ringo-muted">
              {c.range.to}
              <input id="church-report-to" type="date" className={INPUT} value={to} onChange={(e) => setTo(e.target.value)} required />
            </label>
            <button type="submit" className={BTN_PRIMARY} disabled={loading || !from || !to}>
              {c.range.apply}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => preset(7)} disabled={loading}>{c.range.last7}</button>
            <button type="button" className={BTN_SECONDARY} onClick={() => preset(30)} disabled={loading}>{c.range.last30}</button>
            <button type="button" className={BTN_SECONDARY} onClick={() => preset(90)} disabled={loading}>{c.range.last90}</button>
            <button type="button" className={BTN_SECONDARY} onClick={thisYear} disabled={loading}>{c.range.thisYear}</button>
          </div>
          <p className="mt-2 text-xs text-ringo-muted">{c.range.hint}</p>
        </fieldset>
      </form>

      {error ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
          <ErrorLine message={`${c.state.loadError} ${error}`} />
          <button type="button" className={BTN_SECONDARY} onClick={() => load(from || undefined, to || undefined)}>
            {t.churchPeople.common.retry}
          </button>
        </div>
      ) : loading && !data ? (
        <ListSkeleton rows={4} />
      ) : data ? (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading} aria-live="polite">
          <p className="mb-3 text-xs text-ringo-muted">
            {c.state.updated(formatDay(data.report.period.from, lang), formatDay(data.report.period.to, lang))} · {c.range.shown(data.report.period.days)}
          </p>
          <ReportSections report={data.report} lang={lang} />
        </div>
      ) : null}
    </div>
  );
}
