import { type LucideIcon } from "lucide-react";

// A small, consistent "nothing here yet" block for editor cards — used in
// place of a plain line of muted text so an empty list still looks
// intentional rather than like a gap in the page.
export default function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-8 px-4 rounded-2xl border border-dashed border-ringo-border bg-ringo-muted/[0.04]">
      <span className="w-10 h-10 rounded-full bg-ringo-indigo/10 flex items-center justify-center">
        <Icon size={17} className="text-ringo-indigo" strokeWidth={2.25} />
      </span>
      <p className="text-sm font-medium text-ringo-text">{title}</p>
      {hint && <p className="text-xs text-ringo-muted max-w-[280px] leading-relaxed">{hint}</p>}
    </div>
  );
}
