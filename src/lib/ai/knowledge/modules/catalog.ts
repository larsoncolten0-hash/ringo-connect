import type { KnowledgeModule } from "../types";

export const catalogModule: KnowledgeModule = {
  id: "catalog",
  version: 1,
  title: "Catalog / products",
  summary: "Adding products, photos, prices, currency, product pages, plan limits.",
  appliesTo: { categories: ["business_ecommerce"] },
  body: `
The Catalog (Editor → Catalog; renamed per category, e.g. "Shop" for Business & E-commerce, "Merch" for Music & Entertainment) lists products on the Ringo page.
Each product has: name, price, description, up to 3 photos (visitors can swipe), an optional landing page URL, and an optional custom WhatsApp message. Each product also gets its own shareable item page.
Visitors act on a product by contacting the owner (WhatsApp, with the product's message) or following its landing link. For Music & Entertainment, merch can also be bought through the Music store checkout.
The store currency is chosen in the Catalog section; it applies to prices shown across the page (and Music store checkout requires XAF).
The number of products is limited by plan; when the limit is reached the Catalog stops accepting new products until the owner upgrades.
Restaurants have a separate digital Menu (Editor → Menu) for food — the Catalog is for anything else they sell.

Advice (suggestions): real photos, clear prices, short benefit-focused descriptions, and a WhatsApp message that names the product so orders are easy to recognize.
`.trim(),
  related: ["plans", "payments", "restaurant", "music"],
};
