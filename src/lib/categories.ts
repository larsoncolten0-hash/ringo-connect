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

// A full set of ThemeCard fields (see src/lib/theme.ts for the value
// types) — applied wholesale as "what a brand-new profile in this category
// starts with," the same way DB column defaults seed every other profile.
// Never forced on an existing profile: only used (a) once, automatically,
// the moment a brand-new profile first gets this category (self-serve
// confirm, or admin approval — same "safe because nothing to clobber yet"
// reasoning as whatsappMessage below), or (b) later, from CategoryCard, as
// an explicit "Apply recommended theme" button the creator has to press —
// ThemeCard remains the one real theme system, this is just a starting
// point for it.
export interface RecommendedTheme {
  themeColor: string;
  backgroundStyle: "solid" | "gradient";
  backgroundColor: string;
  backgroundGradientEnd: string | null;
  textColor: string;
  buttonStyle: "fill" | "outline" | "soft";
  buttonRadius: "square" | "rounded" | "pill";
}

// One optional field the booking form can show beyond the always-present
// name/email/phone/message (and the service picker, which is data-driven —
// shown whenever the profile has any booking_services defined, regardless
// of category). `key` says which column (or `details` jsonb key, for
// eventType/meetingType) the value is written to server-side; `label`/
// `placeholder` are what's actually shown, so the same underlying field
// can read "Expected audience" for a musician and "Number of guests" for a
// restaurant without needing separate columns per category.
export interface BookingFieldConfig {
  key: "date" | "time" | "location" | "partySize" | "budget" | "eventType" | "meetingType";
  label: Bilingual;
  placeholder?: Bilingual;
}

export interface BookingConfig {
  buttonLabel: Bilingual;
  fields: BookingFieldConfig[];
}

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
  // Only set for categories that ship a curated look — currently just
  // music_entertainment. See RecommendedTheme above for when it's applied.
  recommendedTheme?: RecommendedTheme;
  // Button wording + which optional fields the booking form shows for this
  // category (see BookingButton/BookingPage). Categories without one fall
  // back to GENERIC_BOOKING_CONFIG via getBookingConfig() — booking still
  // works everywhere, just with a plain, generic form.
  booking?: BookingConfig;
}

// The "no category-specific config" fallback — a plain date/time/message
// form, always safe to show regardless of what the profile actually is.
export const GENERIC_BOOKING_CONFIG: BookingConfig = {
  buttonLabel: { en: "Book Now", fr: "Réserver" },
  fields: [
    { key: "date", label: { en: "Preferred date", fr: "Date souhaitée" } },
    { key: "time", label: { en: "Preferred time", fr: "Heure souhaitée" } },
  ],
};

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
      // Catalog/products is used for physical merch here — tracks get
      // their own dedicated "Latest Music"/"Latest Beats" section instead
      // (see MUSIC_ROLES and TracksCard), so this no longer says "Music
      // store" the way it did before that section existed.
      catalogLabel: { en: "Merch", fr: "Merch" },
      whatsappMessage: {
        en: "Hi! I'd like to book you or ask about your music.",
        fr: "Salut ! Je voudrais vous booker ou en savoir plus sur votre musique.",
      },
      notePlaceholder: { en: "e.g. Afrobeat singer based in Douala", fr: "ex. Chanteur afrobeat basé à Douala" },
      // Warm gold on near-black, gradient background, pill-shaped filled
      // buttons — a premium "creator page" look distinct from the app's
      // default (outline buttons on a flat background) without inventing
      // a second theme system: every field here is a real ThemeCard field.
      recommendedTheme: {
        themeColor: "#F2B705",
        backgroundStyle: "gradient",
        backgroundColor: "#0B0B12",
        backgroundGradientEnd: "#1A1220",
        textColor: "#FAFAFA",
        buttonStyle: "fill",
        buttonRadius: "pill",
      },
      // Same fields for every music_role (artist, DJ, producer, band…) —
      // the free-text message field covers role-specific nuance (e.g. a
      // DJ's set duration) rather than growing a field per sub-role.
      booking: {
        buttonLabel: { en: "Book Artist", fr: "Réserver l'artiste" },
        fields: [
          { key: "date", label: { en: "Event date", fr: "Date de l'événement" } },
          { key: "time", label: { en: "Event time", fr: "Heure de l'événement" } },
          { key: "location", label: { en: "Event location", fr: "Lieu de l'événement" } },
          {
            key: "eventType",
            label: { en: "Event type", fr: "Type d'événement" },
            placeholder: { en: "e.g. Wedding, corporate event, birthday", fr: "ex. Mariage, événement d'entreprise, anniversaire" },
          },
          { key: "partySize", label: { en: "Expected audience", fr: "Public attendu" } },
          { key: "budget", label: { en: "Budget", fr: "Budget" } },
        ],
      },
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
      // Catalog/products is for anything OUTSIDE the real digital menu now
      // (restaurant_food gets its own menu_categories/menu_items system —
      // see RestaurantMenuCard) — same reasoning as music_entertainment's
      // catalogLabel becoming "Merch" once tracks got their own section.
      catalogLabel: { en: "Shop", fr: "Boutique" },
      whatsappMessage: {
        en: "Hi! I'd like to place an order.",
        fr: "Salut ! Je voudrais passer une commande.",
      },
      // Clean white/near-white with a fresh green accent and pill buttons
      // — matches the reference design this category's public page and
      // ordering flow were built from. Same "applied once at signup,
      // otherwise an explicit button in the dashboard" rule as music's.
      recommendedTheme: {
        themeColor: "#1F9D55",
        backgroundStyle: "solid",
        backgroundColor: "#FFFFFF",
        backgroundGradientEnd: null,
        textColor: "#14202B",
        buttonStyle: "fill",
        buttonRadius: "pill",
      },
      notePlaceholder: {
        en: "e.g. Home-cooked meals delivered in Douala",
        fr: "ex. Plats faits maison livrés à Douala",
      },
      // Distinct from the existing menu/ordering system — this is a table
      // reservation request, not a food order, so no budget/event-type.
      booking: {
        buttonLabel: { en: "Book a Table", fr: "Réserver une table" },
        fields: [
          { key: "date", label: { en: "Date", fr: "Date" } },
          { key: "time", label: { en: "Time", fr: "Heure" } },
          { key: "partySize", label: { en: "Number of guests", fr: "Nombre de convives" } },
        ],
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
      booking: {
        buttonLabel: { en: "Request Viewing", fr: "Demander une visite" },
        fields: [
          { key: "date", label: { en: "Preferred date", fr: "Date souhaitée" } },
          { key: "time", label: { en: "Preferred time", fr: "Heure souhaitée" } },
          { key: "location", label: { en: "Property / listing", fr: "Bien / annonce" } },
        ],
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
      booking: {
        buttonLabel: { en: "Book a Trip", fr: "Réserver un trajet" },
        fields: [
          { key: "date", label: { en: "Date", fr: "Date" } },
          { key: "time", label: { en: "Time", fr: "Heure" } },
          { key: "location", label: { en: "Pickup / destination", fr: "Départ / destination" } },
        ],
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
      booking: {
        buttonLabel: { en: "Book Consultation", fr: "Réserver une consultation" },
        fields: [
          { key: "date", label: { en: "Preferred date", fr: "Date souhaitée" } },
          { key: "time", label: { en: "Preferred time", fr: "Heure souhaitée" } },
          {
            key: "meetingType",
            label: { en: "Meeting type", fr: "Type de rendez-vous" },
            placeholder: { en: "e.g. In-person, video call, phone call", fr: "ex. En personne, appel vidéo, appel téléphonique" },
          },
        ],
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
      booking: {
        buttonLabel: { en: "Book Appointment", fr: "Prendre rendez-vous" },
        fields: [
          { key: "date", label: { en: "Preferred date", fr: "Date souhaitée" } },
          { key: "time", label: { en: "Preferred time", fr: "Heure souhaitée" } },
        ],
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
      booking: {
        buttonLabel: { en: "Book Appointment", fr: "Prendre rendez-vous" },
        fields: [
          { key: "date", label: { en: "Preferred date", fr: "Date souhaitée" } },
          { key: "time", label: { en: "Preferred time", fr: "Heure souhaitée" } },
        ],
      },
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
      booking: {
        buttonLabel: { en: "Book a Class", fr: "Réserver un cours" },
        fields: [
          { key: "date", label: { en: "Preferred date", fr: "Date souhaitée" } },
          { key: "time", label: { en: "Preferred time", fr: "Heure souhaitée" } },
        ],
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
      booking: {
        buttonLabel: { en: "Request Booking", fr: "Demander une réservation" },
        fields: [
          { key: "date", label: { en: "Check-in date", fr: "Date d'arrivée" } },
          { key: "partySize", label: { en: "Number of guests", fr: "Nombre de personnes" } },
          { key: "budget", label: { en: "Budget", fr: "Budget" } },
        ],
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
      booking: {
        buttonLabel: { en: "Book Event", fr: "Réserver un événement" },
        fields: [
          { key: "date", label: { en: "Event date", fr: "Date de l'événement" } },
          { key: "location", label: { en: "Location", fr: "Lieu" } },
          { key: "partySize", label: { en: "Number of people", fr: "Nombre de personnes" } },
          { key: "budget", label: { en: "Budget", fr: "Budget" } },
        ],
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
      booking: {
        buttonLabel: { en: "Book a Photoshoot", fr: "Réserver une séance photo" },
        fields: [
          { key: "date", label: { en: "Date", fr: "Date" } },
          { key: "time", label: { en: "Time", fr: "Heure" } },
          { key: "location", label: { en: "Location", fr: "Lieu" } },
          { key: "partySize", label: { en: "Number of people", fr: "Nombre de personnes" } },
          { key: "budget", label: { en: "Budget", fr: "Budget" } },
        ],
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
      booking: {
        buttonLabel: { en: "Request a Quote", fr: "Demander un devis" },
        fields: [
          { key: "date", label: { en: "Preferred date", fr: "Date souhaitée" } },
          { key: "location", label: { en: "Location", fr: "Lieu" } },
          { key: "budget", label: { en: "Budget", fr: "Budget" } },
        ],
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

// The one lookup point BookingButton/BookingPage use — a category with no
// specific config (see GENERIC_BOOKING_CONFIG above) still gets a working,
// generic booking form rather than no booking at all.
export function getBookingConfig(id?: string | null): BookingConfig {
  return getCategory(id)?.defaults.booking ?? GENERIC_BOOKING_CONFIG;
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

// True whenever `id` is the profile's primary category OR one of its extra
// ones — the check every music-only feature (MusicSettingsCard, TracksCard,
// EventsCard, the public page's music sections) gates on, so a page tagged
// music_entertainment only as a secondary category still gets the tools.
export function profileHasCategory(
  profile: { category?: string | null; categories?: string[] | null } | null | undefined,
  id: CategoryId
): boolean {
  if (!profile) return false;
  return profile.category === id || !!profile.categories?.includes(id);
}

// The full event-ticketing toolkit (events, ticket types, the Buy Now/
// checkout storefront, digital tickets, gate scanning) is shared by both
// Music & Entertainment (where it started) and Events & Experiences —
// every route/page that gates on "does this profile sell tickets" should
// use this instead of checking music_entertainment alone, so the two
// categories never drift out of sync. Does NOT cover Music's other
// category-specific features (tracks, releases, the cream theme, Support
// the Artist) — those stay music_entertainment-only.
export function profileHasTicketing(
  profile: { category?: string | null; categories?: string[] | null } | null | undefined
): boolean {
  return profileHasCategory(profile, "music_entertainment") || profileHasCategory(profile, "events_experiences");
}

// Sub-type within Music & Entertainment — purely cosmetic (no gating
// anywhere), it just retitles the "Latest Music" section and its Artist
// Hub card so a beatmaker sees "Beats" instead of "Music". Stored in
// profiles.music_role; unset (null) falls back to the generic "artist"
// wording everywhere it's read.
export type MusicRole = "artist" | "dj" | "producer" | "band" | "comedian" | "actor" | "other";

export interface MusicRoleOption {
  id: MusicRole;
  emoji: string;
  label: Bilingual;
  // "Latest Music" vs "Latest Beats" — what MusicSection titles itself,
  // and what the Artist Hub's music card is labeled.
  sectionLabel: Bilingual;
}

export const MUSIC_ROLES: MusicRoleOption[] = [
  { id: "artist", emoji: "🎤", label: { en: "Artist / Singer", fr: "Artiste / Chanteur" }, sectionLabel: { en: "Latest Music", fr: "Dernières sorties" } },
  { id: "dj", emoji: "🎧", label: { en: "DJ", fr: "DJ" }, sectionLabel: { en: "Latest Mixes", fr: "Derniers mix" } },
  { id: "producer", emoji: "🎹", label: { en: "Producer / Beatmaker", fr: "Producteur / Beatmaker" }, sectionLabel: { en: "Latest Beats", fr: "Derniers beats" } },
  { id: "band", emoji: "🥁", label: { en: "Band", fr: "Groupe" }, sectionLabel: { en: "Latest Music", fr: "Dernières sorties" } },
  { id: "comedian", emoji: "🎭", label: { en: "Comedian", fr: "Humoriste" }, sectionLabel: { en: "Latest Clips", fr: "Derniers extraits" } },
  { id: "actor", emoji: "🎬", label: { en: "Actor", fr: "Acteur" }, sectionLabel: { en: "Latest Clips", fr: "Derniers extraits" } },
  { id: "other", emoji: "✨", label: { en: "Other entertainer", fr: "Autre artiste" }, sectionLabel: { en: "Latest Music", fr: "Dernières sorties" } },
];

export function getMusicRole(id?: string | null): MusicRoleOption | undefined {
  return MUSIC_ROLES.find((r) => r.id === id);
}

export function isMusicRole(id: unknown): id is MusicRole {
  return typeof id === "string" && MUSIC_ROLES.some((r) => r.id === id);
}

// Sub-type within Restaurant & Food — same purely-cosmetic role as
// MusicRole (retitles the category badge on the public page); also stored
// as-is in profiles.restaurant_subcategory, with a matching CHECK
// constraint in 2026-09-15_restaurant_food.sql — keep the two in sync.
export type RestaurantSubcategory =
  | "restaurant"
  | "fast_food"
  | "cafe"
  | "bakery"
  | "catering"
  | "food_vendor"
  | "bar_lounge"
  | "other";

export interface RestaurantSubcategoryOption {
  id: RestaurantSubcategory;
  emoji: string;
  label: Bilingual;
}

export const RESTAURANT_SUBCATEGORIES: RestaurantSubcategoryOption[] = [
  { id: "restaurant", emoji: "🍽️", label: { en: "Restaurant", fr: "Restaurant" } },
  { id: "fast_food", emoji: "🍔", label: { en: "Fast Food", fr: "Fast-food" } },
  { id: "cafe", emoji: "☕", label: { en: "Café", fr: "Café" } },
  { id: "bakery", emoji: "🥐", label: { en: "Bakery", fr: "Boulangerie" } },
  { id: "catering", emoji: "🍱", label: { en: "Catering", fr: "Traiteur" } },
  { id: "food_vendor", emoji: "🛒", label: { en: "Food Vendor", fr: "Vendeur alimentaire" } },
  { id: "bar_lounge", emoji: "🍹", label: { en: "Bar / Lounge", fr: "Bar / Lounge" } },
  { id: "other", emoji: "✨", label: { en: "Other Food Business", fr: "Autre activité alimentaire" } },
];

export function getRestaurantSubcategory(id?: string | null): RestaurantSubcategoryOption | undefined {
  return RESTAURANT_SUBCATEGORIES.find((r) => r.id === id);
}
