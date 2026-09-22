import type { KnowledgeModule } from "../types";

export const analyticsModule: KnowledgeModule = {
  id: "analytics",
  version: 1,
  title: "Analytics",
  summary: "Page views, link/product/WhatsApp clicks, referrers and locations; Free vs paid analytics.",
  appliesTo: {},
  body: `
Dashboard → Analytics (/dashboard/analytics) shows activity on the public page: page views, link clicks, product clicks and WhatsApp button clicks, plus where visitors came from (referrer) and their country/city.
Free shows basic totals; paid plans show the full analytics history.
Reading the numbers (suggestions): many views but few clicks → improve the bio, first links and product photos; many WhatsApp clicks but few sales → reply faster and use clear prices; few views → share the page more (QR, WhatsApp status, socials, Ringo Card).
`.trim(),
  related: ["profiles", "connect"],
};
