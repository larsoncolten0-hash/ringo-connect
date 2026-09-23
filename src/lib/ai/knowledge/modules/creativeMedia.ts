import type { KnowledgeModule } from "../types";

export const creativeMediaModule: KnowledgeModule = {
  id: "creative_media",
  version: 1,
  title: "Creative & Media toolkit",
  summary: "Portfolio & services (Catalog, relabelled), booking a session via Bookings, client-facing promotion.",
  appliesTo: { categories: ["creative_media"] },
  body: `
Available when the page has the Creative & Media category (photographers, videographers, designers, studios).

Creative & Media has no separate "portfolio" or "projects" table — a portfolio piece or bookable service IS a Catalog product, and the Catalog section is labelled "Portfolio & services" for this category. Each one has: name/title, price, description, up to 3 photos, an optional landing link, and an optional custom WhatsApp message. There is NO dedicated field for turnaround time, deliverables, or licensing terms — that detail belongs in the description, written as real prose from what the owner told you, never invented. The same create_product_draft / update_product_draft tools used for any other page's products create and edit portfolio/service entries here.

Booking: Creative & Media is one of the categories with a Ringo-recommended booking form ("Book a Photoshoot") — when Bookings is turned on (Dashboard → Bookings), a visitor can request a session with a preferred date, time, location, number of people and budget. Booking requests and services are the same booking_services/bookings system every category with a booking form uses; get_my_bookings_summary reads it.

Vocabulary for content and conversation: "project" or "commission" for client work, "service" for a bookable offering (not "product"), "client" (not "customer"). A promotional post or WhatsApp message should center on what's actually known (the service, the price if stated) ONLY if the owner gave it — never invent equipment, style, past clients or results.

Advice (suggestions): real work samples as photos (not stock images), a clear price where the owner is comfortable sharing one, and turning on Bookings so a "Book a Photoshoot" button appears instead of WhatsApp being the only path in.
`.trim(),
  related: ["catalog", "bookings", "payments"],
};
