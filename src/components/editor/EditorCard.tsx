import { type LucideIcon } from "lucide-react";

export default function EditorCard({
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
    <section className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow hover:shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 mb-5">
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="w-7 h-7 rounded-full bg-ringo-indigo/10 flex items-center justify-center shrink-0">
            <Icon size={14} className="text-ringo-indigo" />
          </span>
          <h2 className="text-sm font-medium text-ringo-text tracking-[-0.01em]">{title}</h2>
        </div>
        {action && <div className="flex items-center gap-2 flex-wrap">{action}</div>}
      </div>
      {children}
    </section>
  );
}