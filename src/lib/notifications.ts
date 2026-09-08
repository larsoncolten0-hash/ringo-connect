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

/**
 * Who should hear about a given signup_requests row — every full admin,
 * plus (when the request carries a referral_code matching a super
 * creator) that one specific super creator, since a request referred
 * through their own link is theirs to review (see canReviewerAccessRequest
 * in src/lib/assertAdmin.ts). Shared by every signup_requests lifecycle
 * event that needs to alert reviewers — submitted, paid, or anything
 * added later — so the "who" logic lives in exactly one place.
 */
export async function getSignupRequestReviewers(referralCode: string | null) {
  const admin = createAdminClient();
  const [{ data: admins }, superCreatorResult] = await Promise.all([
    admin.from("users").select("email").eq("role", "admin"),
    referralCode
      ? admin
          .from("users")
          .select("id, email")
          .eq("affiliate_code", referralCode)
          .eq("can_approve_requests", true)
          .maybeSingle()
      : Promise.resolve({ data: null as { id: string; email: string } | null }),
  ]);

  return {
    adminEmails: (admins || []).map((a) => a.email).filter(Boolean) as string[],
    superCreator: superCreatorResult.data,
  };
}
