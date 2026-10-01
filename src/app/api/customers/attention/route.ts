import { customerAttention } from "@/lib/customers/attention";
import { withOwner } from "@/lib/documents/routeKit";

export const dynamic = "force-dynamic";

// Owner-only, READ-ONLY. Customers needing attention, derived at request time from invoices and payments; nothing is stored. The business is the
// caller's own profile and no input comes from the request.
export async function GET() {
  return withOwner((owner) => customerAttention(owner));
}
