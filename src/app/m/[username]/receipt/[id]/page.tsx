import { notFound } from "next/navigation";
import { getMusicReceiptData } from "@/lib/musicReceipt";
import ReceiptPageView from "@/components/music/ReceiptPageView";

export { generateMetadata, generateViewport } from "@/lib/profileMetadata";

// The premium fan-facing receipt for a music/ticket/merch order — the
// "View Receipt" destination linked from MusicStorePage's confirmation
// screen, TicketPassView, and the receipt email. Public and unauthenticated
// by design, same posture as /m/[username]/ticket-pass/[code] and
// /api/music/orders/[id]: a fan has no Ringo account, so the order's own
// unguessable id is the access control (see getMusicReceiptData, which
// re-checks Fapshi the same way every other order-facing route does — a
// fan landing here moments after checkout, before payment has actually
// cleared, sees a live "processing" state that resolves on its own).
export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: { username: string; id: string } }) {
  const data = await getMusicReceiptData(params.id);
  // The username check is defense in depth, not the real access control
  // (see the comment above) — a receipt link copy-pasted onto the wrong
  // artist's URL 404s instead of quietly rendering.
  if (!data || data.artistUsername !== params.username) return notFound();

  return <ReceiptPageView data={data} />;
}
