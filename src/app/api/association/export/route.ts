import { NextResponse } from "next/server";
import { requireAssociationAccessJson } from "@/lib/association/access";

// GET /api/association/export?associationProfileId=... — the monthly CSV
// export of all activity across the whole Association. Owner only (no
// precedent for CSV export elsewhere in this codebase, so this follows
// standard CSV conventions: comma-separated, double-quote-wrapped fields
// with any embedded quote doubled).
function csvField(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const associationProfileId = searchParams.get("associationProfileId");
  if (!associationProfileId) return NextResponse.json({ error: "associationProfileId is required." }, { status: 400 });

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { data, error } = await supabase
    .from("association_point_transactions")
    .select(
      "created_at, type, amount_xaf, points_delta, association_members(name, phone), association_rewards(name), profiles!association_point_transactions_partner_profile_id_fkey(username, name)"
    )
    .eq("association_profile_id", associationProfileId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ code: "server_error", error: "Could not load transactions." }, { status: 500 });

  const rows = [
    ["Date", "Type", "Member", "Member phone", "Partner", "Amount (XAF)", "Points", "Reward"].map(csvField).join(","),
    ...(data || []).map((t: any) =>
      [
        t.created_at,
        t.type,
        t.association_members?.name || "",
        t.association_members?.phone || "",
        t.profiles?.name || t.profiles?.username || "",
        t.amount_xaf ?? "",
        t.points_delta,
        t.association_rewards?.name || "",
      ]
        .map(csvField)
        .join(",")
    ),
  ];

  const csv = rows.join("\r\n");
  const filename = `association-activity-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
