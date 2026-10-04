// Ringo guidance layer — shared types. Pure data only: nothing in src/lib/profileHealth reads the
// database, the DOM or localStorage (callers pass plain data in), so the whole layer is testable on
// its own and the UI never decides what "complete" means.
//
// Strings are deliberately NOT here. Every user-facing sentence lives in translations.ts under
// `guidance` (EN + FR) and is looked up by the ids below.

export type Bilingual = { en: string; fr: string };

/** Counted towards the completion percentage — only ever features the profile can actually use. */
export type CriterionId =
  | "name"
  | "avatar"
  | "bio"
  | "category"
  | "whatsapp"
  | "socials"
  | "links"
  | "location"
  | "hours"
  | "catalog"
  | "menuItems"
  | "tracks"
  | "events";

/** Suggestions that are NOT part of the percentage (polish and growth). */
export type GrowthId = "menuPhotos" | "productPhotos" | "addRelease" | "enableBooking" | "addEvent" | "shareProfile" | "reviewAnalytics";

export type RecommendationId = CriterionId | GrowthId;

/** Where a recommendation sits on the Create → Connect → Offer → Share → Grow path. */
export type JourneyStage = "create" | "connect" | "discover" | "offer" | "share" | "grow";

export type CategoryGroup = "food" | "music" | "events" | "creator" | "shop" | "service" | "other";

/** The plain profile shape the guidance reads — a subset of what the editor/dashboard already loads. */
export interface HealthProfile {
  name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  category?: string | null;
  categories?: string[] | null;
  subcategory?: string | null;
  whatsapp_number?: string | null;
  about_location?: string | null;
  about_hours?: string | null;
  opening_hours?: unknown;
  published?: boolean | null;
  bookings_enabled?: boolean | null;
  social_links?: unknown[] | null;
  links?: { url?: string | null }[] | null;
  products?: { name?: string | null; image_url?: string | null }[] | null;
  menu_items?: { name?: string | null; image_url?: string | null }[] | null;
  menu_categories?: { name?: string | null }[] | null;
  tracks?: { title?: string | null }[] | null;
  music_releases?: { title?: string | null }[] | null;
  events?: unknown[] | null;
}

/** Only the plan flags that already exist on `plans` — never changed, only read. */
export interface HealthPlan {
  max_products?: number | null;
  max_links?: number | null;
  bookings_feature_enabled?: boolean | null;
}

/** Real traffic counts when the caller has them (omit when unknown — nothing is ever invented). */
export interface HealthActivity {
  totalPageViews?: number;
  pageViews7d?: number;
  pageViewsPrev7d?: number;
}

export interface HealthInput {
  profile: HealthProfile;
  plan?: HealthPlan | null;
  activity?: HealthActivity | null;
}

export interface HealthItem {
  id: CriterionId;
  met: boolean;
  /** Existing editor section or dashboard route that fixes it. */
  href: string;
  priority: number;
  stage: JourneyStage;
  /** Only the catalog item carries this: the category's own wording ("Menu", "Listings", "Services"…). */
  catalogLabel?: Bilingual;
}

export interface Recommendation {
  id: RecommendationId;
  /** "complete" = a missing counted item; "grow" = an optional improvement. */
  kind: "complete" | "grow";
  journey: JourneyStage;
  priority: number;
  /** Destination for a link action. */
  href: string;
  /** "share" opens the share flow instead of navigating. */
  action: "link" | "share";
  catalogLabel?: Bilingual;
}

export interface NextAction extends Recommendation {
  /** True when the profile is so incomplete the headline should be "Complete your profile". */
  overall: boolean;
}

/** Completion only. "complete" = everything applicable is done but the page is not published; "live" = done and published. */
export type HealthStatus = "attention" | "good" | "complete" | "live";

export interface ProfileHealth {
  percentage: number;
  isComplete: boolean;
  /** Publication is separate from completion: false when the page is currently unpublished. */
  published: boolean;
  status: HealthStatus;
  group: CategoryGroup;
  category: string | null;
  items: HealthItem[];
  completedItems: HealthItem[];
  missingItems: HealthItem[];
  recommendations: Recommendation[];
  nextAction: NextAction | null;
}
