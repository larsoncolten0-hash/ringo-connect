import { createClient } from "@/lib/supabase/server";
import { getMyAffiliateOverview } from "@/lib/affiliate";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const overview = await getMyAffiliateOverview();
  if (!overview) return NextResponse.json({ error: "Affiliate data not available yet" }, { status: 503 });

  return NextResponse.json({ overview });
}
