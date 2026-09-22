import type { KnowledgeModule } from "../types";

export const connectModule: KnowledgeModule = {
  id: "connect",
  version: 1,
  title: "Connect, Community and announcements",
  summary: "How visitors connect, My Ringo, community members, consent rules, and sending announcements.",
  appliesTo: { always: true },
  body: `
Connect: every Ringo page has a Connect button. A visitor enters name, phone and email ("Stay Connected"); an existing email must be confirmed with a 6-digit code. They then have a free My Ringo account where the connection is saved. Marketing (promotional messages) is a separate, optional tick — connecting alone never signs anyone up for marketing.
Community is always on for every page. Connected customers are members of the owner's Community.
Consent rules (never suggest bypassing them):
- Email announcements reach only members who opted in to email updates with a confirmed email.
- Push announcements reach members who turned on notifications on a device (My Ringo or the page).
- WhatsApp is not a sending channel in Ringo today; owners can write WhatsApp messages themselves.
Dashboard → Community (/dashboard/community): Overview, Subscribers (with source: Ringo profile, QR code, NFC, product, music, event, restaurant), Announcements (write and send by email and/or push; sending can't be undone), Settings.

How to get more connections (suggestions): share the page link and QR code everywhere (WhatsApp status, socials, printed QR at the counter), use the Ringo Card, give a reason to connect (offers, new releases, loyalty rewards), and post announcements regularly but not too often.
`.trim(),
  related: ["loyalty", "notifications_pwa"],
};
