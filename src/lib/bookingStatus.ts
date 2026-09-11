// Shared between BookingsList and BookingDetail — same role orderStatus.ts
// plays for restaurant orders.
export type BookingStatus = "pending" | "confirmed" | "declined" | "cancelled" | "completed";

export const BOOKING_STATUS_COLOR: Record<string, string> = {
  pending: "bg-ringo-indigo/10 text-ringo-indigo",
  confirmed: "bg-ringo-teal/10 text-ringo-teal",
  completed: "bg-ringo-teal/10 text-ringo-teal",
  declined: "bg-red-500/10 text-red-500",
  cancelled: "bg-red-500/10 text-red-500",
};

// Which actions make sense from the current status — pending can go either
// way, confirmed can only move forward to completed or be cancelled;
// declined/cancelled/completed are terminal (no history-erasing "undo").
export function availableActions(status: BookingStatus): { action: BookingStatus; primary?: boolean }[] {
  switch (status) {
    case "pending":
      return [{ action: "confirmed", primary: true }, { action: "declined" }];
    case "confirmed":
      return [{ action: "completed", primary: true }, { action: "cancelled" }];
    default:
      return [];
  }
}
