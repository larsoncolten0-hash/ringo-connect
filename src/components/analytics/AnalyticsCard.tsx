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
    <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface p-4 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_10px_24px_-18px_rgba(15,23,42,0.12)] transition-shadow duration-300 hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_32px_-16px_rgba(15,23,42,0.16)]">
      <div className="flex items-center justify-between gap-2 pb-4 mb-4 border-b border-ringo-border/50">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-xl bg-ringo-indigo/10 flex items-center justify-center shrink-0">
            <Icon size={14} className="text-ringo-indigo" strokeWidth={2.25} />
          </span>
          <p className="text-[15px] font-semibold text-ringo-text tracking-[-0.01em]">{title}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
