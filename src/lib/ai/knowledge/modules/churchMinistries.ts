import type { KnowledgeModule } from "../types";

export const churchMinistriesModule: KnowledgeModule = {
  id: "church_ministries",
  version: 1,
  title: "Churches & Ministries",
  summary: "Church, parish, ministry, fellowship and choir pages — currently the shared Ringo page toolkit only.",
  appliesTo: { categories: ["church_ministries"] },
  status: "partial",
  body: `
Available when the page has the Churches & Ministries category (local churches, parishes, ministries, fellowships, choirs). Sub-types: Local Church, Parish, Ministry, Fellowship, Choir, Other.

What this category has TODAY: the same shared page toolkit every category has — About, links, a catalog labelled "Church Store" / "Boutique de l'église", WhatsApp contact, Community (email and push updates for people who subscribe), QR code and Connect. The default WhatsApp message and the About placeholder are church-worded.

What does NOT exist yet (do not describe these as available, and never suggest the owner can set them up): member or people directory, leaders and volunteers records, departments, daily word / devotional publishing or scheduling, Bible reading programmes, care and support giving, a church-specific public page layout, church attendance, church reports. If asked, say they are planned and not available yet; do not invent steps or screens.

The Business Toolkit (bookkeeping, invoices, reports) is not offered for this category.

Privacy: never ask for, read or discuss member lists, individual giving, counselling or pastoral information, or anyone's religious details beyond what the owner chooses to publish on the page.

Vocabulary: "church", "ministry", "congregation", "service", "programme". Write announcements in the owner's tone; do not invent service times, addresses, leaders' names, doctrine or events — use only what the owner gave.
`.trim(),
  related: ["profiles", "catalog", "connect"],
};
