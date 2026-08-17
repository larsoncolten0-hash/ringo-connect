import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, price_xaf, price_usd, required } = await request.json().catch(() => ({}));
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { count } = await adminClient.from("addons").select("id", { count: "exact", head: true });

  const { error } = await adminClient.from("addons").insert({
    name: name.trim(),
    price_xaf: Number(price_xaf) || 0,
    price_usd: Number(price_usd) || 0,
    required: !!required,
    sort_order: count || 0,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}