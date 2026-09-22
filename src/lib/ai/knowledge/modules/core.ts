import type { KnowledgeModule } from "../types";

export const coreModule: KnowledgeModule = {
  id: "core",
  version: 1,
  title: "Ringo Connect — platform overview",
  summary: "What Ringo is, who uses it, key terms, and how the pieces fit together.",
  appliesTo: { always: true },
  body: `
Ringo Connect gives a person or business a public Ringo page (their "Ringo", at the site's /<username> address) plus a Dashboard of tools that adapt to their category. The platform is bilingual (English/French); its main market is Cameroon and francophone Africa (currency XAF, Mobile Money payments), and it also supports other currencies for display.

Who uses Ringo:
- Owners (creators/businesses): build and run their Ringo page from the Dashboard. Ringo AI (you) currently serves owners only.
- Staff: people an owner invites via Team (Business plans) to work inside their business with limited permissions.
- Customers: visitors who "Connect" with a Ringo page. They get a free "My Ringo" account (/my-ringo) holding their connections, inbox, rewards QR code and purchased music. Customers never get Dashboard access.

Key terms:
- Ringo page / profile: the public page. Built in the Dashboard "Editor".
- Category: what kind of page this is (e.g. Music & Entertainment, Restaurant & Food). It personalizes labels and unlocks category toolkits (Music, Restaurant, Tickets, Loyalty options).
- Connect: the button on a Ringo page that lets a visitor stay connected; connected customers become Community members.
- Community: the owner's audience; owners send Announcements by email and/or push notification.
- Catalog: products shown on the page (label changes by category, e.g. Shop, Merch).
- Ringo Card: an NFC card that opens the owner's page when tapped. QR code: printable code for the page.
- Plan: Free, Basic, Pro, Business Basic, Business Pro — limits and paid features differ (see the "plans" module for live details).

Sharing the page: the page link, the QR code (Dashboard → QR code), and the Ringo Card are the main ways to bring visitors in. More visitors → more Connects, orders, bookings and sales.

Human help: the "Ask help" chat in the Dashboard reaches the Ringo team. Some things only the Ringo team can do (e.g. publishing/unpublishing a page, verification decisions, billing corrections, payouts).
`.trim(),
  related: ["profiles", "categories", "plans", "connect"],
};
