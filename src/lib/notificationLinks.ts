// Centralized notification deep-link targets — every push/in-app
// notification that points at a specific resource builds its URL here
// instead of hardcoding a route string at the write site. One place to
// change a route, and one place future modules (real estate inquiries,
// delivery updates, quote requests, ...) add a link builder to instead of
// inventing their own navigation convention.
//
// Deliberately NOT a single generic `buildDeepLink(type, id)` dispatcher —
// each resource needs different params (a plain id; an id plus username;
// an id plus which dashboard section owns it) and Next.js's own route
// structure already encodes "where a resource type lives," so a named
// function per resource type is both simpler and impossible to misroute.
// This mirrors the one-function-per-audience shape src/lib/push/send.ts
// already uses for the sending side.
//
// `withArrivalRef` appends a lightweight marker (see
// src/components/HighlightOnArrival.tsx) so a page reached via a
// notification can briefly highlight the exact item that generated it —
// purely cosmetic, never used for access control.
function withArrivalRef(path: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}ref=push`;
}

// ---------------------------------------------------------------------
// Business-owner destinations (authenticated dashboard) — auth/ownership
// is always re-verified server-side when the page loads (see each page's
// requireOwnProfile/requireRestaurantProfile/requireTicketingProfile
// call); the link itself is only ever a pointer, never a credential.
// ---------------------------------------------------------------------

export function dashboardOrderLink(orderId: string): string {
  return withArrivalRef(`/dashboard/restaurant/orders/${orderId}`);
}

export function dashboardBookingLink(bookingId: string): string {
  return withArrivalRef(`/dashboard/bookings/${bookingId}`);
}

export function dashboardMusicOrderLink(orderId: string): string {
  return withArrivalRef(`/dashboard/music/orders/${orderId}`);
}

export function dashboardSubscriberLink(subscriberId: string): string {
  return withArrivalRef(`/dashboard/community/subscribers/${subscriberId}`);
}

// ---------------------------------------------------------------------
// Guest/customer destinations — no account, secured by an unguessable id
// the same way GET /api/orders/[id] already is (see that route's own
// comment on why the id itself is the access control).
// ---------------------------------------------------------------------

export function guestOrderTrackingLink(orderId: string): string {
  return `/order/${orderId}`;
}
