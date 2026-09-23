import type { KnowledgeModule } from "../types";

export const agricultureAgribusinessModule: KnowledgeModule = {
  id: "agriculture_agribusiness",
  version: 1,
  title: "Agriculture & Agro-business toolkit",
  summary: "Products (Catalog) — no Ringo-recommended booking form for this category.",
  appliesTo: { categories: ["agriculture_agribusiness"] },
  body: `
Available when the page has the Agriculture & Agro-business category (farmers, cooperatives, agro-dealers, livestock, food producers).

This category's Catalog keeps the plain "Products" label — closer to a straightforward product listing than the service-style categories. Each product has: name, price, description, up to 3 photos, an optional landing link, an optional custom WhatsApp message, and an "available" on/off switch (plus stock count where the owner tracks it) — use these for availability/seasonal framing rather than inventing a dedicated "season" or "harvest date" field, which doesn't exist. That detail, like variety, origin farm, or certification, belongs in the description, written as real prose from what the owner told you, never invented. The same create_product_draft / update_product_draft tools used for any other page's products create and edit listings here.

Booking: this category has NO Ringo-recommended booking form — don't suggest turning on a booking button that doesn't exist for it. Orders/interest are handled through WhatsApp (the page's default contact message already reflects this) or a landing link the owner sets.

Vocabulary for content and conversation: "product" or "produce" fits naturally here (unlike most other newer categories, this one really is selling goods), "buyer" or "customer". A promotional post or WhatsApp message should center on what's actually known (the product, the price, availability) ONLY if the owner gave it — never invent a certification (organic, fair-trade etc.), farming method, origin or seasonal claim.

Advice (suggestions): real photos of the actual produce/goods (not stock images), a clear price on every listing, keeping "available" switched off for anything currently out of stock rather than deleting it, and a description that states variety/quantity plainly if the owner gave it.
`.trim(),
  related: ["catalog", "payments"],
};
