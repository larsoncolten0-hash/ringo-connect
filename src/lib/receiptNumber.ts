// Human-readable receipt/order numbers — both derived from the SAME
// underlying value (music_orders.order_number, a bigserial already unique
// and sequential — see 2026-09-16_music_commerce.sql) rather than a second
// numbering sequence. A receipt and its order are, in this schema, always
// a 1:1 pair anyway (one music_orders row IS the purchase), so there is no
// real second identity to mint — just two conventional prefixes for two
// different audiences reading the same number: "RC-" on the premium
// receipt/PDF/email (a payment record), "ORD-" wherever the order itself
// is referenced (the confirmation screen, the artist's dashboard). Kept
// distinguishable by prefix/label exactly as the spec's example receipt
// shows, without a migration or a second counter to ever drift out of
// sync with the order it describes.
export function formatOrderNumber(orderNumber: number): string {
  return `ORD-${String(orderNumber).padStart(6, "0")}`;
}

export function formatReceiptNumber(orderNumber: number): string {
  return `RC-${String(orderNumber).padStart(6, "0")}`;
}
