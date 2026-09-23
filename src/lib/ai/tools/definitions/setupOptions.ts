import { CATEGORIES, MUSIC_ROLES, RESTAURANT_SUBCATEGORIES, profileHasTicketing } from "@/lib/categories";
import { NO_INPUT_SCHEMA, parseNoInput, type AiTool } from "../types";

// Setup Assistant helper: Ringo's REAL category system (src/lib/categories.ts
// — no second taxonomy), the page's current choices and plan facts, so the
// model maps "I'm a DJ in Yaoundé" onto exact ids and recommends only
// features this page can actually use.

export const getSetupOptions: AiTool = {
  name: "get_setup_options",
  description:
    "Get Ringo's categories (with ids and what each unlocks), music roles, restaurant sub-types, the page's current category choices and plan limits. Call before preparing a profile draft that sets a category/role, or to recommend features.",
  kind: "read",
  permission: "settings.view",
  inputSchema: NO_INPUT_SCHEMA,
  parseInput: parseNoInput,
  async run({ snapshot: s, locale }) {
    return {
      categories: CATEGORIES.map((c) => ({
        id: c.id,
        label: c.label[locale],
        for: c.examples[locale],
        catalog_label: c.defaults.catalogLabel?.[locale] ?? null,
        unlocks: {
          music_tools: c.id === "music_entertainment",
          event_ticketing: profileHasTicketing({ category: c.id, categories: [c.id] }),
          restaurant_tools: c.id === "restaurant_food",
          booking_form: !!c.defaults.booking,
        },
      })),
      music_roles: MUSIC_ROLES.map((r) => ({ id: r.id, label: r.label[locale] })),
      restaurant_subcategories: RESTAURANT_SUBCATEGORIES.map((r) => ({ id: r.id, label: r.label[locale] })),
      current: {
        category: s.profile.category,
        extra_categories: s.profile.categories.filter((c) => c !== s.profile.category),
        music_role: s.profile.musicRole,
        restaurant_subcategory: s.profile.restaurantSubcategory,
        store_currency: s.profile.currency,
      },
      plan: {
        name: s.plan.displayName,
        max_products: s.plan.maxProducts,
        products_now: s.counts.products,
        custom_theme: s.plan.customThemeEnabled,
        full_analytics: s.plan.fullAnalyticsEnabled,
        team: s.plan.teamEnabled,
      },
    };
  },
};
