import type { KnowledgeModule } from "../types";

export const notificationsPwaModule: KnowledgeModule = {
  id: "notifications_pwa",
  version: 1,
  title: "Notifications and installing Ringo as an app",
  summary: "In-app notification bell, push notifications, installing the Dashboard / My Ringo to the home screen.",
  appliesTo: {},
  body: `
- Notification bell (Dashboard header): in-app notifications such as new orders, bookings and support replies.
- Push notifications: the owner can allow push notifications in the browser so new activity reaches their phone even when Ringo is closed. If the browser blocked notifications, they must be re-allowed in the browser/device settings.
- Install as an app: the Dashboard can be added to the phone's home screen (browser menu → "Add to Home Screen", or the install option in the Dashboard menu). It then opens like an app with the page's own icon. Customers can install My Ringo the same way.
- On iPhone, push notifications only work after adding Ringo to the home screen.
`.trim(),
  related: ["connect"],
};
