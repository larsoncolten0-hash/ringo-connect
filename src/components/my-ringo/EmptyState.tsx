import type { LucideIcon } from "lucide-react";

export default function EmptyState({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ringo-border bg-ringo-surface px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ringo-indigo/10 text-ringo-indigo">
        <Icon size={22} />
      </span>
      <p className="text-base font-semibold text-ringo-text">{title}</p>
      {body && <p className="max-w-sm text-sm text-ringo-muted">{body}</p>}
    </div>
  );
}
