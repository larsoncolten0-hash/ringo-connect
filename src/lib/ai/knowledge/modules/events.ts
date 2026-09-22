import type { KnowledgeModule } from "../types";

export const eventsModule: KnowledgeModule = {
  id: "events",
  version: 1,
  title: "Events and ticketing",
  summary: "Creating events, ticket types, selling tickets, digital tickets and gate check-in.",
  appliesTo: { categories: ["music_entertainment", "events_experiences"] },
  body: `
Available for Music & Entertainment and Events & Experiences pages, at Dashboard → Tickets (/dashboard/tickets): create events, manage ticket types, and control gate access and check-in.
- Event: title, date/time, location, cover image, status (draft, published, cancelled, completed), optional max tickets per customer.
- Ticket types (e.g. Regular, VIP): price, optional quantity (stock), optional sales window, max per customer, active on/off. An event with no active ticket type can still sell with a single legacy price; with neither, there is nothing to buy online.
- Buyers receive a digital ticket (QR). At the gate, staff scan tickets with a check-in scanner link created from the event; each ticket can be used once.
- Past events stop selling.
- Online ticket payment runs through the same checkout as the Music store: Mobile Money (Fapshi), store currency XAF. That checkout currently only accepts pages that have the Music & Entertainment category; if an Events & Experiences page without it reports that ticket checkout fails, don't guess a fix — send it to the Ringo team.

Advice (suggestions): create ticket types early with a limited early-bird tier, announce the event to your Community, share the event from your page, and create the scanner link before the door opens.
`.trim(),
  related: ["music", "connect", "payments"],
};
