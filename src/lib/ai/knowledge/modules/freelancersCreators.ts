import type { KnowledgeModule } from "../types";

export const freelancersCreatorsModule: KnowledgeModule = {
  id: "freelancers_creators",
  version: 1,
  title: "Freelancers & Creators toolkit",
  summary: "Digital products (Catalog, relabelled) — no Ringo-recommended booking form for this category.",
  appliesTo: { categories: ["freelancers_creators"] },
  body: `
Available when the page has the Freelancers & Creators category (YouTubers, influencers, bloggers, streamers, freelancers).

Freelancers & Creators has no separate "offerings" table — a digital product, service or commission IS a Catalog product, and the Catalog section is labelled "Digital products" for this category. Each one has: name/title, price, description, up to 3 photos, an optional landing link (e.g. a link to the actual digital file, a Gumroad/Payhub page, or a portfolio piece), and an optional custom WhatsApp message. There is NO dedicated field for file format, license terms, or delivery method — that detail belongs in the description, written as real prose from what the owner told you, never invented. The same create_product_draft / update_product_draft tools used for any other page's products create and edit these here.

Booking: unlike most categories, Freelancers & Creators has NO Ringo-recommended booking form — don't suggest turning on a booking button that doesn't exist for this category. Consultations and commissions are arranged through WhatsApp (the page's default contact message already reflects this) or a landing link the owner sets, not through the Bookings feature.

Vocabulary for content and conversation: "offering" or "digital product" (matches the Catalog label), "client" or the owner's own audience term (e.g. "follower," "fan") where relevant, "commission" for custom work. A promotional post or WhatsApp message should center on what's actually known (the offering, the price if stated) ONLY if the owner gave it — never invent reach, follower counts, past results or collaborations.

Advice (suggestions): a clear price on each offering so people aren't guessing, and a landing link when the actual delivery happens outside Ringo (e.g. a marketplace or file host).
`.trim(),
  related: ["catalog", "payments"],
};
