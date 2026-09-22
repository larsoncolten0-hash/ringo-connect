import type { KnowledgeModule } from "../types";

export const onboardingModule: KnowledgeModule = {
  id: "onboarding",
  version: 1,
  title: "Getting started",
  summary: "Signup, the first-login tour, and a recommended first-week setup order per category.",
  appliesTo: {},
  body: `
New owners sign up through Get Started (/get-started), choose a category and plan, and get a Dashboard. On first login a short guided tour shows the main areas; it can be dismissed.
A good first-week order (suggestions):
1. Profile photo, name, bio that says what you do and where, category.
2. WhatsApp number and default message.
3. Your category's core: Menu + Restaurant settings (restaurants), tracks/releases + XAF currency (music), products (shops), bookings (services).
4. 3–5 useful links and your social icons.
5. Share: page link on WhatsApp status and socials, print the QR code, consider a Ringo Card.
6. Start collecting Connects and send a first Community announcement; set up Loyalty if recommended for your category.
Ringo AI can check the setup at any time ("Check my Ringo setup").
`.trim(),
  related: ["profiles", "categories"],
};
