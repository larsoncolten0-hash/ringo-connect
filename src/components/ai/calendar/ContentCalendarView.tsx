"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

type CalendarItem = {
  id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  title: string | null;
  content: string;
  cta: string | null;
  image_url: string | null;
  content_type: string;
  status: string;
  reminder_enabled: boolean;
  community_post_id: string | null;
};
type CalendarPlan = { id: string; year: number; month: number; title: string | null; focus: string | null } | null;

const MONTH_NAMES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_NAMES_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const WEEKDAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const CONTENT_TYPE_DOT: Record<string, string> = {
  announcement: "bg-ringo-indigo",
  promotion: "bg-fuchsia-500",
  product: "bg-emerald-500",
  service: "bg-sky-500",
  educational: "bg-amber-500",
  engagement: "bg-pink-500",
  event: "bg-violet-500",
  music: "bg-rose-500",
  behind_the_scenes: "bg-teal-500",
  reminder: "bg-orange-500",
  seasonal: "bg-lime-500",
  community: "bg-cyan-500",
  other: "bg-ringo-muted",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
/** ISO weekday (1=Mon..7=Sun) of the 1st of the month, for grid alignment. */
function firstWeekday(year: number, month: number) {
  const d = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return d === 0 ? 7 : d;
}

export default function ContentCalendarView({ initialYear, initialMonth }: { initialYear: number; initialMonth: number }) {
  const { t, locale } = useLanguage();
  const c = t.ringoAi.calendar;
  const monthNames = locale === "fr" ? MONTH_NAMES_FR : MONTH_NAMES_EN;
  const weekdays = locale === "fr" ? WEEKDAYS_FR : WEEKDAYS_EN;

  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [plan, setPlan] = useState<CalendarPlan>(null);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (y: number, m: number) => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`/api/ai/calendar/plans?year=${y}&month=${m}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPlan(data.plan);
      setItems(data.items || []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(year, month);
  }, [year, month, load]);

  const goMonth = (delta: number) => {
    let y = year;
    let m = month + delta;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setYear(y);
    setMonth(m);
    setSelectedId(null);
  };
  const goToday = () => {
    const now = new Date();
    setYear(now.getUTCFullYear());
    setMonth(now.getUTCMonth() + 1);
    setSelectedId(null);
  };

  const itemsByDay = useMemo(() => {
    const map = new Map<number, CalendarItem[]>();
    for (const item of items) {
      const day = Number(item.scheduled_date.slice(8, 10));
      const list = map.get(day) || [];
      list.push(item);
      map.set(day, list);
    }
    return map;
  }, [items]);

  const planMyMonth = () => {
    const prompt = `Plan my ${monthNames[month - 1]} ${year} content.`;
    window.dispatchEvent(new CustomEvent("ringo-ai:open", { detail: { prompt } }));
  };

  const updateItemLocal = (updated: CalendarItem) => setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
  const removeItemLocal = (id: string) => setItems((prev) => prev.filter((it) => it.id !== id));

  const totalDays = daysInMonth(year, month);
  const leadingBlanks = firstWeekday(year, month) - 1;
  const cells: (number | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const selected = items.find((it) => it.id === selectedId) || null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-ringo-text">{c.title}</h1>
          <p className="text-sm text-ringo-muted mt-0.5">{c.subtitle}</p>
        </div>
        <button
          onClick={planMyMonth}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-card bg-gradient-to-br from-ringo-indigo to-fuchsia-500 text-white text-sm font-semibold shrink-0"
        >
          <Sparkles size={15} />
          {c.planMyMonth}
        </button>
      </div>

      <div className="flex items-center justify-between rounded-card border border-ringo-border/70 bg-ringo-surface px-3 py-2.5">
        <button onClick={() => goMonth(-1)} aria-label={c.previousMonth} className="w-8 h-8 rounded-xl flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10">
          <ChevronLeft size={16} />
        </button>
        <button onClick={goToday} className="text-sm font-semibold text-ringo-text hover:text-ringo-indigo transition">
          {monthNames[month - 1]} {year}
        </button>
        <button onClick={() => goMonth(1)} aria-label={c.nextMonth} className="w-8 h-8 rounded-xl flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10">
          <ChevronRight size={16} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin text-ringo-muted" />
        </div>
      ) : loadError ? (
        <p className="text-sm text-ringo-coral text-center py-10">{c.loadError}</p>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {weekdays.map((w) => (
              <div key={w} className="text-center text-[10px] font-semibold uppercase tracking-wide text-ringo-muted py-1">
                {w}
              </div>
            ))}
            {cells.map((day, i) => {
              const dayItems = day ? itemsByDay.get(day) || [] : [];
              return (
                <div
                  key={i}
                  className={`min-h-[64px] sm:min-h-[76px] rounded-xl border px-1.5 py-1.5 flex flex-col gap-1 ${
                    day ? "border-ringo-border/60 bg-ringo-surface" : "border-transparent"
                  }`}
                >
                  {day && (
                    <>
                      <span className="text-[10px] font-medium text-ringo-muted">{day}</span>
                      {dayItems.slice(0, 3).map((it) => (
                        <button
                          key={it.id}
                          onClick={() => setSelectedId(it.id)}
                          className="flex items-center gap-1 text-left rounded-md px-1 py-0.5 hover:bg-ringo-muted/10 transition"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CONTENT_TYPE_DOT[it.content_type] || "bg-ringo-muted"}`} />
                          <span className="text-[10px] text-ringo-text truncate leading-tight">{it.title || c.contentTypeLabels[it.content_type] || it.content_type}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {items.length === 0 && <p className="text-sm text-ringo-muted text-center py-6">{c.noItemsThisMonth}</p>}
        </>
      )}

      {selected && (
        <ItemDetailPanel
          item={selected}
          onClose={() => setSelectedId(null)}
          onUpdated={updateItemLocal}
          onDeleted={() => {
            removeItemLocal(selected.id);
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}

function ItemDetailPanel({
  item,
  onClose,
  onUpdated,
  onDeleted,
}: {
  item: CalendarItem;
  onClose: () => void;
  onUpdated: (item: CalendarItem) => void;
  onDeleted: () => void;
}) {
  const { t } = useLanguage();
  const c = t.ringoAi.calendar;
  const [content, setContent] = useState(item.content);
  const [title, setTitle] = useState(item.title || "");
  const [cta, setCta] = useState(item.cta || "");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(item.content);
    setTitle(item.title || "");
    setCta(item.cta || "");
    setError(null);
    setConfirmDelete(false);
    setConfirmPublish(false);
  }, [item.id]);

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/calendar/items/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.item) {
        setError(c.saveError);
        return;
      }
      onUpdated(data.item);
    } catch {
      setError(c.saveError);
    } finally {
      setSaving(false);
    }
  };

  const save = () => patch({ title: title.trim() || null, content, cta: cta.trim() || null });
  const setStatus = (status: string) => patch({ status });

  const remove = async () => {
    const res = await fetch(`/api/ai/calendar/items/${item.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) onDeleted();
    else setError(c.saveError);
  };

  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/calendar/items/${item.id}/publish`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(c.publishError);
        return;
      }
      onUpdated({ ...item, status: "published", community_post_id: data.communityPostId });
    } catch {
      setError(c.publishError);
    } finally {
      setPublishing(false);
      setConfirmPublish(false);
    }
  };

  const generateImage = async () => {
    setGeneratingImage(true);
    setImageError(null);
    try {
      const res = await fetch("/api/ai/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `${title || item.title || ""}. ${content}`.slice(0, 800) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.imageUrl) {
        setImageError(data?.error === "image_not_eligible" ? c.imageUnavailable : c.saveError);
        return;
      }
      await patch({ imageUrl: data.imageUrl });
    } catch {
      setImageError(c.saveError);
    } finally {
      setGeneratingImage(false);
    }
  };

  const isPublished = item.status === "published";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl bg-ringo-surface border border-ringo-border/70 max-h-[88vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-ringo-border/60 sticky top-0 bg-ringo-surface">
          <p className="text-sm font-semibold text-ringo-text">
            {c.scheduledFor} {item.scheduled_date}
          </p>
          <button onClick={onClose} aria-label={t.ringoAi.close} className="w-8 h-8 rounded-xl flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <span className="self-start text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded-md bg-ringo-indigo/10 text-ringo-indigo">
            {c.statusLabels[item.status] || item.status}
          </span>

          {item.image_url && (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.image_url} alt={title} className="w-full h-auto max-h-56 object-contain rounded-xl border border-ringo-border/60 bg-ringo-muted/[0.06]" />
              {!isPublished && (
                <button
                  onClick={() => patch({ imageUrl: null })}
                  className="absolute top-1.5 right-1.5 text-[11px] px-2 py-1 rounded-lg bg-slate-900/70 text-white"
                >
                  {c.removeImage}
                </button>
              )}
            </div>
          )}

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isPublished}
            placeholder={c.noContentType}
            className="text-sm font-medium border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text disabled:opacity-60"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={isPublished}
            rows={5}
            className="text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text resize-none disabled:opacity-60"
          />
          <input
            value={cta}
            onChange={(e) => setCta(e.target.value)}
            disabled={isPublished}
            className="text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text disabled:opacity-60"
          />

          {imageError && <p className="text-xs text-ringo-coral">{imageError}</p>}
          {error && <p className="text-xs text-ringo-coral">{error}</p>}

          {!isPublished && (
            <div className="flex flex-wrap gap-2">
              <button onClick={save} disabled={saving} className="text-xs font-semibold px-3 py-2 rounded-xl bg-ringo-indigo text-white disabled:opacity-50">
                {saving ? c.saving : c.save}
              </button>
              {!item.image_url && (
                <button onClick={generateImage} disabled={generatingImage} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl border border-ringo-border text-ringo-muted disabled:opacity-50">
                  <ImageIcon size={12} />
                  {generatingImage ? c.generatingImage : c.generateImage}
                </button>
              )}
              {item.status !== "approved" && (
                <button onClick={() => setStatus("approved")} className="text-xs font-medium px-3 py-2 rounded-xl border border-ringo-border text-ringo-muted">
                  {c.approve}
                </button>
              )}
              <button onClick={() => setStatus("postponed")} className="text-xs font-medium px-3 py-2 rounded-xl border border-ringo-border text-ringo-muted">
                {c.postpone}
              </button>
              <button onClick={() => setStatus("cancelled")} className="text-xs font-medium px-3 py-2 rounded-xl border border-ringo-border text-ringo-muted">
                {c.cancel}
              </button>
              {confirmDelete ? (
                <button onClick={remove} className="text-xs font-semibold px-3 py-2 rounded-xl bg-ringo-coral text-white">
                  {c.delete}?
                </button>
              ) : (
                <button onClick={() => setConfirmDelete(true)} aria-label={c.delete} className="text-xs font-medium px-2.5 py-2 rounded-xl border border-ringo-border text-ringo-muted">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )}

          <div className="pt-1 border-t border-ringo-border/60">
            {isPublished ? (
              <p className="text-xs text-emerald-600 pt-2">{c.alreadyPublished}</p>
            ) : confirmPublish ? (
              <div className="flex items-center gap-2 pt-2">
                <span className="text-xs text-ringo-text flex-1">{c.publishConfirm}</span>
                <button onClick={() => setConfirmPublish(false)} className="text-xs text-ringo-muted">
                  {c.cancel}
                </button>
                <button onClick={publish} disabled={publishing} className="text-xs font-semibold px-3 py-2 rounded-xl bg-ringo-indigo text-white disabled:opacity-50">
                  {publishing ? c.publishing : c.publish}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmPublish(true)}
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-card bg-gradient-to-br from-ringo-indigo to-fuchsia-500 text-white text-sm font-semibold"
              >
                <Plus size={15} />
                {c.publish}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
