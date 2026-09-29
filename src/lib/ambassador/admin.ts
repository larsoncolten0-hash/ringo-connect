// Ambassador Program (Phase F) — Ringo Management read data.
//
// Same posture as the Ambassador/Team Leader dashboards: one server-only
// function per page, called directly from a server component (see
// src/app/admin/ambassadors/page.tsx), purely read-only. The actual
// mutating admin actions (create/activate/deactivate an Ambassador,
// create/reassign a team) live in real API routes
// (src/app/api/admin/ambassadors/**, src/app/api/admin/ambassador-teams/**)
// since — unlike the two read-only dashboards — Ringo Management
// genuinely needs to write here. Every one of those routes uses
// assertAdmin() and writes only to ambassador_profiles/ambassador_teams'
// own non-financial columns (status, team_id, name) — never to
// ambassador_sales, ambassador_commission_ledger, or ambassador_payouts,
// which stay exclusively the approved SQL functions' responsibility
// (Phase H). Bounded lists (LIMIT 100) — an internal tool, not yet
// paginated; noted as a known limitation, not a security concern.
import { createAdminClient } from "@/lib/supabase/server";
import { getAmbassadorPayoutMinimum } from "@/lib/ambassador/settings";

const LIST_LIMIT = 100;

export interface AdminAmbassadorRow {
  id: string;
  userId: string;
  username: string | null;
  salesCode: string;
  status: string;
  teamId: string | null;
  teamName: string | null;
  createdAt: string;
}

export interface AdminTeamRow {
  id: string;
  teamLeaderUserId: string;
  teamLeaderUsername: string | null;
  name: string;
  status: string;
  ambassadorCount: number;
}

export interface AdminSaleRow {
  id: string;
  ambassadorSalesCode: string;
  teamName: string | null;
  customerUsername: string | null;
  cardType: string;
  sellingPrice: number;
  status: string;
  attributedAt: string;
}

export interface AdminLedgerRow {
  id: string;
  saleId: string;
  recipientType: string;
  recipientUsername: string | null;
  milestone: string;
  entryType: string;
  status: string;
  commissionAmount: number;
  createdAt: string;
}

export interface AdminPayoutRow {
  id: string;
  recipientType: string;
  recipientUsername: string | null;
  amount: number;
  currency: string;
  status: string;
  payoutMethod: string;
  hasFapshiTransaction: boolean;
  disbursementAttempts: number;
  requestedAt: string;
}

export interface AdminActionRow {
  id: string;
  actorUsername: string | null;
  action: string;
  targetTable: string;
  targetId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface AmbassadorAdminOverview {
  ambassadors: AdminAmbassadorRow[];
  teams: AdminTeamRow[];
  sales: AdminSaleRow[];
  ledger: AdminLedgerRow[];
  payouts: AdminPayoutRow[];
  actions: AdminActionRow[];
  /** platform_settings.ambassador_min_payout_xaf — display/edit only; SQL enforces it. Null if unreadable. */
  minPayoutXaf: number | null;
}

export async function getAmbassadorAdminOverview(): Promise<AmbassadorAdminOverview> {
  const admin = createAdminClient();

  const [{ data: ambassadorRows }, { data: teamRows }, { data: saleRows }, { data: ledgerRows }, { data: payoutRows }, { data: actionRows }] = await Promise.all([
    admin.from("ambassador_profiles").select("id, user_id, sales_code, status, team_id, created_at").order("created_at", { ascending: false }).limit(LIST_LIMIT),
    admin.from("ambassador_teams").select("id, team_leader_user_id, name, status").order("name", { ascending: true }).limit(LIST_LIMIT),
    admin
      .from("ambassador_sales")
      .select("id, ambassador_id, team_id, customer_user_id, card_type, selling_price, status, attributed_at")
      .order("attributed_at", { ascending: false })
      .limit(LIST_LIMIT),
    admin
      .from("ambassador_commission_ledger")
      .select("id, sale_id, recipient_type, recipient_user_id, milestone, entry_type, status, commission_amount, created_at")
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT),
    admin.from("ambassador_payouts").select("id, recipient_type, recipient_user_id, amount, currency, status, payout_method, fapshi_trans_id, disbursement_attempts, requested_at").order("requested_at", { ascending: false }).limit(LIST_LIMIT),
    admin.from("ambassador_admin_actions").select("id, actor_user_id, action, target_table, target_id, reason, created_at").order("created_at", { ascending: false }).limit(LIST_LIMIT),
  ]);

  const ambassadors = ambassadorRows || [];
  const teams = teamRows || [];
  const sales = saleRows || [];
  const ledger = ledgerRows || [];
  const payouts = payoutRows || [];
  const actions = actionRows || [];

  // One batched profiles lookup for every user id referenced anywhere
  // above (ambassador owners, team leaders, sale customers, ledger/action
  // actors) — usernames only, for display.
  const userIds = new Set<string>();
  for (const a of ambassadors) userIds.add(a.user_id);
  for (const t of teams) userIds.add(t.team_leader_user_id);
  for (const s of sales) if (s.customer_user_id) userIds.add(s.customer_user_id);
  for (const l of ledger) userIds.add(l.recipient_user_id);
  for (const p of payouts) userIds.add(p.recipient_user_id);
  for (const a of actions) if (a.actor_user_id) userIds.add(a.actor_user_id);
  const { data: profileRows } = userIds.size ? await admin.from("profiles").select("user_id, username").in("user_id", Array.from(userIds)) : { data: [] as any[] };
  const usernameByUserId = new Map((profileRows || []).map((p: any) => [p.user_id, p.username as string]));

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const ambassadorById = new Map(ambassadors.map((a) => [a.id, a]));
  const ambassadorCountByTeam = new Map<string, number>();
  for (const a of ambassadors) if (a.team_id) ambassadorCountByTeam.set(a.team_id, (ambassadorCountByTeam.get(a.team_id) || 0) + 1);

  return {
    ambassadors: ambassadors.map((a) => ({
      id: a.id,
      userId: a.user_id,
      username: usernameByUserId.get(a.user_id) ?? null,
      salesCode: a.sales_code,
      status: a.status,
      teamId: a.team_id,
      teamName: a.team_id ? teamById.get(a.team_id)?.name ?? null : null,
      createdAt: a.created_at,
    })),
    teams: teams.map((t) => ({
      id: t.id,
      teamLeaderUserId: t.team_leader_user_id,
      teamLeaderUsername: usernameByUserId.get(t.team_leader_user_id) ?? null,
      name: t.name,
      status: t.status,
      ambassadorCount: ambassadorCountByTeam.get(t.id) || 0,
    })),
    sales: sales.map((s) => ({
      id: s.id,
      ambassadorSalesCode: ambassadorById.get(s.ambassador_id)?.sales_code ?? "—",
      teamName: s.team_id ? teamById.get(s.team_id)?.name ?? null : null,
      customerUsername: s.customer_user_id ? usernameByUserId.get(s.customer_user_id) ?? null : null,
      cardType: s.card_type,
      sellingPrice: Number(s.selling_price),
      status: s.status,
      attributedAt: s.attributed_at,
    })),
    ledger: ledger.map((l) => ({
      id: l.id,
      saleId: l.sale_id,
      recipientType: l.recipient_type,
      recipientUsername: usernameByUserId.get(l.recipient_user_id) ?? null,
      milestone: l.milestone,
      entryType: l.entry_type,
      status: l.status,
      commissionAmount: Number(l.commission_amount),
      createdAt: l.created_at,
    })),
    payouts: payouts.map((p) => ({
      id: p.id,
      recipientType: p.recipient_type,
      recipientUsername: usernameByUserId.get(p.recipient_user_id) ?? null,
      amount: Number(p.amount),
      currency: p.currency,
      status: p.status,
      payoutMethod: p.payout_method,
      hasFapshiTransaction: !!p.fapshi_trans_id,
      disbursementAttempts: Number(p.disbursement_attempts) || 0,
      requestedAt: p.requested_at,
    })),
    actions: actions.map((a) => ({
      id: a.id,
      actorUsername: a.actor_user_id ? usernameByUserId.get(a.actor_user_id) ?? null : null,
      action: a.action,
      targetTable: a.target_table,
      targetId: a.target_id,
      reason: a.reason,
      createdAt: a.created_at,
    })),
    minPayoutXaf: await getAmbassadorPayoutMinimum(admin),
  };
}
