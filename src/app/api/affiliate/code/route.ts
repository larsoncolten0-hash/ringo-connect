import { createClient, createAdminClient } from "@/lib/supabase/server";
import { setAffiliateCode } from "@/lib/affiliate";
import { normalizeAffiliateCode, isValidAffiliateCodeFormat } from "@/lib/affiliateCode";
import { NextResponse } from "next/server";

// Lets an affiliate pick their own short, memorable code (e.g. "JOHN23")
// instead of living with the random one set_affiliate_code() assigned
// them at signup — see setAffiliateCode() in src/lib/affiliate.ts for why
// this has to go through the admin client.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const code = normalizeAffiliateCode(typeof body?.code === "string" ? body.code : "");

  if (!isValidAffiliateCodeFormat(code)) {
    return NextResponse.json({ error: "Use 3–6 letters or numbers only." }, { status: 400 });
  }

  // Friendly pre-check — setAffiliateCode()'s own unique-constraint check
  // is what actually closes the race between two people saving the same
  // free code at the same instant; this just avoids a generic error for
  // the far more common case of typing a code someone already holds.
  const admin = createAdminClient();
  const { data: existing } = await admin.from("users").select("id").eq("affiliate_code", code).neq("id", user.id).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "That code is already taken — try another." }, { status: 409 });
  }

  try {
    const result = await setAffiliateCode(user.id, code);
    if (!result.ok) {
      return NextResponse.json({ error: "That code is already taken — try another." }, { status: 409 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not save your code." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, code });
}
