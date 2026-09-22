import type { KnowledgeModule } from "../types";

export const bookingsModule: KnowledgeModule = {
  id: "bookings",
  version: 1,
  title: "Bookings",
  summary: "Turning bookings on, services, the booking link, handling requests.",
  appliesTo: {},
  body: `
Bookings let visitors send a booking request from the Ringo page. Any category can use them; the form's fields and button text adapt to the category (e.g. "Book Artist" with event date/location/budget for music; party size for restaurants).
- Turn on at Dashboard → Bookings → Settings (/dashboard/bookings/settings). While bookings are off, the booking page and button don't work and requests are refused.
- Settings also hold: button text, a description, optional services (the customer picks one), and a direct booking link to share.
- Requests arrive in Dashboard → Bookings as Pending; the owner can Accept, Decline, Mark completed or Cancel. Customers can opt in to email/WhatsApp updates when they book.

Advice (suggestions): add 2–4 clear services with prices in the description, share the direct booking link in WhatsApp chats, and answer pending requests quickly.
`.trim(),
  related: ["connect", "profiles"],
};
