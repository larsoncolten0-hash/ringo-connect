import type { CategoryId } from "@/lib/categories";

// The full permission catalog for Team & Organization Management. Kept
// deliberately small and grouped by module rather than one permission per
// CRUD verb per table — e.g. `menu.manage` covers create/update/delete
// together since nothing in this app currently needs to grant "can edit
// menu items but not delete them" as a separate case. Every RLS policy that
// checks one of these (see 2026-10-01_team_management.sql) uses the exact
// string below — keep the two in sync.
//
// Not every permission here has a matching RLS policy yet: the ones a real
// UI/route reads today are wired into 2026-10-01_team_management.sql's
// Restaurant & Food section; the rest (tickets.*, music.*, bookings.*,
// properties.*, routes.*, deliveries.*) exist so category role templates
// below can already reference the right shape, ready for that category's
// own additive RLS migration later — see the final report for what that
// involves.
export const PERMISSIONS = [
  "orders.view",
  "orders.create",
  "orders.update",
  "orders.cancel",
  "menu.view",
  "menu.manage",
  "kitchen.view",
  "kitchen.update",
  "tables.view",
  "tables.manage",
  "customers.view",
  "sales.view",
  "payments.view",
  "staff.view",
  "staff.invite",
  "staff.manage",
  "settings.view",
  "settings.manage",
  "tickets.view",
  "tickets.manage",
  "music.view",
  "music.manage",
  "bookings.view",
  "bookings.manage",
  "properties.view",
  "properties.manage",
  "routes.view",
  "routes.manage",
  "deliveries.view",
  "deliveries.manage",
  "admissions.view",
  "admissions.manage",
  "reports.view",
  "analytics.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

// Narrows an arbitrary array (request body) down to just recognized,
// deduplicated permission strings — never trusts client input directly,
// same pattern as sanitizeCategoryIds in src/lib/categories.ts.
export function sanitizePermissions(input: unknown): Permission[] {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.filter(isPermission)));
}

// Grouped for the permission-editor UI (RolePermissionsEditor) — display
// order and section labels, not a security boundary.
export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  { label: "Orders", permissions: ["orders.view", "orders.create", "orders.update", "orders.cancel"] },
  { label: "Menu", permissions: ["menu.view", "menu.manage"] },
  { label: "Kitchen", permissions: ["kitchen.view", "kitchen.update"] },
  { label: "Tables", permissions: ["tables.view", "tables.manage"] },
  { label: "Customers", permissions: ["customers.view"] },
  { label: "Sales & Payments", permissions: ["sales.view", "payments.view"] },
  { label: "Team", permissions: ["staff.view", "staff.invite", "staff.manage"] },
  { label: "Settings", permissions: ["settings.view", "settings.manage"] },
  { label: "Tickets & Bookings", permissions: ["tickets.view", "tickets.manage", "bookings.view", "bookings.manage"] },
  { label: "Music", permissions: ["music.view", "music.manage"] },
  { label: "Real Estate", permissions: ["properties.view", "properties.manage"] },
  { label: "Transport & Delivery", permissions: ["routes.view", "routes.manage", "deliveries.view", "deliveries.manage"] },
  { label: "Admissions", permissions: ["admissions.view", "admissions.manage"] },
  { label: "Reports", permissions: ["reports.view", "analytics.view"] },
];

export interface RoleTemplate {
  key: string;
  name: string;
  permissions: Permission[];
}

// Default role templates per category — DEFAULT starting points only, never
// hardcoded in a way that blocks customization: ensureDefaultRoles() (see
// access.ts) materializes these into real, editable organization_roles rows
// the first time an organization needs one, and the owner can rename or
// re-permission their own copy afterward without touching this list. This
// keeps role NAMES/PERMISSIONS out of the database schema entirely, so
// adding or adjusting a template is a code change, not a migration.
//
// The category ids below are Ringo's actual taxonomy (src/lib/categories.ts)
// — several of the example categories in the product spec this was built
// from (e.g. "School", "Insurance") aren't separate Ringo categories today,
// so they're mapped onto the closest existing one (School →
// education_training, Insurance → professional_services) rather than
// inventing new categories here.
export const CATEGORY_ROLE_TEMPLATES: Partial<Record<CategoryId, RoleTemplate[]>> = {
  restaurant_food: [
    { key: "manager", name: "Manager", permissions: ["orders.view", "orders.update", "orders.cancel", "menu.view", "menu.manage", "kitchen.view", "kitchen.update", "tables.view", "tables.manage", "customers.view", "sales.view", "payments.view", "staff.view", "staff.invite", "settings.view", "reports.view", "analytics.view"] },
    { key: "chef", name: "Chef", permissions: ["kitchen.view", "kitchen.update", "orders.view", "orders.update"] },
    { key: "waiter", name: "Waiter", permissions: ["orders.view", "orders.create", "orders.update", "tables.view"] },
    { key: "cashier", name: "Cashier", permissions: ["orders.view", "payments.view", "sales.view"] },
    { key: "accountant", name: "Accountant", permissions: ["sales.view", "reports.view", "payments.view"] },
    { key: "delivery", name: "Delivery", permissions: ["orders.view", "orders.update"] },
  ],
  music_entertainment: [
    { key: "manager", name: "Manager", permissions: ["music.view", "music.manage", "bookings.view", "bookings.manage", "tickets.view", "tickets.manage", "sales.view", "staff.view", "staff.invite", "settings.view", "reports.view", "analytics.view"] },
    { key: "booking_manager", name: "Booking Manager", permissions: ["bookings.view", "bookings.manage", "tickets.view"] },
    { key: "accountant", name: "Accountant", permissions: ["sales.view", "payments.view", "reports.view"] },
    { key: "marketing", name: "Marketing", permissions: ["analytics.view", "music.view", "bookings.view"] },
    { key: "team_member", name: "Team Member", permissions: ["music.view", "bookings.view"] },
  ],
  real_estate: [
    { key: "manager", name: "Manager", permissions: ["properties.view", "properties.manage", "bookings.view", "bookings.manage", "sales.view", "staff.view", "staff.invite", "settings.view", "reports.view", "analytics.view"] },
    { key: "agent", name: "Agent", permissions: ["properties.view", "properties.manage", "bookings.view", "customers.view"] },
    { key: "accountant", name: "Accountant", permissions: ["sales.view", "payments.view", "reports.view"] },
    { key: "marketing", name: "Marketing", permissions: ["analytics.view", "properties.view"] },
    { key: "team_member", name: "Team Member", permissions: ["properties.view"] },
  ],
  transport_logistics: [
    { key: "manager", name: "Manager", permissions: ["routes.view", "routes.manage", "deliveries.view", "deliveries.manage", "tickets.view", "tickets.manage", "sales.view", "staff.view", "staff.invite", "settings.view", "reports.view", "analytics.view"] },
    { key: "dispatcher", name: "Dispatcher", permissions: ["routes.view", "routes.manage", "deliveries.view", "deliveries.manage"] },
    { key: "driver", name: "Driver", permissions: ["routes.view", "deliveries.view", "deliveries.manage"] },
    { key: "ticket_agent", name: "Ticket Agent", permissions: ["tickets.view", "tickets.manage", "routes.view"] },
    { key: "accountant", name: "Accountant", permissions: ["sales.view", "payments.view", "reports.view"] },
    { key: "cargo_officer", name: "Cargo Officer", permissions: ["deliveries.view", "deliveries.manage"] },
  ],
  education_training: [
    { key: "administrator", name: "Administrator", permissions: ["admissions.view", "admissions.manage", "staff.view", "staff.invite", "settings.view", "reports.view", "analytics.view"] },
    { key: "teacher", name: "Teacher", permissions: ["bookings.view", "customers.view"] },
    { key: "admissions", name: "Admissions", permissions: ["admissions.view", "admissions.manage", "customers.view"] },
    { key: "accountant", name: "Accountant", permissions: ["sales.view", "payments.view", "reports.view"] },
    { key: "staff", name: "Staff", permissions: ["bookings.view"] },
  ],
  business_ecommerce: [
    { key: "manager", name: "Manager", permissions: ["orders.view", "orders.update", "orders.cancel", "sales.view", "staff.view", "staff.invite", "settings.view", "reports.view", "analytics.view"] },
    { key: "sales", name: "Sales", permissions: ["orders.view", "orders.create", "customers.view", "sales.view"] },
    { key: "warehouse", name: "Warehouse", permissions: ["orders.view", "orders.update"] },
    { key: "delivery", name: "Delivery", permissions: ["orders.view", "orders.update"] },
    { key: "accountant", name: "Accountant", permissions: ["sales.view", "payments.view", "reports.view"] },
    { key: "marketing", name: "Marketing", permissions: ["analytics.view"] },
  ],
  professional_services: [
    { key: "manager", name: "Manager", permissions: ["bookings.view", "bookings.manage", "sales.view", "staff.view", "staff.invite", "settings.view", "reports.view", "analytics.view"] },
    { key: "consultant", name: "Consultant", permissions: ["bookings.view", "customers.view"] },
    { key: "sales", name: "Sales", permissions: ["customers.view", "sales.view"] },
    { key: "accountant", name: "Accountant", permissions: ["sales.view", "payments.view", "reports.view"] },
    { key: "assistant", name: "Assistant", permissions: ["bookings.view", "customers.view"] },
  ],
};

// Every category not listed above (beauty_wellness, health_medical,
// travel_hospitality, events_experiences, creative_media,
// freelancers_creators, construction_home_services,
// agriculture_agribusiness, "other", and any future category) gets this
// generic starter set — satisfies "other categories should be able to use
// the same system" without a bespoke template for every one of them.
export const GENERIC_ROLE_TEMPLATE: RoleTemplate[] = [
  { key: "manager", name: "Manager", permissions: ["bookings.view", "bookings.manage", "customers.view", "sales.view", "staff.view", "staff.invite", "settings.view", "reports.view", "analytics.view"] },
  { key: "staff", name: "Staff", permissions: ["bookings.view", "customers.view"] },
  { key: "accountant", name: "Accountant", permissions: ["sales.view", "payments.view", "reports.view"] },
  { key: "marketing", name: "Marketing", permissions: ["analytics.view"] },
];

export function getRoleTemplatesForCategory(category: string | null | undefined): RoleTemplate[] {
  return CATEGORY_ROLE_TEMPLATES[category as CategoryId] ?? GENERIC_ROLE_TEMPLATE;
}
