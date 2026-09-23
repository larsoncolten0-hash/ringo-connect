import type { KnowledgeModule } from "../types";

export const constructionHomeServicesModule: KnowledgeModule = {
  id: "construction_home_services",
  version: 1,
  title: "Construction & Home Services toolkit",
  summary: "Services (Catalog, relabelled), requesting a quote via Bookings, client-facing promotion.",
  appliesTo: { categories: ["construction_home_services"] },
  body: `
Available when the page has the Construction & Home Services category (contractors, architects, plumbers, electricians, painters).

Construction & Home Services has no separate "services" table — a service IS a Catalog product, and the Catalog section is labelled "Services" for this category. Each one has: name/title, price, description, up to 3 photos, an optional landing link, and an optional custom WhatsApp message. There is NO dedicated field for coverage area, licensing, warranty, or materials — that detail belongs in the description, written as real prose from what the owner told you, never invented. A price here is usually a starting price or "from" price, not a fixed quote — don't imply otherwise unless the owner said so. The same create_product_draft / update_product_draft tools used for any other page's products create and edit services here.

Booking: Construction & Home Services is one of the categories with a Ringo-recommended booking form, but it's framed as a quote request ("Request a Quote") rather than an appointment — the fields are a preferred date, location and budget, with no time field. When Bookings is turned on (Dashboard → Bookings), a visitor can request a quote this way. Booking requests and services are the same booking_services/bookings system every category with a booking form uses; get_my_bookings_summary reads it.

Vocabulary for content and conversation: "service" or "project" (not "product"), "client" or "customer" as the owner refers to them, "quote" or "estimate" (matches the booking form's own framing — not "order"). A promotional post or WhatsApp message should center on what's actually known (the service, a starting price if stated) ONLY if the owner gave it — never invent a warranty, licensing, materials used or a fixed price.

Advice (suggestions): real photos of completed work (not stock images), a clear starting price where the owner is comfortable sharing one, and turning on Bookings so a "Request a Quote" button appears instead of WhatsApp being the only path in.
`.trim(),
  related: ["catalog", "bookings", "payments"],
};
