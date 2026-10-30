// The Shop order statuses (the product_orders check constraint), in display order. Pure: safe in the browser and on the server.
export const ORDER_STATUSES = ["awaiting_payment", "paid", "fulfilled", "cancelled", "expired", "refunded", "payment_review"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
