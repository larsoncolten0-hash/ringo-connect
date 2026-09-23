import type { KnowledgeModule } from "../types";

export const transportLogisticsModule: KnowledgeModule = {
  id: "transport_logistics",
  version: 1,
  title: "Transport & Logistics toolkit",
  summary: "Routes & services (Catalog, relabelled), booking a trip/delivery via Bookings, promotion.",
  appliesTo: { categories: ["transport_logistics"] },
  body: `
Available when the page has the Transport & Logistics category (bus agencies, taxis, delivery, freight, movers).

Transport & Logistics has no separate "routes" table — a route or service IS a Catalog product, and the Catalog section is relabelled "Routes & services" for this category. Each one has: name/title (e.g. a route or service name), price, description, up to 3 photos, an optional landing link, and an optional custom WhatsApp message. There is NO dedicated field for origin/destination, schedule, vehicle type or capacity — that detail belongs in the description, written as real prose from what the owner told you, never invented. The same create_product_draft / update_product_draft tools used for any other page's products create and edit routes/services here.

Booking: Transport & Logistics is one of the categories with a Ringo-recommended booking form ("Book a Trip") — when Bookings is turned on (Dashboard → Bookings), visitors can request a booking with a date, time and pickup/destination. Booking requests and services are the same booking_services/bookings system every category with a booking form uses; get_my_bookings_summary reads it.

Vocabulary for content and conversation: "route" or "service" (not "product"), "trip" or "delivery" (not "order"), "passenger/customer enquiry". A promotional post or WhatsApp message should center on what's actually known (route, price, schedule) ONLY if the owner gave it — never invent departure times, capacity, vehicle type or coverage area.

Advice (suggestions): a clear price per route/service so customers aren't guessing, a description that states the route or service scope plainly, and turning on Bookings so a "Book a Trip" button appears instead of WhatsApp being the only path in.
`.trim(),
  related: ["catalog", "bookings", "payments"],
};
