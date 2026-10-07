import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/adminAudit";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, price_xaf, price_usd, required, show_on_affiliate_page } = await request.json().catch(() => ({}));
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { count } = await adminClient.from("addons").select("id", { count: "exact", head: true });

  const { data: created, error } = await adminClient.from("addons").insert({
    name: name.trim(),
    price_xaf: Number(price_xaf) || 0,
    price_usd: Number(price_usd) || 0,
    required: !!required,
    show_on_affiliate_page: show_on_affiliate_page !== false,
    sort_order: count || 0,
  }).select("id").maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // Who created which add-on (card) and at what price. Prices are catalogue data, not secrets.
  await recordAudit(adminClient, {
    actorId: admin.id,
    action: "addon_created",
    details: { addonId: created?.id ?? null, name: name.trim(), price_xaf: Number(price_xaf) || 0, price_usd: Number(price_usd) || 0, required: !!required },
  });
  return NextResponse.json({ ok: true });
}