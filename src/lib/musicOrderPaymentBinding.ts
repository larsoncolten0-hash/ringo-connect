// Is this Fapshi transaction really THE payment for this music order, for this amount?
//
// checkAndConfirmFapshiOrder used to accept ANY successful Fapshi transaction id stored on the order. music_orders is writable by the
// artist ("music_orders owner all" RLS), so an artist could store a real, successful transaction id (their own 100 XAF purchase) on an order
// they invented with any total, or raise the total of an order after paying it, and be credited a sale (and a payable earnings row) that nobody paid.
// The shop and protection checkouts already bind the provider transaction to the order and its amount (provider_amount_mismatch); this is the same rule.
//
// The pay route stamps every transaction it creates with externalId `music-order-<order id>` and userId `<order id>`, and an amount of
// Math.round(order.total). Pure, no I/O.
export const musicOrderExternalId = (orderId: string) => `music-order-${orderId}`;

export function fapshiTxMatchesMusicOrder(
  tx: { externalId?: string | null; userId?: string | null; amount?: number | null } | null | undefined,
  order: { id: string; total: number | string | null | undefined }
): boolean {
  if (!tx || !order?.id) return false;
  const bound =
    tx.externalId === musicOrderExternalId(order.id) || ((tx.externalId === null || tx.externalId === undefined) && tx.userId === order.id);
  if (!bound) return false;
  const paid = typeof tx.amount === "number" ? tx.amount : NaN;
  const owed = Number(order.total);
  if (!Number.isFinite(paid) || !Number.isFinite(owed) || owed <= 0) return false;
  return Math.round(paid) === Math.round(owed);
}
