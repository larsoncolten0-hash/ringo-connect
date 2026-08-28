import { type LucideIcon } from "lucide-react";

// Same icon-chip header treatment as the editor's EditorCard, sized down
// slightly for the denser analytics grid — keeps every section on this
// page reading as one system instead of a mix of plain-text and iconed
// headers.
export default function AnalyticsCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-ringo-indigo/10 flex items-center justify-center shrink-0">
            <Icon size={12} className="text-ringo-indigo" />
          </span>
          <p className="text-sm font-medium text-ringo-text tracking-[-0.01em]">{title}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
