import { createClient } from "@/lib/supabase/server";
import { saveAffiliatePayoutMethod } from "@/lib/affiliate";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { method, details } = body;

  if (!["mobile_money", "paypal", "bank"].includes(method)) {
    return NextResponse.json({ error: "Choose a valid payout method." }, { status: 400 });
  }

  if (method === "mobile_money") {
    if (!details?.phone?.trim() || !["mtn", "orange"].includes(details?.provider)) {
      return NextResponse.json({ error: "A phone number and provider are required." }, { status: 400 });
    }
  } else if (method === "paypal") {
    if (!details?.email?.trim() || !details.email.includes("@")) {
      return NextResponse.json({ error: "A valid PayPal email is required." }, { status: 400 });
    }
  } else if (method === "bank") {
    if (!details?.accountName?.trim() || !details?.accountNumber?.trim() || !details?.bankName?.trim()) {
      return NextResponse.json({ error: "Account name, number, and bank name are required." }, { status: 400 });
    }
  }

  try {
    await saveAffiliatePayoutMethod(user.id, method, details);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not save payout method." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
