"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Link2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import LinkCustomerModal from "./LinkCustomerModal";
import ReminderModal from "./ReminderModal";
import { callApi, secondaryButton } from "./shared";

/**
 * On an invoice's own page: which contact it is linked to, and (while an Amount Due remains) the manual reminder. Renders nothing at all if
 * the Phase 3 API is not available, so the invoice page behaves exactly as before. It never changes the invoice.
 */
export default function InvoiceCustomerSection({ documentId, number, open, snapshot }: {
  documentId: string; number: string | null; open: boolean; snapshot: { name?: string | null; phone?: string | null; email?: string | null };
}) {
  const { t } = useLanguage();
  const r = t.receivables.ui;
  const [state, setState] = useState<"loading" | "off" | "ready">("loading");
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [linking, setLinking] = useState(false);
  const [reminding, setReminding] = useState(false);

  const load = useCallback(async () => {
    const res = await callApi("GET", `/api/receivables/documents/${encodeURIComponent(documentId)}/customer`);
    if (!res.ok) return setState("off");
    setCustomer(res.data.customer ? { id: res.data.customer.id, name: res.data.customer.name } : null);
    setState("ready");
  }, [documentId]);
  useEffect(() => { load(); }, [load]);

  if (state !== "ready") return null;
  return (
    <section className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 sm:p-5 flex flex-col gap-3">
      <h2 className="text-sm font-medium text-ringo-text">{r.sectionTitle}</h2>
      <p className="text-sm text-ringo-muted">{customer ? r.sectionLinked(customer.name) : r.unlinked}</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setLinking(true)} className={secondaryButton}><Link2 size={15} />{customer ? r.changeCustomer : r.linkCustomer}</button>
        {open && <button onClick={() => setReminding(true)} className={secondaryButton}><BellRing size={15} />{r.remind}</button>}
      </div>
      {linking && <LinkCustomerModal documentId={documentId} currentName={customer?.name ?? null} invoiceCustomer={snapshot} onClose={() => setLinking(false)} onDone={load} />}
      {reminding && <ReminderModal target={{ id: documentId, number, hasEmail: !!snapshot.email, hasPhone: !!snapshot.phone }} onClose={() => setReminding(false)} onDone={() => {}} />}
    </section>
  );
}
