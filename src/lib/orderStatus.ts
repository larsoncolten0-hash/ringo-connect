// Shared order-lifecycle logic between the Orders and Kitchen dashboard
// views. Dine-in passes through "served" (a waiter physically bringing
// food to a table); takeaway/delivery skip straight from "ready" to
// "completed" — there's no one to "serve" a takeaway bag to.
export type OrderStatus = "pending" | "accepted" | "preparing" | "ready" | "served" | "completed" | "cancelled" | "refunded";

export function nextStatus(current: OrderStatus, orderType: string): OrderStatus | null {
  switch (current) {
    case "pending":
      return "accepted";
    case "accepted":
      return "preparing";
    case "preparing":
      return "ready";
    case "ready":
      return orderType === "dine_in" ? "served" : "completed";
    case "served":
      return "completed";
    default:
      return null;
  }
}

export const STATUS_COLOR: Record<string, string> = {
  pending: "bg-ringo-indigo/10 text-ringo-indigo",
  accepted: "bg-ringo-indigo/10 text-ringo-indigo",
  preparing: "bg-amber-500/10 text-amber-600",
  ready: "bg-ringo-teal/10 text-ringo-teal",
  served: "bg-ringo-teal/10 text-ringo-teal",
  completed: "bg-ringo-teal/10 text-ringo-teal",
  cancelled: "bg-red-500/10 text-red-500",
  refunded: "bg-red-500/10 text-red-500",
};
