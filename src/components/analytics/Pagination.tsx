"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

// Always shows the first/last page and a window around the current one,
// collapsing everything else into a single "…" rather than ever
// rendering a wall of page numbers — the standard pattern for a table
// that can realistically run to hundreds of pages (a busy profile's
// click log).
function getPageList(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const keep = new Set([1, 2, total - 1, total, current - 1, current, current + 1]);
  const sorted = [...keep].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const result: (number | "…")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) result.push("…");
    result.push(p);
    prev = p;
  }
  return result;
}

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  totalItems,
  pageSize,
  itemLabel,
  ofLabel,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems: number;
  pageSize: number;
  itemLabel: string;
  ofLabel: string;
}) {
  if (totalPages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 mt-1 border-t border-ringo-border/70">
      <p className="text-xs text-ringo-muted tabular-nums">
        {from.toLocaleString("en-US")}–{to.toLocaleString("en-US")} {ofLabel} {totalItems.toLocaleString("en-US")}{" "}
        {itemLabel}
      </p>
      <nav className="flex items-center gap-1" aria-label="Pagination">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
          className="w-7 h-7 flex items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-muted/10 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
        {getPageList(page, totalPages).map((p, i) =>
          p === "…" ? (
            <span key={`ellipsis-${i}`} className="w-7 h-7 flex items-center justify-center text-xs text-ringo-muted">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              aria-current={p === page ? "page" : undefined}
              className={`w-7 h-7 shrink-0 flex items-center justify-center rounded-full text-xs font-medium tabular-nums transition-colors ${
                p === page ? "bg-ringo-indigo text-white" : "text-ringo-text hover:bg-ringo-muted/10"
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          aria-label="Next page"
          className="w-7 h-7 flex items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-muted/10 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </nav>
    </div>
  );
}
