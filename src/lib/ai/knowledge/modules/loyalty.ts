import type { KnowledgeModule } from "../types";

export const loyaltyModule: KnowledgeModule = {
  id: "loyalty",
  version: 1,
  title: "Ringo Loyalty",
  summary: "Loyalty programs (visits, spend, points), packages, scanning customers, rewards.",
  appliesTo: { categories: ["restaurant_food", "beauty_wellness", "transport_logistics", "business_ecommerce"] },
  body: `
Ringo Loyalty (Dashboard → Loyalty, /dashboard/loyalty) rewards regular customers. It is available on every plan; the category decides whether it's recommended, optional, or not offered (not offered for Real Estate).
- Program types: visits (e.g. "10 meals → reward"), spend ("spend X → reward"), and points. Which actions and types are offered depends on the category (e.g. meals/drinks for restaurants, haircuts for beauty).
- Packages (prepaid bundles of sessions/items) exist for some categories (e.g. restaurants, beauty, health, transport).
- In the shop, the owner (or staff with the loyalty permission) opens Loyalty → Scan and scans the customer's My Ringo QR code, or searches for them, to record an activity. Rewards become ready automatically and are redeemed from the same screen.
- Customers see their progress and rewards in My Ringo.
Set up a program in Loyalty → Program (/dashboard/loyalty/setup); it takes about a minute.
`.trim(),
  related: ["connect"],
};
