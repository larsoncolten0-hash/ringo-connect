"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { callApi, secondaryButton, useCustErrorText, useFormatters } from "./shared";

type Order = {
  id: string; order_number: number | string | null; status: string; created_at: string; paid_at: string | null; total_minor: number | null; currency: string;
  buyer_name: string | null; basis: string; warnings: string[];
};
type Result = {
  status: "ok" | "no_contact_key"; items: Order[]; total_matches: number; shown: number; phone_scanned: boolean; scanned_orders: number; window_full: boolean;
  contact_key_shared_with_active: boolean; contact_key_shared_with_archived: boolean; shared_phone_names: boolean; shared_email_names: boolean; ambiguous: boolean;
};

/** Shop orders that share a normalised phone/email with this customer. SUGGESTIONS ONLY: loaded on request, never stored, never linked, never in a total. */
export default function PossibleOrders({ customerId }: { customerId: string }) {
  const { t } = useLanguage();
  const m = t.customers.match;
  const errorText = useCustErrorText();
  const f = useFormatters();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [data, setData] = useState<Result | null>(null);
  const [errorData, setErrorData] = useState<any>(null);
  const error = errorData ? errorText(errorData) : "";

  const load = async () => {
    setState("loading");
    setErrorData(null);
    const res = await callApi("GET", `/api/customers/${encodeURIComponent(customerId)}/possible-orders`);
    if (!res.ok) { setErrorData(res.data); return setState("error"); }
    setData(res.data);
    setState("done");
  };

  return (
    <section className="flex flex-col gap-3 rounded-card border border-ringo-border p-4" aria-labelledby="possible-orders-title">
      <h2 id="possible-orders-title" className="font-display text-base font-medium text-ringo-text">{m.title}</h2>
      <p className="text-xs leading-snug text-ringo-muted">{m.intro}</p>
      {state === "idle" && <div><button className={secondaryButton} onClick={load}>{m.show}</button></div>}
      {state === "loading" && <p className="flex items-center gap-2 text-sm text-ringo-muted"><Loader2 size={14} className="animate-spin" />{m.loading}</p>}
      {state === "error" && (
        <div role="alert" className="flex flex-col gap-2 rounded-card bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">
          <p>{error}</p>
          <div><button className={secondaryButton} onClick={load}>{m.retry}</button></div>
        </div>
      )}
      {state === "done" && data && (
        data.status === "no_contact_key" ? <p className="text-sm text-ringo-muted">{m.noKey}</p> : (
          <>
            {data.phone_scanned && data.window_full && <p className="rounded-card bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">{m.windowIncomplete(data.scanned_orders)}</p>}
            {data.contact_key_shared_with_active && <p className="rounded-card bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">{m.keyShared}</p>}
            {data.contact_key_shared_with_archived && <p className="rounded-card bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">{m.keySharedArchived}</p>}
            {data.ambiguous && <p className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{m.ambiguousSummary}</p>}
            {data.items.length === 0 ? <p className="text-sm text-ringo-muted">{m.none}</p> : (
              <>
                <ul className="flex flex-col gap-2">
                  {data.items.map((o) => (
                    <li key={o.id} className="flex flex-col gap-1 rounded-card border border-ringo-border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-ringo-text">{m.order(`#${o.order_number ?? ""}`)}</span>
                        <span className="whitespace-nowrap text-ringo-text">{o.total_minor === null ? "?" : f.money(o.total_minor, o.currency)}</span>
                      </div>
                      <p className="text-xs text-ringo-muted">{f.when(o.created_at)} · {m.statuses[o.status] ?? o.status} · {m.basis[o.basis] ?? o.basis}</p>
                      {o.buyer_name && <p className="text-xs text-ringo-muted">{m.buyer(o.buyer_name)}</p>}
                      {o.warnings.map((w) => <p key={w} className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{m.warnings[w] ?? w}</p>)}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-ringo-muted">{m.shown(data.shown, data.total_matches)}{data.phone_scanned ? ` ${m.scanned(data.scanned_orders)}` : ""}</p>
              </>
            )}
          </>
        )
      )}
    </section>
  );
}
