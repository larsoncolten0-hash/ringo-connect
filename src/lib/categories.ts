// Business categories offered at signup (and editable afterwards from the
// dashboard — see CategoryCard.tsx). Picking a category personalizes a few
// bits of copy that already exist elsewhere in the product (the catalog
// section's title, the default WhatsApp message, the "about your business"
// placeholder on the get-started form) — it does NOT unlock or hide any
// feature. Every category still gets the same links/catalog/WhatsApp/about
// toolkit; a category only changes how that toolkit is labeled and
// pre-filled so a restaurant sees "Menu" where a real-estate agency sees
// "Listings".
//
// `id` values are stored as-is in `profiles.category` / `profiles.categories`
// and `signup_requests.category` / `signup_requests.categories` (see
// supabase/migrations/2026-09-12_business_categories.sql, which also holds a
// CHECK constraint mirroring this list — keep the two in sync).

export type CategoryId =
  | "music_entertainment"
  | "business_ecommerce"
  | "restaurant_food"
  | "real_estate"
  | "transport_logistics"
  | "professional_services"
  | "beauty_wellness"
  | "health_medical"
  | "education_training"
  | "travel_hospitality"
  | "events_experiences"
  | "creative_media"
  | "freelancers_creators"
  | "construction_home_services"
  | "agriculture_agribusiness"
  | "other";

type Bilingual = { en: string; fr: string };

export interface CategoryDefaults {
  // Overrides t.editor.catalog / t.profilePage.catalogHeading / t.getStarted.catalogHeading
  // wherever the profile (or a pending signup request) has a category set.
  // "other" deliberately has no override — it keeps the generic wording.
  catalogLabel: Bilingual | null;
  // Seeds profiles.default_whatsapp_message the first time a category is
  // applied to a brand-new profile (self-serve confirm, or admin approval)
  // — never overwrites a message the creator already edited themselves.
  whatsappMessage: Bilingual;
  // Placeholder for the "about your business" field on /auth/signup and
  // /get-started, and for AboutCard's long-bio field in the dashboard.
  notePlaceholder: Bilingual;
}

export interface Category {
  id: CategoryId;
  emoji: string;
  label: Bilingual;
  // Short "for:" line shown under the label on the picker.
  examples: Bilingual;
  defaults: CategoryDefaults;
}

export const CATEGORIES: Category[] = [
  {
    id: "music_entertainment",
    emoji: "🎵",
    label: { en: "Music & Entertainment", fr: "Musique & Divertissement" },
    examples: {
      en: "Artists, bands, DJs, producers, labels, comedians…",
      fr: "Artistes, groupes, DJ, producteurs, labels, humoristes…",
    },
    defaults: {
      catalogLabel: { en: "Music store", fr: "Boutique musicale" },
      whatsappMessage: {
        en: "Hi! I'd like to book you or ask about your music.",
        fr: "Salut ! Je voudrais vous booker ou en savoir plus sur votre musique.",
      },
      notePlaceholder: { en: "e.g. Afrobeat singer based in Douala", fr: "ex. Chanteur afrobeat basé à Douala" },
    },
  },
  {
    id: "business_ecommerce",
    emoji: "🛍️",
    label: { en: "Business & E-commerce", fr: "Commerce & E-commerce" },
    examples: {
      en: "Shops, retailers, wholesalers, fashion, electronics, beauty…",
      fr: "Boutiques, revendeurs, grossistes, mode, électronique, beauté…",
    },
    defaults: {
      catalogLabel: { en: "Shop", fr: "Boutique" },
      whatsappMessage: {
        en: "Hi! I'm interested in one of your products.",
        fr: "Salut ! Je suis intéressé(e) par un de vos produits.",
      },
      notePlaceholder: { en: "e.g. I sell shoes in Yaounde", fr: "ex. Je vends des chaussures à Yaoundé" },
    },
  },
  {
    id: "restaurant_food",
    emoji: "🍽️",
    label: { en: "Restaurant & Food", fr: "Restaurant & Alimentation" },
    examples: {
      en: "Restaurants, fast food, cafés, bakeries, catering, bars…",
      fr: "Restaurants, fast-food, cafés, pâtisseries, traiteurs, bars…",
    },
    defaults: {
      catalogLabel: { en: "Menu", fr: "Menu" },
      whatsappMessage: {
        en: "Hi! I'd like to place an order.",
        fr: "Salut ! Je voudrais passer une commande.",
      },
      notePlaceholder: {
        en: "e.g. Home-cooked meals delivered in Douala",
        fr: "ex. Plats faits maison livrés à Douala",
      },
    },
  },
  {
    id: "real_estate",
    emoji: "🏠",
    label: { en: "Real Estate", fr: "Immobilier" },
    examples: {
      en: "Agencies, property owners, agents, developers…",
      fr: "Agences, propriétaires, agents, promoteurs…",
    },
    defaults: {
      catalogLabel: { en: "Listings", fr: "Annonces" },
      whatsappMessage: {
        en: "Hi! I'm interested in one of your properties.",
        fr: "Salut ! Je suis intéressé(e) par un de vos biens.",
      },
      notePlaceholder: {
        en: "e.g. Apartments and land for sale in Yaounde",
        fr: "ex. Appartements et terrains à vendre à Yaoundé",
      },
    },
  },
  {
    id: "transport_logistics",
    emoji: "🚚",
    label: { en: "Transport & Logistics", fr: "Transport & Logistique" },
    examples: {
      en: "Bus agencies, taxis, delivery, freight, movers…",
      fr: "Agences de bus, taxis, livraison, fret, déménagement…",
    },
    defaults: {
      catalogLabel: { en: "Routes & services", fr: "Trajets & services" },
      whatsappMessage: {
        en: "Hi! I'd like to book a trip or a delivery.",
        fr: "Salut ! Je voudrais réserver un trajet ou une livraison.",
      },
      notePlaceholder: {
        en: "e.g. Bus tickets from Douala to Bamenda",
        fr: "ex. Billets de bus Douala–Bamenda",
      },
    },
  },
  {
    id: "professional_services",
    emoji: "💼",
    label: { en: "Professional Services", fr: "Services professionnels" },
    examples: {
      en: "Consultants, lawyers, accountants, agencies, IT…",
      fr: "Consultants, avocats, comptables, agences, informatique…",
    },
    defaults: {
      catalogLabel: { en: "Services", fr: "Services" },
      whatsappMessage: {
        en: "Hi! I'd like to book a consultation.",
        fr: "Salut ! Je voudrais prendre rendez-vous.",
      },
      notePlaceholder: {
        en: "e.g. Business consultant helping SMEs grow",
        fr: "ex. Consultant en gestion pour PME",
      },
    },
  },
  {
    id: "beauty_wellness",
    emoji: "💇🏾",
    label: { en: "Beauty & Wellness", fr: "Beauté & Bien-être" },
    examples: {
      en: "Salons, barbers, nail techs, makeup artists, spas…",
      fr: "Salons, coiffeurs, onglerie, maquilleurs, spas…",
    },
    defaults: {
      catalogLabel: { en: "Services", fr: "Services" },
      whatsappMessage: {
        en: "Hi! I'd like to book an appointment.",
        fr: "Salut ! Je voudrais prendre un rendez-vous.",
      },
      notePlaceholder: {
        en: "e.g. Braiding and nail salon in Bonapriso",
        fr: "ex. Salon de tresses et d'ongles à Bonapriso",
      },
    },
  },
  {
    id: "health_medical",
    emoji: "🏥",
    label: { en: "Health & Medical", fr: "Santé & Médical" },
    examples: {
      en: "Clinics, pharmacies, dental practices, laboratories…",
      fr: "Cliniques, pharmacies, cabinets dentaires, laboratoires…",
    },
    defaults: {
      catalogLabel: { en: "Services", fr: "Services" },
      whatsappMessage: {
        en: "Hi! I'd like to book an appointment.",
        fr: "Salut ! Je voudrais prendre un rendez-vous.",
      },
      notePlaceholder: { en: "e.g. Dental clinic in Bastos", fr: "ex. Cabinet dentaire à Bastos" },
    },
  },
  {
    id: "education_training",
    emoji: "🎓",
    label: { en: "Education & Training", fr: "Éducation & Formation" },
    examples: {
      en: "Schools, tutors, training centers, coaches, courses…",
      fr: "Écoles, tuteurs, centres de formation, coachs, cours…",
    },
    defaults: {
      catalogLabel: { en: "Courses", fr: "Formations" },
      whatsappMessage: {
        en: "Hi! I'd like to know more about your courses.",
        fr: "Salut ! Je voudrais en savoir plus sur vos formations.",
      },
      notePlaceholder: {
        en: "e.g. English lessons for beginners",
        fr: "ex. Cours d'anglais pour débutants",
      },
    },
  },
  {
    id: "travel_hospitality",
    emoji: "🏨",
    label: { en: "Travel & Hospitality", fr: "Voyage & Hôtellerie" },
    examples: {
      en: "Hotels, guest houses, travel agencies, tour operators…",
      fr: "Hôtels, auberges, agences de voyage, tour-opérateurs…",
    },
    defaults: {
      catalogLabel: { en: "Rooms & packages", fr: "Chambres & formules" },
      whatsappMessage: {
        en: "Hi! I'd like to make a reservation.",
        fr: "Salut ! Je voudrais faire une réservation.",
      },
      notePlaceholder: {
        en: "e.g. Guest house near the beach in Kribi",
        fr: "ex. Auberge près de la plage à Kribi",
      },
    },
  },
  {
    id: "events_experiences",
    emoji: "🎟️",
    label: { en: "Events & Experiences", fr: "Événements & Expériences" },
    examples: {
      en: "Organizers, concerts, conferences, weddings, festivals…",
      fr: "Organisateurs, concerts, conférences, mariages, festivals…",
    },
    defaults: {
      catalogLabel: { en: "Tickets", fr: "Billets" },
      whatsappMessage: {
        en: "Hi! I'd like to get tickets.",
        fr: "Salut ! Je voudrais avoir des billets.",
      },
      notePlaceholder: {
        en: "e.g. Concerts and weddings in Douala",
        fr: "ex. Concerts et mariages à Douala",
      },
    },
  },
  {
    id: "creative_media",
    emoji: "🎨",
    label: { en: "Creative & Media", fr: "Créatif & Média" },
    examples: {
      en: "Photographers, videographers, designers, studios…",
      fr: "Photographes, vidéastes, designers, studios…",
    },
    defaults: {
      catalogLabel: { en: "Portfolio & services", fr: "Portfolio & services" },
      whatsappMessage: {
        en: "Hi! I'd like to hire you for a project.",
        fr: "Salut ! Je voudrais vous engager pour un projet.",
      },
      notePlaceholder: {
        en: "e.g. Wedding photographer based in Yaounde",
        fr: "ex. Photographe de mariage basé à Yaoundé",
      },
    },
  },
  {
    id: "freelancers_creators",
    emoji: "👨🏾‍💻",
    label: { en: "Freelancers & Creators", fr: "Freelances & Créateurs" },
    examples: {
      en: "YouTubers, influencers, bloggers, streamers, freelancers…",
      fr: "YouTubeurs, influenceurs, blogueurs, streamers, freelances…",
    },
    defaults: {
      catalogLabel: { en: "Digital products", fr: "Produits numériques" },
      whatsappMessage: {
        en: "Hi! I found you on Ringo Connect.",
        fr: "Salut ! Je vous ai trouvé(e) sur Ringo Connect.",
      },
      notePlaceholder: {
        en: "e.g. Content creator and graphic designer",
        fr: "ex. Créateur de contenu et designer graphique",
      },
    },
  },
  {
    id: "construction_home_services",
    emoji: "🏗️",
    label: { en: "Construction & Home Services", fr: "Construction & Services à domicile" },
    examples: {
      en: "Contractors, architects, plumbers, electricians, painters…",
      fr: "Entrepreneurs, architectes, plombiers, électriciens, peintres…",
    },
    defaults: {
      catalogLabel: { en: "Services", fr: "Services" },
      whatsappMessage: {
        en: "Hi! I'd like a quote for a project.",
        fr: "Salut ! Je voudrais un devis pour un projet.",
      },
      notePlaceholder: {
        en: "e.g. Electrician and home repairs",
        fr: "ex. Électricien et réparations à domicile",
      },
    },
  },
  {
    id: "agriculture_agribusiness",
    emoji: "🌾",
    label: { en: "Agriculture & Agro-business", fr: "Agriculture & Agro-business" },
    examples: {
      en: "Farmers, cooperatives, agro-dealers, livestock, food producers…",
      fr: "Agriculteurs, coopératives, agro-distributeurs, élevage, producteurs…",
    },
    defaults: {
      catalogLabel: { en: "Products", fr: "Produits" },
      whatsappMessage: {
        en: "Hi! I'm interested in your products.",
        fr: "Salut ! Je suis intéressé(e) par vos produits.",
      },
      notePlaceholder: {
        en: "e.g. Fresh produce from our farm in the West region",
        fr: "ex. Produits frais de notre ferme dans la région de l'Ouest",
      },
    },
  },
  {
    id: "other",
    emoji: "✨",
    label: { en: "Other", fr: "Autre" },
    examples: {
      en: "Anything else — pick this and customize as you go.",
      fr: "Autre chose — choisissez ceci et personnalisez au fur et à mesure.",
    },
    defaults: {
      catalogLabel: null,
      whatsappMessage: {
        en: "Hi! I found you on Ringo Connect.",
        fr: "Salut ! Je vous ai trouvé(e) sur Ringo Connect.",
      },
      notePlaceholder: { en: "e.g. I sell shoes in Yaounde", fr: "ex. Je vends des chaussures à Yaoundé" },
    },
  },
];

export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);

export function getCategory(id?: string | null): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function isCategoryId(id: unknown): id is CategoryId {
  return typeof id === "string" && CATEGORY_IDS.includes(id as CategoryId);
}

// Narrows an arbitrary array (request body, DB row) down to just the
// recognized ids, deduplicated — never trusts client input directly.
export function sanitizeCategoryIds(input: unknown): CategoryId[] {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.filter(isCategoryId)));
}
