import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Unlike /api/auth/login, this doesn't require a password — so it can't
// use "password already verified" as justification for anything. It
// follows the same pattern as forgot-password instead: always return a
// generic success, regardless of whether the identifier matched a real
// account, so this can't be used to check which usernames/emails exist.
export async function POST(request: Request) {
  const { identifier } = await request.json().catch(() => ({}));

  if (identifier) {
    let email = String(identifier).trim();

    if (!email.includes("@")) {
      const admin = createAdminClient();
      const { data: profile } = await admin
        .from("profiles")
        .select("user_id, users(email)")
        .eq("username", email.toLowerCase())
        .single();
      email = (profile?.users as any)?.email || "";
    }

    if (email) {
      const supabase = createClient();
      await supabase.auth.resend({ type: "signup", email });
    }
  }

  return NextResponse.json({ ok: true });
}