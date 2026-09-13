import { createClient, createAdminClient } from "@/lib/supabase/server";
import { notifyAdmins } from "@/lib/notifications";
import { sendPushToAdmins } from "@/lib/push/send";
import { NextResponse } from "next/server";

// Notifies every admin (in-app feed + OS push) that a new person just
// confirmed their self-serve signup (/auth/signup → /auth/confirm) —
// called once, client-side, from /auth/confirm right after verifyOtp
// succeeds for type === "signup".
//
// There's no webhook or DB trigger to hook this into instead: the account
// itself is created earlier by a Postgres trigger on auth.users (before
// the email is even confirmed), and Postgres has no built-in way to call
// out to this app from a trigger. Calling this from the client instead
// works because it only ever reports on the caller's OWN just-established
// session — it can't be used to spoof a notification about anyone else,
// since the user id always comes from the session, never the request body.
//
// Distinct from the "new paid member" push in applyPayment.ts/the Stripe
// webhook/the admin approve route: this fires for every free self-serve
// signup, which never touches payment_transactions at all, so those
// payment-triggered notifications never would.
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, name")
    .eq("user_id", user.id)
    .single();

  const who = profile?.name || (profile?.username ? `@${profile.username}` : user.email || "Someone");

  await Promise.allSettled([
    notifyAdmins({
      type: "signup_free",
      title: "New Ringo Connect signup",
      body: `${who} just signed up.`,
      link: "/admin",
    }),
    sendPushToAdmins(createAdminClient(), {
      category: "signup_free",
      title: "New Ringo Connect signup",
      body: `${who} just signed up.`,
      url: "/admin",
    }),
  ]);

  return NextResponse.json({ ok: true });
}
