// Maps a resolved customer-action destination onto the EXISTING Ringo route that
// handles it. Pure and dependency-free: it only builds a navigation target. The
// destination workflow itself still owns authorization, identity, pricing, stock,
// availability and payment.
//
// Destinations with no existing workflow to send a catalogue product to —
// ticket_flow, quote_form, chat, whatsapp, none — return null,
// so nothing is rendered. There is deliberately NO fallback destination here:
// in particular, an unresolved or unsupported destination never becomes WhatsApp.
//
//   external / external_link  → the item's own link (landing_url)
//   music_storefront          → the music storefront cart handoff (/m/{u}?add=merch:{id})
//   booking_page              → the booking form (/{u}/book)
//   restaurant_order_page     → the restaurant menu/ordering page (/r/{u}); it takes menu
//                               items only, so this opens the page, not a specific product
//   product_checkout          → the generic product checkout (/{u}/item/{id}/checkout); the checkout
//                               backend re-validates everything, this is only the entry point

export interface ActionRoute {
  href: string;
  // true = opens outside Ringo (new tab); false = a Ringo page.
  external: boolean;
}

export function customerActionRoute(
  destination: string,
  ctx: { username: string; productId: string; landingUrl?: string | null }
): ActionRoute | null {
  switch (destination) {
    case "external":
    case "external_link":
      return ctx.landingUrl ? { href: ctx.landingUrl, external: true } : null;
    case "music_storefront":
      return { href: `/m/${ctx.username}?add=merch:${ctx.productId}`, external: false };
    case "booking_page":
      return { href: `/${ctx.username}/book`, external: false };
    case "restaurant_order_page":
      return { href: `/r/${ctx.username}`, external: false };
    case "product_checkout":
      return { href: `/${ctx.username}/item/${ctx.productId}/checkout`, external: false };
    default:
      return null;
  }
}
