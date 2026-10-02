import { redirect } from "next/navigation";

// Bookkeeping moved out of Reports to /dashboard/bookkeeping; this keeps old bookmarks and links working.
export default function LegacyBookkeepingEntriesPage() {
  redirect("/dashboard/bookkeeping");
}
