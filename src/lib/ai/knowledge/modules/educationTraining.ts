import type { KnowledgeModule } from "../types";

export const educationTrainingModule: KnowledgeModule = {
  id: "education_training",
  version: 1,
  title: "Education & Training toolkit",
  summary: "Courses (Catalog, relabelled), booking a class via Bookings, learner-facing promotion.",
  appliesTo: { categories: ["education_training"] },
  body: `
Available when the page has the Education & Training category (schools, tutors, training centers, coaches, courses).

Education & Training has no separate "courses" table — a course IS a Catalog product, and the Catalog section is labelled "Courses" for this category. Each one has: name/title, price, description, up to 3 photos, an optional landing link, and an optional custom WhatsApp message. There is NO dedicated field for schedule, duration, level, or curriculum — that detail belongs in the description, written as real prose from what the owner told you, never invented. The same create_product_draft / update_product_draft tools used for any other page's products create and edit courses here.

Booking: Education & Training is one of the categories with a Ringo-recommended booking form ("Book a Class") — when Bookings is turned on (Dashboard → Bookings), a visitor can request a class with a preferred date and time. Booking requests and services are the same booking_services/bookings system every category with a booking form uses; get_my_bookings_summary reads it.

Vocabulary for content and conversation: "course" or "class" (not "product"), "student" or "learner" (not "customer"), "enrollment" or "booking a class" (not "order"). A promotional post or WhatsApp message should center on what's actually known (the course, the price, the format if stated) ONLY if the owner gave it — never invent a schedule, certification, class size or outcome.

Advice (suggestions): a clear price on each course so learners aren't guessing, a description that states what's actually taught, and turning on Bookings so a "Book a Class" button appears instead of WhatsApp being the only path in.
`.trim(),
  related: ["catalog", "bookings", "payments"],
};
