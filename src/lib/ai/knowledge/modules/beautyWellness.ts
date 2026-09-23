import type { KnowledgeModule } from "../types";

export const beautyWellnessModule: KnowledgeModule = {
  id: "beauty_wellness",
  version: 1,
  title: "Beauty & Wellness toolkit",
  summary: "Services (Catalog, relabelled), booking an appointment via Bookings, client-facing promotion.",
  appliesTo: { categories: ["beauty_wellness"] },
  body: `
Available when the page has the Beauty & Wellness category (salons, barbers, nail techs, makeup artists, spas).

Beauty & Wellness has no separate "services" table — a service IS a Catalog product, and the Catalog section is labelled "Services" for this category. Each one has: name/title, price, description, up to 3 photos, an optional landing link, and an optional custom WhatsApp message. There is NO dedicated field for duration, what's included, or products/brands used — that detail belongs in the description, written as real prose from what the owner told you, never invented (never claim a technique, product brand, or result the owner didn't state). The same create_product_draft / update_product_draft tools used for any other page's products create and edit services here.

Booking: Beauty & Wellness is one of the categories with a Ringo-recommended booking form ("Book Appointment") — when Bookings is turned on (Dashboard → Bookings), a visitor can request an appointment with a preferred date and time. Booking requests and services are the same booking_services/bookings system every category with a booking form uses; get_my_bookings_summary reads it.

Vocabulary for content and conversation: "service" (not "product"), "client" (not "customer"), "appointment" (not "order"). A promotional post or WhatsApp message should center on what's actually known (the service, the price) ONLY if the owner gave it — never invent a technique, ingredient, product brand, treatment duration or result.

Advice (suggestions): real photos of the work (not stock images), a clear price on each service so clients aren't guessing, and turning on Bookings so a "Book Appointment" button appears instead of WhatsApp being the only path in.
`.trim(),
  related: ["catalog", "bookings", "payments"],
};
