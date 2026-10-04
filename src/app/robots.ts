import type { MetadataRoute } from "next";
import { seoSiteUrl } from "@/lib/seo";

// Crawler guidance only: it asks well-behaved crawlers to skip the private and internal route families.
// It is NOT access control: every one of these routes keeps its own authorization, and robots.txt is public.
// The public profile pages (/{username}) and the secondary pages that point back to them with a canonical
// (/r/, /m/, booking) stay crawlable on purpose so a crawler can read their canonical / noindex tags.
export const PRIVATE_ROUTE_PREFIXES = [
  "/dashboard",
  "/admin",
  "/auth",
  "/api/",
  "/my-ringo",
  "/scanner/",
  "/d/",
  "/order/",
  "/shop/orders",
  "/team/",
  "/association/",
  "/community/manage",
  "/m-card/",
  "/dev-preview-",
];

export default function robots(): MetadataRoute.Robots {
  const base = seoSiteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE_ROUTE_PREFIXES }],
    sitemap: `${base}/sitemap.xml`,
  };
}
