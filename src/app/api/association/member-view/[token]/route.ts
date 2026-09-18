import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { hashToken } from "@/lib/association/tokens";

// GET /api/association/member-view/[token] — public, token-scoped by
// design, same reasoning as /api/community/manage/[token]: a Member has no
// Ringo account, so this is the only way they can see their own balance and
// history. The token is never stored raw (only its SHA-256 hash,
// association_members.access_token_hash) and grants read-only access to
// exactly the one Member row it was issued for — nothing else.
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient();
  const tokenHash = hashToken(params.token);

  const { data: member } = await admin
    .from("association_members")
    .select("id, name, points_balance, status, profiles!association_members_association_profile_id_fkey(name, username)")
    .eq("access_token_hash", tokenHash)
    .maybeSingle();

  if (!member) return NextResponse.json({ code: "not_found", error: "Not found." }, { status: 404 });

  const { data: transactions } = await admin
    .from("association_point_transactions")
    .select("type, amount_xaf, points_delta, created_at, association_rewards(name)")
    .eq("member_id", member.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const association = member.profiles as any;
  return NextResponse.json({
    name: member.name,
    pointsBalance: member.points_balance,
    status: member.status,
    associationName: association?.name || association?.username,
    transactions: (transactions || []).map((t: any) => ({
      type: t.type,
      amountXaf: t.amount_xaf,
      pointsDelta: t.points_delta,
      createdAt: t.created_at,
      rewardName: t.association_rewards?.name || null,
    })),
  });
}
