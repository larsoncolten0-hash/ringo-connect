import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const get = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim() : null;
};
const url = get("SUPABASE_URL") || get("NEXT_PUBLIC_SUPABASE_URL");
const key = get("SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(url, key);

const tables = [
  "plans", "addons", "users", "profiles", "social_links", "links", "products", "click_events", "admin_audit_log",
  "profile_phone_numbers", "signup_requests", "payment_transactions", "platform_settings",
  "affiliate_payouts", "affiliate_commissions",
  "tracks", "events", "music_releases", "music_customers", "music_orders", "music_order_items",
  "music_payouts", "music_sale_earnings",
  "menu_categories", "menu_items", "restaurant_tables", "restaurant_customers", "customer_marketing_consent",
  "orders", "order_items", "order_status_history",
  "booking_services", "bookings", "booking_status_history",
  "community_subscribers", "community_subscription_preferences", "community_announcements", "community_delivery_logs",
  "event_ticket_types", "digital_tickets", "scanner_sessions",
  "ringo_cards",
  "organization_roles", "organization_members", "organization_invitations", "organization_activity_log",
  "notifications", "push_subscriptions", "push_delivery_logs",
  "support_conversations", "support_messages",
  "verification_requests", "branding_settings", "subscription_reminder_log",
  "email_delivery_logs", "email_suppressions",
  "demo_signup_attempts",
  "association_partners", "association_invitations", "association_members", "association_rewards",
  "association_point_transactions", "association_settings",
];

for (const table of tables) {
  const { data, error } = await admin.from(table).select("*").limit(1);
  if (error) {
    console.log(`${table}: ERROR - ${error.message}`);
  } else if (data && data[0]) {
    console.log(`${table}: ${Object.keys(data[0]).join(", ")}`);
  } else {
    console.log(`${table}: (exists, 0 rows to infer columns — empty table)`);
  }
}
