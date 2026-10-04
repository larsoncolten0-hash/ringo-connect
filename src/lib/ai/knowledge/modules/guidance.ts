import type { KnowledgeModule } from "../types";

export const guidanceModule: KnowledgeModule = {
  id: "guidance",
  version: 1,
  title: "Ringo Home, Profile Health & Next Best Action",
  summary: "Ringo Home overview, the 'Your Ringo presence' completion score, the single Next Best Action, smart recommendations and milestones.",
  appliesTo: {},
  status: "live",
  whoCanUse: "Every account owner on their own page (not staff acting inside someone else's business).",
  body: `
Ringo Home (Dashboard menu → Home, /dashboard/home) is a read-only overview that answers: how is my Ringo doing, and what should I do next? It shows a greeting, ONE "Your next step" card, the "Your Ringo presence" completion card, the last 7 days of activity, quick actions and a few milestones. The Editor is unchanged and still lives at /dashboard.

Completion ("Your Ringo presence", also shown at the top of the Editor): a percentage worked out live from what is on the page, never stored. It only counts things the page can actually use:
- Everyone: name, profile photo, category, short description, WhatsApp number, social links, links (links only if the plan allows any).
- Location: for restaurants, shops/real estate/agriculture, service categories and events.
- Opening hours: restaurants (set in Restaurant settings) and beauty, health, business/e-commerce, professional services, education (the About hours field).
- The main offering by category: restaurants → menu items; music → a track or a release; events → at least one event; shops, real estate, service and creator categories → at least one catalogue item (shown under that category's own name, e.g. Shop, Listings, Services, Courses) — but ONLY when the plan unlocks the catalogue. A locked feature never counts against the score, so a Free page can still reach 100%.
- Not counted (suggestions only): bookings, events for music, release for music, photos on menu items/products.
The status line describes completion only: "Your Ringo is live" (complete and published), "Your Ringo is complete" (complete), "Your Ringo is looking good" (60%+) or "Your Ringo needs attention". Whether the page is published is shown separately ("Your Ringo is not currently published") and never changes the percentage or the checklist; there is no publish button on Home.

Next Best Action: the single highest-priority suggestion. When 4+ items are missing and the first one is a basic (name, photo, category, description) the headline is "Complete your profile" with that step; otherwise it names the most valuable specific step (e.g. Add your menu, Add your music, Connect WhatsApp, Add your opening hours). When everything is complete it suggests photos, bookings or events where the category supports them, sharing the profile (first, if the page has had no visits), and reviewing analytics once there is real traffic. Each suggestion shows why it matters and goes straight to the right Editor section or page. "Not now" hides a suggestion on THIS device only (saved in the browser, not on the account) and never changes the score.

Activity on Home uses the same data as Analytics: profile visits, link clicks and WhatsApp clicks for the last 7 days, with a plain-language note when visits rose or fell compared with the 7 days before. With no activity yet it says "Your analytics are waiting" and offers to share the profile. Milestones are quiet facts read from existing data: page live, page complete, first visit, 100 visits, first item added, first online order, first community member.

You cannot change this score, dismiss a suggestion or complete a step for the owner — those happen in the Editor and dashboard. You can explain what is missing and where to fix it.
`.trim(),
  actions: [
    "Open Ringo Home from the Dashboard menu",
    "Follow the Next Best Action button to the exact Editor section",
    "Hide a suggestion on this device with Not now",
    "Share the profile link from Home",
  ],
  prerequisites: ["A Ringo account with a page (profile)."],
  limitations: [
    "The completion score is advice, not a requirement, and is never stored.",
    "Not-now choices are per device only.",
    "Search visibility (Google) guidance is not part of this yet.",
  ],
  related: ["profiles", "categories", "plans", "analytics", "onboarding"],
};
