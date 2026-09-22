import type { KnowledgeModule } from "../types";

export const restaurantModule: KnowledgeModule = {
  id: "restaurant",
  version: 1,
  title: "Restaurant & Food toolkit",
  summary: "Digital menu, online ordering switches, order types, tables/QR, kitchen view, orders and sales.",
  appliesTo: { categories: ["restaurant_food"] },
  body: `
Available when the page has the Restaurant & Food category.
Editor sections:
- Restaurant settings: sub-type (restaurant, fast food, café, bakery…), the online ordering switch, which order types are accepted (dine-in, takeaway, delivery), delivery fee, opening hours.
- Menu: menu categories and items (name, price, photo, description, available on/off).
- Tables: tables with their own QR codes, so a dine-in customer's order is linked to the table.

How ordering works on the public page: a customer builds a cart from the menu, chooses an order type, and gives name and phone (and an address for delivery). The order appears in Dashboard → Restaurant (/dashboard/restaurant): Orders board, Kitchen view, Tables, Customers, Sales.

Why customers can't order (checked by the server in this order):
1. The page isn't published.
2. Online ordering is switched off in Restaurant settings.
3. The chosen order type (dine-in/takeaway/delivery) is switched off — if all three are off, nothing can be ordered.
4. The menu has no items, or every item is marked unavailable.
Price and names are always taken from the menu, never from the customer.

Advice (suggestions): photos on best-sellers, table QR codes on every table, turn on takeaway/delivery if you offer them, keep unavailable items switched off rather than deleted, and set up a Loyalty program (recommended for restaurants).
`.trim(),
  related: ["loyalty", "connect", "catalog"],
};
