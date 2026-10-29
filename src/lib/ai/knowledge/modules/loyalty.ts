import type { KnowledgeModule } from "../types";

export const loyaltyModule: KnowledgeModule = {
  id: "loyalty",
  version: 2,
  title: "Ringo Loyalty",
  summary: "Loyalty programs (visits, spend, points), packages, scanning customers, rewards, customer segments, offers and reviews.",
  appliesTo: { categories: ["restaurant_food", "beauty_wellness", "transport_logistics", "business_ecommerce"] },
  body: `
Ringo Loyalty (Dashboard → Loyalty, /dashboard/loyalty) rewards regular customers. It is available on every plan; the category decides whether it's recommended, optional, or not offered (not offered for Real Estate).
- Program types: visits (e.g. "10 meals → reward"), spend ("spend X → reward"), and points. Which actions and types are offered depends on the category (e.g. meals/drinks for restaurants, haircuts for beauty).
- Packages (prepaid bundles of sessions/items) exist for some categories (e.g. restaurants, beauty, health, transport).
- In the shop, the owner (or staff with the loyalty permission) opens Loyalty → Scan and scans the customer's My Ringo QR code, or searches for them, to record an activity. Rewards become ready automatically and are redeemed from the same screen.
- Customers see their progress and rewards in My Ringo.
Set up a program in Loyalty → Program (/dashboard/loyalty/setup); it takes about a minute.
Churches & Ministries can use Loyalty too, with VISITS programs only (for example "come 10 times, receive a gift"). Rewards are never tied to money: giving, tithes and offerings are not loyalty activity.
Segments (Loyalty → Segments): connected customers are new, returning, VIP (6+ visits or orders in 90 days) or inactive (not seen for 60+ days). The owner sees counts only, never names. Church attendance, membership and giving are never used.
Offers (Loyalty → Offers): a percent or amount discount (amounts are whole numbers, XAF has no decimals) with a code, optionally for one segment. Staff apply it at the till by finding the customer and typing the bill. Announcing an offer reaches ONLY customers whose effective marketing consent allows that channel (email or push); the owner sees counts, never who. Never promise delivery to people who have not agreed, and never treat membership, a purchase or a connection as consent.
Reviews (Loyalty → Reviews): customers who really used the business can rate 1-5 and comment; the owner can hide or reply once but not edit. Reviews are not offered for churches.
`.trim(),
  related: ["connect"],
};
