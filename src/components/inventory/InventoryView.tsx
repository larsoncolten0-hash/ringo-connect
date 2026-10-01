"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { INVENTORY_FILTERS } from "@/lib/inventory/constants";
import { StateBadge, callApi, primaryButton, secondaryButton, useInvErrorText, useMoney } from "./shared";

type Item = { product_id: string; name: string; available: boolean; state: string; tracked: boolean; count: number | null; low_stock_threshold: number | null; reserved: number; sold_units: number; sku: string | null; estimated_value_minor: number | null; drift: number };
type Overview = { profile_currency: string; total: number; summary: { tracked: number; out: number; low: number; ok: number; legacy: number; untracked: number; estimated_value_minor: number; value_excluded: number; drift: number }; items: Item[] };
const PAGE = 50;

/** Overview of physical products: status, on hand, Reserved (held by unpaid Shop orders) and Sold (paid) kept apart. Read-only. */
export default function InventoryView() {
  const { t } = useLanguage();
  const u = t.inventory.ui;
  const errorText = useInvErrorText();
  const fmt = useMoney();
  const [filter, setFilter] = useState<string>("");
  const [data, setData] = useState<Overview | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (offset: number) => {
    setBusy(true);
    const res = await callApi("GET", `/api/inventory?limit=${PAGE}&offset=${offset}${filter ? `&filter=${filter}` : ""}`);
    setBusy(false);
    if (!res.ok) return setError(errorText(res.data));
    setError("");
    setData(res.data);
    setItems((prev) => (offset === 0 ? res.data.items : [...prev, ...res.data.items]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);
  useEffect(() => { load(0); }, [load]);

  const filterLabel: Record<string, string> = { "": u.filterAll, tracked: u.filterTracked, low: u.filterLow, out: u.filterOut, ok: u.filterOk, untracked: u.filterUntracked, legacy: u.filterLegacy };
  const s = data?.summary;
  const cards: [string, number][] = s ? [[u.tracked, s.tracked], [u.inStock, s.ok], [u.lowStock, s.low], [u.outOfStock, s.out], [u.legacy, s.legacy]] : [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text">{u.title}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{u.intro}</p>
        <p className="mt-1 text-xs text-ringo-muted">{u.modelNote}</p>
        <p className="mt-1 text-xs text-ringo-muted">{u.separateNote}</p>
      </div>
      {error && <p role="alert" className="rounded-card bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
      {s && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {cards.map(([label, n]) => (
              <div key={label} className="rounded-card border border-ringo-border p-3">
                <p className="text-xs text-ringo-muted">{label}</p>
                <p className="mt-1 text-xl font-medium text-ringo-text">{n}</p>
              </div>
            ))}
          </div>
          {s.tracked > 0 && (
            <div className="rounded-card border border-ringo-border p-3">
              <p className="text-xs text-ringo-muted">{u.estimatedValue}</p>
              <p className="mt-1 text-lg font-medium text-ringo-text">{fmt.money(s.estimated_value_minor, data!.profile_currency)}</p>
              <p className="mt-1 text-xs text-ringo-muted">{u.estimateNote(data!.profile_currency)}</p>
              {s.value_excluded > 0 && <p className="mt-1 text-xs text-ringo-muted">{u.valueExcluded(s.value_excluded)}</p>}
            </div>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {["", ...INVENTORY_FILTERS].map((f) => (
          <button key={f || "all"} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`${filter === f ? primaryButton : secondaryButton} !min-h-[36px] !px-3 !py-1 text-xs`}>{filterLabel[f]}</button>
        ))}
      </div>
      {!data && busy && <p className="flex items-center gap-2 text-sm text-ringo-muted"><Loader2 size={14} className="animate-spin" />{u.loading}</p>}
      {data && items.length === 0 && <p className="text-sm text-ringo-muted">{u.empty}</p>}
      <ul className="flex flex-col gap-2">
        {items.map((i) => (
          <li key={i.product_id}>
            <Link href={`/dashboard/inventory/${i.product_id}`} className="flex flex-col gap-2 rounded-card border border-ringo-border p-3 transition hover:bg-ringo-muted/5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ringo-text">{i.name}</p>
                {i.sku && <p className="text-xs text-ringo-muted">{u.sku}: {i.sku}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ringo-muted">
                <StateBadge state={i.state} />
                <span>{u.onHand}: <b className="text-ringo-text">{i.count === null ? u.unlimited : i.count}</b></span>
                {i.tracked && <span>{u.reserved}: <b className="text-ringo-text">{i.reserved}</b></span>}
                {i.tracked && <span>{u.sold}: <b className="text-ringo-text">{i.sold_units}</b></span>}
                {i.tracked && i.estimated_value_minor !== null && <span>{u.value}: {fmt.money(i.estimated_value_minor, data!.profile_currency)}</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {data && items.length < data.total && <button className={secondaryButton} disabled={busy} onClick={() => load(items.length)}>{u.loadMore}</button>}
    </div>
  );
}
