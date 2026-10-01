// Phase 2 invariant, enforced at the one Phase 1 entry point that could break it:
//
//     invoice payment recorded  =>  its bookkeeping entry exists
//
// The generic bookkeeping void route must not be able to void an entry that was created by a seller-recorded invoice payment
// (that would leave "payment still recorded + entry voided"). The controlled way to void such a payment AND its entry together is the
// Phase 2 function doc_void_payment. Entries unrelated to invoice payments are unaffected.
//
// Result semantics (fail closed where it matters):
//   "yes"      the entry is referenced by bk_document_payments            -> the manual void must be refused
//   "no"       it is not referenced, OR the Phase 2 table does not exist yet (Phase 2 not applied: nothing can be linked)
//   "unknown"  any other error while checking                              -> the caller must refuse rather than guess
export type InvoicePaymentLink = "yes" | "no" | "unknown";

const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

export async function entryIsInvoicePayment(db: { from: (table: string) => any }, entryId: string): Promise<InvoicePaymentLink> {
  try {
    const { data, error } = await db.from("bk_document_payments").select("id").eq("bk_entry_id", entryId).limit(1);
    if (error) {
      const code = String((error as any).code || "");
      const message = String((error as any).message || "");
      if (MISSING_TABLE_CODES.has(code) || /could not find the table|relation .* does not exist/i.test(message)) return "no";
      return "unknown";
    }
    return Array.isArray(data) && data.length > 0 ? "yes" : "no";
  } catch {
    return "unknown";
  }
}
