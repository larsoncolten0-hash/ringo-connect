import { CATEGORIES, MUSIC_ROLES, RESTAURANT_SUBCATEGORIES } from "@/lib/categories";
import type { KnowledgeModule } from "../types";

// Generated from src/lib/categories.ts — the same definitions the signup
// form and Editor use — so this can never drift from the real category list.
const categoryLines = CATEGORIES.map((c) => `- ${c.id}: "${c.label.en}" / "${c.label.fr}" — ${c.examples.en}`).join("\n");
const musicRoles = MUSIC_ROLES.map((r) => `${r.label.en} (${r.id})`).join(", ");
const restaurantSubs = RESTAURANT_SUBCATEGORIES.map((r) => `${r.label.en} (${r.id})`).join(", ");

export const categoriesModule: KnowledgeModule = {
  id: "categories",
  version: 1,
  title: "Categories, roles and what each unlocks",
  summary: "The 16 Ringo categories, music roles, restaurant sub-types, and which toolkits each category gets.",
  appliesTo: {},
  body: `
Categories (id: English / French — examples):
${categoryLines}

What a category does:
- Personalizes labels and defaults (e.g. the Catalog is called "Shop" for a business, "Merch" for music; default WhatsApp message; booking form wording).
- Unlocks category toolkits: Music & Entertainment → Music settings, tracks, releases, Music store, Support the Artist, pinned spotlight, events/tickets. Events & Experiences → events/tickets. Restaurant & Food → Restaurant settings, digital Menu, online ordering, tables/QR, kitchen view.
- Decides Loyalty options (recommended, optional, or not offered — e.g. not offered for Real Estate).
- Real Estate, Transport & Logistics, Professional Services and most other categories use the shared toolkit (links, catalog, WhatsApp, about, bookings, Community/Connect, loyalty where offered); they don't have dedicated listing/route systems yet.

A page can have one primary category and extra categories; a feature is available if ANY of them unlocks it. Change categories in Editor → Category.

Music roles (cosmetic, retitle the music section): ${musicRoles}.
Restaurant sub-types (cosmetic): ${restaurantSubs}.
`.trim(),
  related: ["profiles", "music", "restaurant", "events", "loyalty"],
};
