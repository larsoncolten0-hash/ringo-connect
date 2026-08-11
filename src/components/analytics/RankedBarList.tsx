import { Inbox } from "lucide-react";

const RANK_COLORS = ["text-amber-500", "text-slate-400", "text-amber-700"];

export default function RankedBarList({
  items,
  emptyLabel,
}: {
  items: { label: string; count: number }[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center text-center gap-2 py-8">
        <span className="w-9 h-9 rounded-full bg-ringo-muted/10 flex items-center justify-center">
          <Inbox size={15} className="text-ringo-muted" />
        </span>
        <p className="text-sm text-ringo-muted max-w-[220px]">{emptyLabel}</p>
      </div>
    );
  }

  const max = Math.max(...items.map((i) => i.count), 1);

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div key={item.label} className="relative">
          <div
            className="absolute inset-y-0 left-0 bg-ringo-indigo/10 rounded-card transition-all duration-500 ease-out"
            style={{ width: `${Math.max((item.count / max) * 100, 4)}%` }}
          />
          <div className="relative flex items-center gap-2.5 px-3 py-2.5 text-sm">
            <span
              className={`w-4 shrink-0 text-[11px] font-medium tabular-nums text-right ${
                i < 3 ? RANK_COLORS[i] : "text-ringo-muted/50"
              }`}
            >
              {i + 1}
            </span>
            <span className="text-ringo-text truncate flex-1">{item.label}</span>
            <span className="text-ringo-muted font-medium tabular-nums shrink-0">
              {item.count.toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}