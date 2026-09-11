// Shared between the Subscribers and Announcements dashboard views — same
// role bookingStatus.ts plays for the booking system.
export const SUBSCRIBER_STATUS_COLOR: Record<string, string> = {
  active: "bg-ringo-teal/10 text-ringo-teal",
  unsubscribed: "bg-ringo-muted/10 text-ringo-muted",
  removed: "bg-red-500/10 text-red-500",
};

export const ANNOUNCEMENT_STATUS_COLOR: Record<string, string> = {
  draft: "bg-ringo-muted/10 text-ringo-muted",
  sending: "bg-ringo-indigo/10 text-ringo-indigo",
  sent: "bg-ringo-teal/10 text-ringo-teal",
  failed: "bg-red-500/10 text-red-500",
};
