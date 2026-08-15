import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Supabase Auth only knows email/phone as identifiers — usernames live in
// our own `profiles` table, not `auth.users`. So logging in with a
// username means resolving it to the matching account's email first.
//
// That resolution happens here, server-side, using the service-role key
// (the only way to read another user's email — public.users has no
// client-readable policy for that). Critically, the resolved email is
// NEVER sent back to the browser in the normal case — only used
// internally for the actual signInWithPassword call. Returning it
// directly would turn this endpoint into a way to harvest real email
// addresses just by guessing usernames, even though usernames themselves
// are already public (every live page URL is one). The one exception is
// the "unconfirmed" case below, where the password has already been
// verified correct — at that point the person has proven account
// ownership, so handing back their own email to support the resend flow
// isn't a new leak.
export async function POST(request: Request) {
  const { identifier, password } = await request.json().catch(() => ({}));

  if (!identifier || !password) {
    return NextResponse.json({ error: "generic" }, { status: 400 });
  }

  let email = String(identifier).trim();

  if (!email.includes("@")) {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("user_id, users(email)")
      .eq("username", email.toLowerCase())
      .single();

    const resolvedEmail = (profile?.users as any)?.email;
    if (!resolvedEmail) {
      // Same generic error as a wrong password — doesn't confirm or deny
      // whether a username exists.
      return NextResponse.json({ error: "generic" }, { status: 401 });
    }
    email = resolvedEmail;
  }

  const supabase = createClient(); // cookie-aware — this is what actually logs the browser in
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    if (/email not confirmed/i.test(error?.message || "")) {
      return NextResponse.json({ error: "unconfirmed", email }, { status: 401 });
    }
    return NextResponse.json({ error: "generic" }, { status: 401 });
  }

  const { data: userRow } = await supabase.from("users").select("role, status").eq("id", data.user.id).single();

  if (userRow?.status === "suspended") {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "suspended" }, { status: 403 });
  }

  return NextResponse.json({ ok: true, role: userRow?.role || "creator" });
}