import { translations } from "@/lib/i18n/translations";

// Where things live in the dashboard, with the EXACT labels the user sees in
// English and French — read from translations.ts so a relabel there is
// picked up automatically and Ringo AI never names a button that doesn't
// exist. Paths are real routes under src/app/dashboard; `?section=<id>`
// opens that Editor section (Editor.tsx reads the param).

type Pick = (t: typeof translations.en) => string;

const PLACES: { path: string; label: Pick; note: string }[] = [
  { path: "/dashboard", label: (t) => t.nav.editor, note: "Profile editor: all profile sections below" },
  { path: "/dashboard?section=category", label: (t) => t.editor.category.title, note: "Primary + extra categories" },
  { path: "/dashboard?section=music-settings", label: (t) => t.music.settingsTitle, note: "Music & Entertainment only" },
  { path: "/dashboard?section=restaurant-settings", label: (t) => t.restaurant.settingsTitle, note: "Restaurant & Food only: ordering switch, order types, delivery fee, hours" },
  { path: "/dashboard?section=menu", label: (t) => t.restaurant.menuTitle, note: "Restaurant & Food only: menu categories and items" },
  { path: "/dashboard?section=tables", label: (t) => t.restaurant.tablesTitle, note: "Restaurant & Food only: table QR codes" },
  { path: "/dashboard?section=theme", label: (t) => t.editor.theme.title, note: "Colors/buttons (custom theme needs a paid plan)" },
  { path: "/dashboard?section=whatsapp", label: (t) => t.editor.whatsapp, note: "WhatsApp number + default message" },
  { path: "/dashboard?section=social-links", label: (t) => t.editor.socialLinks, note: "Social icons" },
  { path: "/dashboard?section=links", label: (t) => t.editor.links, note: "Link buttons (plan limit applies)" },
  { path: "/dashboard?section=releases", label: (t) => t.music.releasesTitle, note: "Music only: albums/EPs" },
  { path: "/dashboard?section=tracks", label: () => "Latest Music / Dernières sorties (title varies by music role)", note: "Music only: tracks, prices, audio" },
  { path: "/dashboard?section=catalog", label: (t) => t.editor.catalog, note: "Products (renamed per category, e.g. Shop/Merch); store currency is chosen here" },
  { path: "/dashboard?section=pinned", label: (t) => t.music.pinnedTitle, note: "Music only: pinned spotlight" },
  { path: "/dashboard?section=about", label: (t) => t.editor.about.title, note: "Long description, email, phone, location, hours" },
  { path: "/dashboard?section=pixels", label: (t) => t.editor.trackingPixels, note: "Meta/TikTok pixels (paid plans)" },
  { path: "/dashboard/analytics", label: (t) => t.nav.analytics, note: "Views and clicks" },
  { path: "/dashboard/community", label: (t) => t.nav.community, note: "Overview, Subscribers, Announcements, Settings" },
  { path: "/dashboard/bookings", label: (t) => t.nav.bookings, note: "Booking requests" },
  { path: "/dashboard/bookings/settings", label: (t) => t.bookings.settingsTitle, note: "Turn bookings on, services, booking link" },
  { path: "/dashboard/tickets", label: (t) => t.nav.tickets, note: "Events, ticket types, check-in (Music & Entertainment, Events & Experiences)" },
  { path: "/dashboard/music", label: (t) => t.nav.music, note: "Music orders, sales, customers, earnings & payouts" },
  { path: "/dashboard/restaurant", label: (t) => t.nav.restaurant, note: "Orders, kitchen, tables, customers, sales" },
  { path: "/dashboard/loyalty", label: (t) => t.nav.loyalty, note: "Loyalty overview, scan, activity, packages, program setup" },
  { path: "/dashboard/team", label: (t) => t.nav.team, note: "Staff and roles (Business plans)" },
  { path: "/dashboard/subscription", label: (t) => t.nav.subscription, note: "Plan, upgrade, renewal" },
  { path: "/dashboard/qr-code", label: (t) => t.nav.qrCode, note: "QR code for the public page" },
  { path: "/dashboard/ringo-card", label: (t) => t.nav.ringoCard, note: "NFC Ringo Card linked to the page" },
  { path: "/dashboard/affiliate", label: (t) => t.nav.affiliate, note: "Affiliate program" },
];

let cached: string | null = null;

/** Deterministic text (safe inside the cached prompt prefix). */
export function renderNavigationMap(): string {
  if (cached) return cached;
  const en = translations.en;
  const fr = translations.fr;
  cached = PLACES.map((p) => {
    const enLabel = p.label(en);
    const frLabel = p.label(fr);
    const label = enLabel === frLabel ? `"${enLabel}"` : `"${enLabel}" (FR: "${frLabel}")`;
    return `- ${label} → ${p.path} — ${p.note}`;
  }).join("\n");
  return cached;
}
