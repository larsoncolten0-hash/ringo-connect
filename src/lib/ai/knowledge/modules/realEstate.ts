import type { KnowledgeModule } from "../types";

export const realEstateModule: KnowledgeModule = {
  id: "real_estate",
  version: 1,
  title: "Real Estate toolkit",
  summary: "Listings (Catalog, relabelled), property vocabulary, viewing requests via Bookings, promotion.",
  appliesTo: { categories: ["real_estate"] },
  body: `
Available when the page has the Real Estate category (agencies, property owners, agents, developers).

Real Estate has no separate "listings" table — a listing IS a Catalog product, and the Catalog section is relabelled "Listings" for this category. Each listing has: name/title, price, description, up to 3 photos, an optional landing link (e.g. a virtual tour or a fuller listing elsewhere), and an optional custom WhatsApp message. There is NO dedicated field for property type, bedrooms, bathrooms, land/property size, sale-vs-rent, or location — that detail belongs in the description, written as real prose from what the owner told you, never invented. The same create_product_draft / update_product_draft tools used for any other page's products create and edit listings here.

Booking: Real Estate is one of the categories with a Ringo-recommended booking form ("Request Viewing") — when Bookings is turned on (Dashboard → Bookings), visitors can request a viewing with a preferred date, time and which listing. Booking requests and services are the same booking_services/bookings system every category with a booking form uses; get_my_bookings_summary reads it.

Vocabulary for content and conversation: "listing" (not "product"), "viewing" (not "order"), "buyer/renter enquiry" (not "customer"). A promotional post or WhatsApp message for a listing should center on what's actually known (price, location, room counts, size) ONLY if the owner gave it — never invent square footage, room counts, amenities or condition.

Advice (suggestions): real photos of the property (not stock images), a price on every listing so buyers/renters aren't guessing, a description that states property type and location plainly, and turning on Bookings so a "Request Viewing" button appears instead of WhatsApp being the only path in.
`.trim(),
  related: ["catalog", "bookings", "payments"],
};
