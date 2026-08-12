"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getPresetRange, formatRangeLabel, isSameDay, type DateRange } from "@/lib/dateRanges";

const PRESETS = ["today", "last7", "last30", "thisMonth", "lastMonth", "allTime"] as const;

function daysInMonth(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay(); // 0 = Sunday
  const numDays = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array(startOffset).fill(null);
  for (let d = 1; d <= numDays; d++) cells.push(new Date(year, month, d));
  return cells;
}

export default function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const { t, locale } = useLanguage();
  const [open, setOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<string>("last30");
  const [viewMonth, setViewMonth] = useState(new Date(value.to.getFullYear(), value.to.getMonth(), 1));
  const [pendingFrom, setPendingFrom] = useState<Date | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const applyPreset = (preset: string) => {
    setActivePreset(preset);
    onChange(getPresetRange(preset));
    setPendingFrom(null);
    setOpen(false);
  };

  const handleDayClick = (day: Date) => {
    setActivePreset("custom");
    if (!pendingFrom || day < pendingFrom) {
      setPendingFrom(day);
      return;
    }
    const from = new Date(pendingFrom);
    from.setHours(0, 0, 0, 0);
    const to = new Date(day);
    to.setHours(23, 59, 59, 999);
    onChange({ from, to });
    setPendingFrom(null);
    setOpen(false);
  };

  const cells = daysInMonth(viewMonth.getFullYear(), viewMonth.getMonth());
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(viewMonth);

  const isInRange = (day: Date) => {
    if (pendingFrom) return isSameDay(day, pendingFrom);
    return day >= value.from && day <= value.to;
  };

  const presetLabel = (p: string) => {
    const map: Record<string, string> = {
      today: t.analytics.today,
      last7: t.analytics.last7,
      last30: t.analytics.last30,
      thisMonth: t.analytics.thisMonth,
      lastMonth: t.analytics.lastMonth,
      allTime: t.analytics.allTime,
    };
    return map[p] || p;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
      >
        <Calendar size={15} className="text-ringo-muted" />
        {formatRangeLabel(value, locale)}
        <ChevronDown size={14} className="text-ringo-muted" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 z-50 bg-ringo-surface border border-ringo-border rounded-card shadow-lg flex flex-col sm:flex-row w-[calc(100vw-2rem)] max-w-[340px] sm:w-auto sm:max-w-[calc(100vw-2rem)]">
          {/* Presets */}
          <div className="flex sm:flex-col gap-1 p-2 border-b sm:border-b-0 sm:border-r border-ringo-border overflow-x-auto sm:overflow-visible sm:w-40 shrink-0">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => applyPreset(p)}
                className={`text-left text-xs px-3 py-2 rounded-card whitespace-nowrap transition ${
                  activePreset === p ? "bg-ringo-indigo/10 text-ringo-indigo font-medium" : "text-ringo-muted hover:bg-ringo-muted/10"
                }`}
              >
                {presetLabel(p)}
              </button>
            ))}
          </div>

          {/* Calendar */}
          <div className="p-3 sm:w-64">
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
                className="p-1 text-ringo-muted hover:text-ringo-text"
                aria-label="Previous month"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-medium text-ringo-text capitalize">{monthLabel}</span>
              <button
                onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
                className="p-1 text-ringo-muted hover:text-ringo-text"
                aria-label="Next month"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <span key={i} className="text-[10px] text-ringo-muted py-1">
                  {d}
                </span>
              ))}
              {cells.map((day, i) =>
                day ? (
                  <button
                    key={i}
                    onClick={() => handleDayClick(day)}
                    className={`text-xs py-1.5 rounded-card transition ${
                      isInRange(day) ? "bg-ringo-indigo text-white" : "text-ringo-text hover:bg-ringo-muted/10"
                    }`}
                  >
                    {day.getDate()}
                  </button>
                ) : (
                  <span key={i} />
                )
              )}
            </div>
            {pendingFrom && (
              <p className="text-[11px] text-ringo-muted mt-2">{t.analytics.pickEndDate}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}