// Ringo AI x Business Toolkit: ONE deterministic, reviewable registry of what the Business Toolkit means for each Ringo category. It is configuration, not
// code generation: the gate itself (src/lib/bookkeeping/decision.ts BOOKKEEPING_CATEGORIES / INVENTORY_CATEGORIES) is still the single source of truth for who
// can use the Toolkit; this registry only adds the model-facing words (terminology, source-of-truth notes, what is NOT built) and a few privacy flags, and
// a test fails if the two disagree. Every other file that needs a category fact reads it from here instead of repeating it.
//
// Rule for every entry: the Toolkit is a financial layer (bookkeeping, invoices, payments, receivables, expenses, customers, reports). It is never a domain
// system (no CRM, project, fleet, farm, school, property or medical management), and a transaction that another Ringo subsystem already owns (restaurant
// orders, music purchases, ticket sales, Shop orders, invoice payments) is never recorded a second time.
import { BOOKKEEPING_CATEGORIES, INVENTORY_CATEGORIES } from "@/lib/bookkeeping/decision";
import { profileHasCategory, type CategoryId } from "@/lib/categories";

export interface CategoryToolkitProfile {
  id: CategoryId;
  /** Whether the Business Toolkit (and therefore the Business tools of Ringo AI) is offered for this category. Mirrors BOOKKEEPING_CATEGORIES (tested). */
  toolkit: boolean;
  /** Whether stock tracking is offered (mirrors INVENTORY_CATEGORIES, which mirrors the database check; tested). */
  inventory: boolean;
  /** What this category's owner calls the people they bill, as an AI hint only (the Toolkit's own screens keep their wording). */
  clientTerm: string;
  /** Model-facing facts about how the Toolkit applies here: how work is recorded, what another system owns, what is not available. */
  notes: string[];
  /** Domain systems that are deliberately NOT part of this project for the category. */
  notBuilt: string[];
  /** Customer names are shown reduced to initials by the read tools (financial layer only; no clinical or personal detail is ever read). */
  minimizeNames?: boolean;
}

const COMMON_SERVICES = [
  "Record work as an invoice (its payments become revenue and create the receipt) or, for a quick cash job, as a manual sale; expenses are recorded as entries.",
  "A booking request is NOT a sale or revenue: nothing is counted from it. Record the work through an invoice or an entry.",
];

export const CATEGORY_PROFILES: Record<CategoryId, CategoryToolkitProfile> = {
  business_ecommerce: {
    id: "business_ecommerce", toolkit: true, inventory: true, clientTerm: "customer",
    notes: ["Shop orders paid through Ringo checkout are counted automatically (never record them as manual sales). Stock tracking and the low-stock list apply to Shop products."],
    notBuilt: ["a full CRM or ERP", "supplier management", "a tax engine"],
  },
  professional_services: {
    id: "professional_services", toolkit: true, inventory: false, clientTerm: "client",
    notes: [...COMMON_SERVICES, "Services are described on invoice lines; there is no separate client-project module."],
    notBuilt: ["a CRM", "project management", "time tracking"],
  },
  freelancers_creators: {
    id: "freelancers_creators", toolkit: true, inventory: false, clientTerm: "client",
    notes: [...COMMON_SERVICES, "A project is identified by the description on its invoice lines; there is no project module."],
    notBuilt: ["project management", "time tracking"],
  },
  beauty_wellness: {
    id: "beauty_wellness", toolkit: true, inventory: false, clientTerm: "customer",
    notes: [...COMMON_SERVICES, "Appointments live in Bookings, which only holds requests: they are not copied into the books."],
    notBuilt: ["appointment scheduling beyond the existing booking requests", "service-material stock"],
  },
  construction_home_services: {
    id: "construction_home_services", toolkit: true, inventory: false, clientTerm: "customer",
    notes: [...COMMON_SERVICES, "Materials and labour paid are recorded as expenses (for example category supplies or stock_purchase); progress payments and deposits are payments or partial payments on an invoice."],
    notBuilt: ["project management", "payroll", "procurement"],
  },
  real_estate: {
    id: "real_estate", toolkit: true, inventory: false, clientTerm: "tenant or client",
    notes: [
      "Rent is billed as an invoice to the tenant (kept in the customer book) and a rent payment is a payment on that invoice. A deposit that will be returned is money received that is not income: record it as cash in, never as a sale. A commission is income (an invoice, or other income).",
      "A viewing request in Bookings is not income.",
    ],
    notBuilt: ["a property or tenancy register", "lease management", "a property-management ERP"],
  },
  agriculture_agribusiness: {
    id: "agriculture_agribusiness", toolkit: true, inventory: false, clientTerm: "customer",
    notes: ["Sales are invoices or manual sales; inputs (seeds, fertiliser, feed, packaging) are recorded as expenses. Stock tracking is not available for this category yet."],
    notBuilt: ["farm or livestock management", "harvest tracking", "an agricultural ERP"],
  },
  education_training: {
    id: "education_training", toolkit: true, inventory: false, clientTerm: "student or customer",
    notes: ["Fees are invoices to the student or payer (kept in the customer book); installments are several payments on one invoice; the outstanding balance is the invoice's amount due. Collections are the payments recorded."],
    notBuilt: ["student records", "a school-management system", "timetables or grading"],
  },
  travel_hospitality: {
    id: "travel_hospitality", toolkit: true, inventory: false, clientTerm: "guest or customer",
    notes: [...COMMON_SERVICES, "A deposit is a partial payment on an invoice (or cash in if it is refundable and not yet earned); a reservation request is never revenue."],
    notBuilt: ["room or reservation management", "channel management"],
  },
  creative_media: {
    id: "creative_media", toolkit: true, inventory: false, clientTerm: "client",
    notes: [...COMMON_SERVICES, "A job or project is identified by the description on its invoice lines."],
    notBuilt: ["project management", "an agency platform"],
  },
  transport_logistics: {
    id: "transport_logistics", toolkit: true, inventory: false, clientTerm: "customer",
    notes: ["Deliveries and trips are billed with invoices (or recorded as manual sales for cash jobs); fuel and vehicle costs are expenses (for example category transport)."],
    notBuilt: ["fleet management", "route or driver management", "trip tracking"],
  },
  health_medical: {
    id: "health_medical", toolkit: true, inventory: false, clientTerm: "customer", minimizeNames: true,
    notes: [
      "Financial layer only: fees, invoices, payments, receivables and expenses. Never ask for, read or discuss medical information, diagnoses or treatment; booking details and notes are never read.",
      "Customer names are shown as initials in lists; if a name is ambiguous ask the user for the full name they know the customer by.",
    ],
    notBuilt: ["medical records", "clinical information", "diagnoses or treatment advice", "any medical decision-making"],
  },
  restaurant_food: {
    id: "restaurant_food", toolkit: false, inventory: false, clientTerm: "customer",
    notes: [
      "Restaurant orders are the source of truth for restaurant sales: use get_my_restaurant_sales (gross order sales, UTC days) and get_my_restaurant_payments (gross order sales, paid and unpaid orders, Douala days). They are NOT bookkeeping revenue and are never copied into the books.",
      "A restaurant order's payment status is declared by the restaurant, not confirmed by a payment provider.",
      "The Business Toolkit (expenses, invoices, reports) is not offered for restaurants yet: its totals would leave out order revenue.",
    ],
    notBuilt: ["ingredient or recipe stock", "restaurant bookkeeping from orders"],
  },
  music_entertainment: {
    id: "music_entertainment", toolkit: false, inventory: false, clientTerm: "fan",
    notes: [
      "Music commerce is the source of truth for song, release, merch, support and ticket purchases: use get_my_music_sales (UTC days). Ticket sales are also a narrower lens in get_my_event_sales: never add the two together.",
      "The Business Toolkit is not offered for music pages yet: its totals would leave out music sales.",
    ],
    notBuilt: ["royalty accounting", "payout accounting beyond the existing earnings views"],
  },
  events_experiences: {
    id: "events_experiences", toolkit: false, inventory: false, clientTerm: "attendee",
    notes: [
      "Ticketing is the source of truth for ticket sales: use get_my_event_sales (UTC days); ticket revenue is never copied into the books.",
      "The Business Toolkit is not offered for events pages yet: its totals would leave out ticket revenue.",
    ],
    notBuilt: ["event budgeting", "vendor management"],
  },
  other: {
    id: "other", toolkit: false, inventory: false, clientTerm: "customer",
    notes: ["No category-specific financial tools are offered for this category."],
    notBuilt: [],
  },
};

type Shape = { category?: string | null; categories?: string[] | null };
const ids = (shape: Shape): CategoryId[] => (Object.keys(CATEGORY_PROFILES) as CategoryId[]).filter((id) => profileHasCategory({ category: shape.category ?? null, categories: shape.categories ?? [] } as any, id));

/** The registry entries of a page's categories (a page can have several). */
export const profilesOf = (shape: Shape): CategoryToolkitProfile[] => ids(shape).map((id) => CATEGORY_PROFILES[id]);

/** The short, de-duplicated notes the read tools attach to their answers for this page's categories. */
export function categoryNotes(shape: Shape, max = 4): string[] {
  const out: string[] = [];
  for (const p of profilesOf(shape)) for (const n of p.notes) if (!out.includes(n)) out.push(n);
  return out.slice(0, max);
}

export const minimizeNames = (shape: Shape): boolean => profilesOf(shape).some((p) => p.minimizeNames === true);

/** "Marie Twin" -> "M. T." (used only where the registry asks for reduced names). */
export const initials = (name: string | null | undefined): string | null => {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.map((w) => `${Array.from(w)[0].toUpperCase()}.`).join(" ") : null;
};

/** Consistency checks used by the tests: the registry never disagrees with the gate. */
export function registryProblems(): string[] {
  const problems: string[] = [];
  for (const p of Object.values(CATEGORY_PROFILES)) {
    if (p.toolkit !== BOOKKEEPING_CATEGORIES.includes(p.id)) problems.push(`${p.id}: toolkit flag disagrees with BOOKKEEPING_CATEGORIES`);
    if (p.inventory !== INVENTORY_CATEGORIES.includes(p.id)) problems.push(`${p.id}: inventory flag disagrees with INVENTORY_CATEGORIES`);
    if (p.inventory && !p.toolkit) problems.push(`${p.id}: inventory without the toolkit`);
  }
  for (const c of [...BOOKKEEPING_CATEGORIES, ...INVENTORY_CATEGORIES]) if (!CATEGORY_PROFILES[c]) problems.push(`${c}: missing from the registry`);
  return problems;
}
