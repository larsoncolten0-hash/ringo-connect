import GuestOrderTrackingView from "@/components/restaurant/GuestOrderTrackingView";

export const dynamic = "force-dynamic";

// Public, unauthenticated — same "the id itself is the access control"
// pattern as GET /api/orders/[id] (which this page's client component
// polls). This is the page a guest restaurant customer's push
// notification (see /api/push/send.ts's sendPushToOrderWatcher calls)
// actually points at — before this route existed, order tracking only
// lived in RestaurantOrderPage's in-memory confirmation step, which had
// no URL of its own to deep-link back to (see the notifications
// implementation plan's PART 15). No server-side data fetching here on
// purpose: the component below does the exact same GET /api/orders/[id]
// call RestaurantOrderPage's own confirmation step already polls with, so
// a guest landing here fresh (from a notification, a bookmark, or a
// second visit) sees live data with no extra route to keep in sync.
export default function OrderTrackingPage({ params }: { params: { id: string } }) {
  return <GuestOrderTrackingView orderId={params.id} />;
}
