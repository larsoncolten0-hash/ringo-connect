import { NO_INPUT_SCHEMA, parseNoInput, type AiTool } from "../types";

export const getMyProfileOverview: AiTool = {
  name: "get_my_profile_overview",
  description:
    "Get a factual overview of the user's own Ringo page: category, status (published/verified), plan and its limits, which toolkits are active, and counts of links, products, tracks, events, menu items, booking services, connections and community members. Use before giving account-specific advice.",
  kind: "read",
  permission: "settings.view",
  inputSchema: NO_INPUT_SCHEMA,
  parseInput: parseNoInput,
  async run({ snapshot: s }) {
    return {
      page: {
        username: s.profile.username,
        category: s.profile.category,
        extra_categories: s.profile.categories.filter((c) => c !== s.profile.category),
        music_role: s.profile.musicRole,
        restaurant_subcategory: s.profile.restaurantSubcategory,
        published: s.profile.published,
        verified: s.profile.verified,
        store_currency: s.profile.currency,
        has_profile_photo: s.profile.hasAvatar,
        has_bio: s.profile.hasBio,
        has_cover_photo: s.profile.hasCoverImage,
        has_long_description: s.profile.hasLongDescription,
        has_whatsapp: s.profile.hasWhatsapp,
        has_contact_email: s.profile.hasAboutEmail,
        has_contact_phone: s.profile.hasAboutPhone,
        created_at: s.profile.createdAt?.slice(0, 10) ?? null,
      },
      plan: s.plan,
      toolkits: {
        music: s.isMusic,
        restaurant: s.isRestaurant,
        tickets: s.hasTicketing,
        bookings_enabled: s.profile.bookingsEnabled,
        community: true,
        loyalty: s.loyaltyAvailability,
        restaurant_ordering: s.restaurant,
      },
      counts: s.counts,
      onboarding_completed: s.onboardingCompleted,
    };
  },
};
