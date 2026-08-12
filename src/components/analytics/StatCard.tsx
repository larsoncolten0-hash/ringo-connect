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
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${colors.bg}`}>
          <Icon size={12} className={colors.text} />
        </span>
        <p className="text-xs text-ringo-muted">{label}</p>
      </div>
      <p className="text-2xl font-display font-medium text-ringo-text tabular-nums tracking-[-0.02em]">
        {typeof value === "number" ? value.toLocaleString("en-US") : value}
      </p>
    </div>
  );
}