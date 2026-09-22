import type { KnowledgeModule } from "../types";

export const profilesModule: KnowledgeModule = {
  id: "profiles",
  version: 1,
  title: "Ringo page (profile) and the Editor",
  summary: "Editing the public page: photo, bio, WhatsApp, links, socials, about, theme, pixels, completion card, verification, publishing.",
  appliesTo: {},
  body: `
The Editor (Dashboard home, /dashboard) edits the public Ringo page, with a live preview. Sections (open one directly with /dashboard?section=<id>):
- Profile header: display name, bio (short, up to 150 characters), profile photo, cover photo.
- Category: primary category plus optional extra categories.
- WhatsApp: number and default message — powers the WhatsApp chat button on the page (a key contact method in Cameroon).
- Social links: social icons (unlimited on every plan).
- Links: link buttons. The number of links is limited by plan (Free has a small limit).
- Catalog: products (label depends on category). Product count is limited by plan.
- About: longer description, email, phone(s), company/position, location, hours.
- Brand color / theme: colors, background, button style/shape. Custom theming needs a paid plan.
- Tracking pixels: Meta/TikTok pixel IDs and server-side tokens (paid plans).
- Category toolkits appear as extra sections: Music settings, releases, tracks, pinned spotlight (Music & Entertainment); Restaurant settings, Menu, Tables (Restaurant & Food).

"Complete your profile" card: shown in the Editor until these are done — profile photo, bio, category, a contact method (WhatsApp, a social link, or an email), at least one link, at least one catalog product, plus a menu item (restaurants) or a track/release (music). It disappears at 100%.

Publishing: pages are public by default. If a page is not published, visitors can't see it and orders, bookings and Connect stop working. There is no Dashboard switch for this — the owner must contact the Ringo team.

Verification badge: owners can request verification from their profile/avatar menu; the Ringo team reviews requests. Ringo AI cannot approve verification.

Good-profile advice (suggestions, not rules): clear photo, a bio that says what you do and where, WhatsApp set, 3–5 focused links, real prices on products, a location in About, and sharing the page link/QR everywhere.
`.trim(),
  related: ["catalog", "plans", "categories"],
};
