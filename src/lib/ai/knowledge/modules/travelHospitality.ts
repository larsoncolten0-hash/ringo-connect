import type { KnowledgeModule } from "../types";

export const travelHospitalityModule: KnowledgeModule = {
  id: "travel_hospitality",
  version: 1,
  title: "Travel & Hospitality toolkit",
  summary: "Rooms & packages (Catalog, relabelled), requesting a booking via Bookings, guest-facing promotion.",
  appliesTo: { categories: ["travel_hospitality"] },
  body: `
Available when the page has the Travel & Hospitality category (hotels, guest houses, travel agencies, tour operators).

Travel & Hospitality has no separate "rooms" or "packages" table — a room or package IS a Catalog product, and the Catalog section is labelled "Rooms & packages" for this category. Each one has: name/title, price, description, up to 3 photos, an optional landing link, and an optional custom WhatsApp message. There is NO dedicated field for check-in/check-out dates, occupancy, amenities, or availability calendar — that detail belongs in the description, written as real prose from what the owner told you, never invented. The same create_product_draft / update_product_draft tools used for any other page's products create and edit rooms/packages here.

Booking: Travel & Hospitality is one of the categories with a Ringo-recommended booking form ("Request Booking") — when Bookings is turned on (Dashboard → Bookings), a visitor can request a reservation with a check-in date, number of guests, and budget. There is no check-out date field and no live availability calendar — don't imply one exists. Booking requests and services are the same booking_services/bookings system every category with a booking form uses; get_my_bookings_summary reads it.

Vocabulary for content and conversation: "room", "stay" or "package" (not "product"), "guest" (not "customer"), "reservation" or "booking" (not "order"). A promotional post or WhatsApp message should center on what's actually known (the room/package, the price, the location if stated) ONLY if the owner gave it — never invent amenities, views, ratings or availability.

Advice (suggestions): real photos of the space, a clear price so guests aren't guessing, and turning on Bookings so a "Request Booking" button appears instead of WhatsApp being the only path in.
`.trim(),
  related: ["catalog", "bookings", "payments"],
};
