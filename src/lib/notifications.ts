import { createAdminClient } from "@/lib/supabase/server";

type NotificationInput = {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
};

// Both helpers use the service-role client and are meant to be called
// from server code only (API routes) — see the matching RLS policies in
// supabase/migrations/2026-09-12_notifications.sql. Errors are logged, not
// thrown: a failed notification insert should never take down the
// signup/approval flow it's reporting on.

/** Broadcasts to every full admin (role = 'admin') — see AdminShell's bell. */
export async function notifyAdmins(input: NotificationInput) {
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    audience: "admin",
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
  });
  if (error) console.error("notifyAdmins failed:", error.message);
}

/** Targets exactly one account — see DashboardShell's bell. */
export async function notifyUser(userId: string, input: NotificationInput) {
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    audience: "user",
    user_id: userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
  });
  if (error) console.error("notifyUser failed:", error.message);
}
