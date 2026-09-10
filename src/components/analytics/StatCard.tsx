import { type LucideIcon } from "lucide-react";

const ACCENTS = {
  indigo: { bg: "bg-ringo-indigo/10", text: "text-ringo-indigo" },
  coral: { bg: "bg-ringo-coral/10", text: "text-ringo-coral" },
  teal: { bg: "bg-ringo-teal/10", text: "text-ringo-teal" },
  slate: { bg: "bg-ringo-muted/10", text: "text-ringo-muted" },
} as const;

export default function StatCard({
  label,
  value,
  icon: Icon,
  accent = "slate",
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  accent?: keyof typeof ACCENTS;
}) {
  const colors = ACCENTS[accent];

  return (
    <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_10px_24px_-18px_rgba(15,23,42,0.12)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_32px_-16px_rgba(15,23,42,0.16)]">
      <div className="flex items-center gap-2.5 mb-3">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${colors.bg}`}>
          <Icon size={14} className={colors.text} strokeWidth={2.25} />
        </span>
        <p className="text-xs font-medium text-ringo-muted">{label}</p>
      </div>
      <p className="text-2xl font-display font-semibold text-ringo-text tabular-nums tracking-[-0.02em]">
        {typeof value === "number" ? value.toLocaleString("en-US") : value}
      </p>
    </div>
  );
}