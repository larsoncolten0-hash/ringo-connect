import type { LucideIcon } from "lucide-react";
import type { AmbassadorSaleStage } from "@/lib/ambassador/stage";

// Shared presentation for the Ambassador and Team Leader dashboards (both were drawing the same tiles and stage chips from their own copies).
// Purely visual: every figure arrives already formatted from the server-resolved overview; nothing here computes, fetches or writes.

export const STAGE_STYLES: Record<AmbassadorSaleStage, string> = {
  payment_pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  payment_confirmed: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  profile_incomplete: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  profile_complete: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  fully_activated: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  disputed: "bg-ringo-coral/10 text-ringo-coral",
  voided: "bg-ringo-muted/10 text-ringo-muted",
  refunded: "bg-ringo-coral/10 text-ringo-coral",
};

/** The one figure that matters most (what the person has earned), with the two that follow from it (ready to pay out, already paid). */
export function EarningsHero({ label, value, items }: { label: string; value: string; items: { label: string; value: string }[] }) {
  return (
    <section aria-label={label} className="flex flex-col gap-4 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-5">
      <div>
        <p className="text-xs text-ringo-muted">{label}</p>
        <p className="mt-1 font-display text-3xl font-semibold tabular-nums tracking-[-0.01em] text-ringo-text">{value}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t border-ringo-border/60 pt-4">
        {items.map((it) => (
          <div key={it.label} className="min-w-0">
            <dt className="text-xs text-ringo-muted">{it.label}</dt>
            <dd className="text-base font-medium tabular-nums text-ringo-text">{it.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function StatTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4">
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-xl bg-ringo-indigo/10">
        <Icon size={15} className="text-ringo-indigo" strokeWidth={2.25} />
      </span>
      <p className="text-xs text-ringo-muted">{label}</p>
      <p className="text-base sm:text-lg font-semibold tabular-nums tracking-[-0.01em] text-ringo-text">{value}</p>
    </div>
  );
}

export function StageChip({ stage, label }: { stage: AmbassadorSaleStage; label: string }) {
  return <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${STAGE_STYLES[stage]}`}>{label}</span>;
}
