import type { KnowledgeModule } from "../types";

export const professionalServicesModule: KnowledgeModule = {
  id: "professional_services",
  version: 1,
  title: "Professional Services toolkit",
  summary: "Services (Catalog, relabelled), booking a consultation via Bookings, client-facing promotion.",
  appliesTo: { categories: ["professional_services"] },
  body: `
Available when the page has the Professional Services category (consultants, lawyers, accountants, designers, photographers, agencies, coaches, freelancers, IT, and similar).

Professional Services has no separate "services" table — a service offering IS a Catalog product, and the Catalog section is labelled "Services" for this category. Each one has: name/title, price, description, up to 3 photos, an optional landing link, and an optional custom WhatsApp message. There is NO dedicated field for scope, deliverables, duration or credentials — that detail belongs in the description, written as real prose from what the owner told you, never invented (never claim a certification, years of experience or qualification the owner didn't state). The same create_product_draft / update_product_draft tools used for any other page's products create and edit service offerings here.

Booking: Professional Services is one of the categories with a Ringo-recommended booking form ("Book Consultation") — when Bookings is turned on (Dashboard → Bookings), a visitor can request an appointment with a preferred date and time. Booking requests and services are the same booking_services/bookings system every category with a booking form uses; get_my_bookings_summary reads it.

Vocabulary for content and conversation: "service" (not "product"), "client" (not "customer"), "consultation/appointment" (not "order"). Tone should read as professional and trustworthy rather than sales-y — a promotional post or WhatsApp message should center on what's actually known (the service, the price, what's included) ONLY if the owner gave it — never invent outcomes, guarantees or client results.

Advice (suggestions): a clear price or "starting from" price on each service so clients aren't guessing, a description that states what's actually included, and turning on Bookings so a "Book Consultation" button appears instead of WhatsApp being the only path in.
`.trim(),
  related: ["catalog", "bookings", "payments"],
};
