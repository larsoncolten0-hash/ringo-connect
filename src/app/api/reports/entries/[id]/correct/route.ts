import { correctEntry } from "@/lib/corrections/entries";
import { readJson, withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only. Corrects ONE of the caller's own bookkeeping entries through the existing bk_record_entry replace mechanism: the original is voided and kept,
// the replacement becomes the active entry. The kind and any order link are taken from the original on the server; invoice-payment entries are refused
// (they are corrected through the invoice workflow). The business is the caller's own profile and a profile id in the body is never read.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return withOwner(async (owner) => correctEntry(owner, params.id, await readJson(request)));
}
