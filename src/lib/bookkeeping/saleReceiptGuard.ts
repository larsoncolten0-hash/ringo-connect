// Record Sale invariant, the sibling of invoicePaymentGuard.ts:
//
//     a recorded sale has a receipt  =>  its ONE bookkeeping sale entry is never voided or replaced on its own
//
// A Record Sale receipt points at its bookkeeping entry (bk_documents.source_type = 'sale', source_id = the entry). Voiding or replacing that entry through the
// generic bookkeeping paths would leave the receipt standing with no sale behind it, so those paths refuse. Ordinary manual entries are unaffected.
//
// Result semantics (fail closed where it matters):
//   "yes"      a live sale receipt references the entry     -> refuse the void / replacement
//   "no"       none does, OR Record Sale is not installed yet (the table or column does not exist: nothing can be linked)
//   "unknown"  any other error while checking                -> the caller must refuse rather than guess
export type SaleReceiptLink = "yes" | "no" | "unknown";

const MISSING_CODES = new Set(["42P01", "42703", "PGRST205", "PGRST204"]);

export async function entryIsSaleReceipt(db: { from: (table: string) => any }, entryId: string): Promise<SaleReceiptLink> {
  try {
    const { data, error } = await db.from("bk_documents").select("id, status").eq("source_type", "sale").eq("source_id", entryId).limit(5);
    if (error) {
      const code = String((error as any).code || "");
      const message = String((error as any).message || "");
      if (MISSING_CODES.has(code) || /could not find the (table|column)|does not exist/i.test(message)) return "no";
      return "unknown";
    }
    return Array.isArray(data) && data.some((d: any) => d?.status !== "void") ? "yes" : "no";
  } catch {
    return "unknown";
  }
}
