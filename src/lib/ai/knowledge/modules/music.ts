import type { KnowledgeModule } from "../types";

export const musicModule: KnowledgeModule = {
  id: "music",
  version: 1,
  title: "Music & Entertainment toolkit",
  summary: "Tracks, releases, Music store checkout, Support the Artist, orders, sales, earnings and payouts.",
  appliesTo: { categories: ["music_entertainment"] },
  body: `
Available when the page has the Music & Entertainment category.
Editor sections:
- Music settings: music role (artist, DJ, producer, band, comedian, actor…; it only retitles the section, e.g. "Latest Beats" for producers) and the "Support the Artist" option (fans can send support through the store).
- Tracks ("Latest Music" or the role's title): title, cover, audio (preview and protected full audio), genre, price, availability, optional download/email delivery, external/buy link.
- Releases: albums/EPs with their own price.
- Pinned spotlight: highlight one item at the top of the page.
Music & Entertainment pages also get a recommended premium theme (applied by the owner from the Category section).

Music store checkout (fans buy on the page):
- A standalone track is for sale only if it is available AND has a price. Tracks without a price are shown but can't be bought.
- Online payment is Mobile Money (Fapshi) only, which works only when the store currency (Editor → Catalog) is XAF. With any other currency, checkout is refused.
- Tickets for events and merch can be bought in the same store.

Dashboard → Music (/dashboard/music): orders, sales, customers, and earnings. Earnings from paid sales become available after a hold period, minus Ringo's commission; the owner then requests a payout from Earnings, and the Ringo team processes it.

Promotion advice (suggestions): announce releases to your Community (email/push) the day they drop, pin the new song, share the page QR/link on socials and WhatsApp status, price singles affordably in XAF, and create an event with tickets for shows.
`.trim(),
  related: ["events", "connect", "payments", "catalog"],
};
