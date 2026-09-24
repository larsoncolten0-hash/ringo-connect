// Human-readable numbers for product orders. Distinct from music's ORD-/RC- (receiptNumber.ts is
// untouched): product orders are PO-, their receipts RCP-. Both derive from the one order_number.

const pad = (n: number) => String(Math.max(0, Math.trunc(n))).padStart(6, "0");

export const formatProductOrderNumber = (orderNumber: number): string => `PO-${pad(orderNumber)}`;
export const formatProductReceiptNumber = (orderNumber: number): string => `RCP-${pad(orderNumber)}`;
