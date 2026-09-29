// Ambassador Program (Phase E) — the Team Leader's own dashboard data.
//
// Same shape and posture as src/lib/ambassador/dashboard.ts (Phase D):
// one server-only function, resolved entirely from the caller's own
// session identity, no API route, purely read-only. The one
// architecturally important difference: every query here is scoped by
// the TEAM's historically-snapshotted sales (ambassador_sales.team_id,
// and commission ledger rows joined through those exact sale ids) —
// never by an ambassador's CURRENT team_id. A sale (and its commission)
// that happened while an Ambassador was on this team stays this team's,
// permanently, even if that Ambassador is later reassigned elsewhere.
// This isn't a computed rule in this file — it falls straight out of
// querying ambassador_sales.team_id directly, exactly like the approved
// SQL schema intends.
import { createAdminClient } from "@/lib/supabase/server";
import { stageFor, nextActionFor, cardTierKey, type AmbassadorSaleStage, type AmbassadorNextAction } from "@/lib/ambassador/stage";

export interface TeamSaleView {
  id: string;
  ambassadorId: string;
  ambassadorSalesCode: string;
  cardType: string;
  sellingPrice: number;
  status: string;
  stage: AmbassadorSaleStage;
  attributedAt: string;
  customer: { name: string | null; whatsapp: string | null } | null;
}

export interface TeamFollowUpItem {
  saleId: string;
  ambassadorSalesCode: string;
  customerName: string | null;
  whatsapp: string | null;
  stage: AmbassadorSaleStage;
  nextAction: AmbassadorNextAction;
}

export interface TeamAmbassadorPerformance {
  ambassadorId: string;
  salesCode: string;
  status: string;
  cardsSold: number;
  revenue: number;
  registeredCount: number;
  activatedCount: number;
  activationRate: number;
  commissionEarned: number;
  commissionPaid: number;
}

export interface TeamOverview {
  team: { id: string; name: string; status: string };
  ambassadorCount: number;
  activeAmbassadorCount: number;
  summary: {
    cardsSold: number;
    revenueAttributed: number;
    // The Team Leader's OWN commission (recipient_type='team_leader') —
    // never the Ambassadors' own 15%, which belongs to them, not the
    // Team Leader. See TeamAmbassadorPerformance for per-Ambassador
    // visibility into that instead.
    teamLeaderCommissionEarned: number;
    teamLeaderCommissionEligible: number;
    teamLeaderCommissionPaid: number;
    teamLeaderCommissionReversed: number;
  };
  ambassadors: TeamAmbassadorPerformance[];
  sales: TeamSaleView[];
  followUp: TeamFollowUpItem[];
}

export async function getMyTeamOverview(userId: string): Promise<TeamOverview | null> {
  const admin = createAdminClient();

  const { data: team } = await admin
    .from("ambassador_teams")
    .select("id, name, status")
    .eq("team_leader_user_id", userId)
    .maybeSingle();
  if (!team) return null;

  const { data: ambassadorRows } = await admin
    .from("ambassador_profiles")
    .select("id, user_id, sales_code, status")
    .eq("team_id", team.id);
  const ambassadors = ambassadorRows || [];
  const ambassadorById = new Map(ambassadors.map((a) => [a.id, a]));

  // The team's own historically-snapshotted sales — this, not the
  // ambassadors' current team_id, is what "belongs to this team" means.
  const { data: salesRows } = await admin
    .from("ambassador_sales")
    .select("id, ambassador_id, card_type, selling_price, status, attributed_at, customer_user_id")
    .eq("team_id", team.id)
    .order("attributed_at", { ascending: false });
  const sales = salesRows || [];
  const saleIds = sales.map((s) => s.id);

  const customerUserIds = sales.map((s) => s.customer_user_id).filter((id): id is string => !!id);
  const { data: customerProfiles } = customerUserIds.length
    ? await admin.from("profiles").select("user_id, name, username, whatsapp_number").in("user_id", customerUserIds)
    : { data: [] as any[] };
  const customerByUserId = new Map((customerProfiles || []).map((p: any) => [p.user_id, p]));

  const activationByUserId = new Map<string, { profileComplete: boolean; pwaInstalled: boolean }>();
  const needsActivationCheck = sales.filter((s) => s.status === "milestone_1_earned" && s.customer_user_id);
  for (const s of needsActivationCheck) {
    const { data: statusResult } = await admin.rpc("ambassador_activation_status", { p_user_id: s.customer_user_id });
    if (statusResult) {
      activationByUserId.set(s.customer_user_id as string, {
        profileComplete: !!statusResult.profile_complete,
        pwaInstalled: !!statusResult.pwa_installed,
      });
    }
  }

  const saleViews: TeamSaleView[] = sales.map((s) => {
    const activation = s.customer_user_id ? activationByUserId.get(s.customer_user_id) ?? null : null;
    const stage = stageFor(s.status, activation);
    const customer = s.customer_user_id ? customerByUserId.get(s.customer_user_id) : null;
    const ambassador = ambassadorById.get(s.ambassador_id);
    return {
      id: s.id,
      ambassadorId: s.ambassador_id,
      ambassadorSalesCode: ambassador?.sales_code ?? "—",
      cardType: s.card_type,
      sellingPrice: Number(s.selling_price),
      status: s.status,
      stage,
      attributedAt: s.attributed_at,
      customer: customer ? { name: customer.name || customer.username || null, whatsapp: customer.whatsapp_number || null } : null,
    };
  });

  // Commission ledger — joined through THIS TEAM's sale ids specifically
  // (not merely "this ambassador's user id"), so an Ambassador's
  // commission from a prior team assignment never bleeds into this
  // team's totals or performance figures.
  const { data: ledgerRows } = saleIds.length
    ? await admin.from("ambassador_commission_ledger").select("sale_id, recipient_type, recipient_user_id, status, entry_type, commission_amount").in("sale_id", saleIds)
    : { data: [] as any[] };
  const ledger = ledgerRows || [];

  const teamLeaderRows = ledger.filter((r: any) => r.recipient_type === "team_leader" && r.recipient_user_id === userId && r.entry_type === "commission");
  const summary = {
    cardsSold: 0,
    revenueAttributed: 0,
    teamLeaderCommissionEarned: teamLeaderRows.filter((r: any) => r.status === "earned").reduce((sum: number, r: any) => sum + Number(r.commission_amount), 0),
    teamLeaderCommissionEligible: teamLeaderRows.filter((r: any) => r.status === "eligible_for_payout").reduce((sum: number, r: any) => sum + Number(r.commission_amount), 0),
    teamLeaderCommissionPaid: teamLeaderRows.filter((r: any) => r.status === "paid").reduce((sum: number, r: any) => sum + Number(r.commission_amount), 0),
    teamLeaderCommissionReversed: ledger
      .filter((r: any) => r.recipient_type === "team_leader" && r.recipient_user_id === userId && r.entry_type === "reversal")
      .reduce((sum: number, r: any) => sum + Math.abs(Number(r.commission_amount)), 0),
  };

  const soldStatuses = new Set(["locked", "milestone_1_earned", "milestone_2_earned"]);
  const soldSales = sales.filter((s) => soldStatuses.has(s.status));
  summary.cardsSold = soldSales.length;
  summary.revenueAttributed = soldSales.reduce((sum, s) => sum + Number(s.selling_price), 0);

  const registeredStatuses = new Set(["milestone_1_earned", "milestone_2_earned"]);
  const ambassadorPerformance: TeamAmbassadorPerformance[] = ambassadors.map((a) => {
    const ownSales = sales.filter((s) => s.ambassador_id === a.id);
    const ownSold = ownSales.filter((s) => soldStatuses.has(s.status));
    const registeredCount = ownSales.filter((s) => registeredStatuses.has(s.status)).length;
    const activatedCount = ownSales.filter((s) => s.status === "milestone_2_earned").length;
    const ownLedger = ledger.filter((r: any) => r.recipient_type === "ambassador" && r.recipient_user_id === a.user_id && r.entry_type === "commission");
    return {
      ambassadorId: a.id,
      salesCode: a.sales_code,
      status: a.status,
      cardsSold: ownSold.length,
      revenue: ownSold.reduce((sum, s) => sum + Number(s.selling_price), 0),
      registeredCount,
      activatedCount,
      activationRate: registeredCount > 0 ? activatedCount / registeredCount : 0,
      commissionEarned: ownLedger.filter((r: any) => r.status === "earned").reduce((sum: number, r: any) => sum + Number(r.commission_amount), 0),
      commissionPaid: ownLedger.filter((r: any) => r.status === "paid").reduce((sum: number, r: any) => sum + Number(r.commission_amount), 0),
    };
  });

  const followUp: TeamFollowUpItem[] = saleViews
    .filter((s) => !["fully_activated", "disputed", "voided", "refunded"].includes(s.stage))
    .map((s) => ({
      saleId: s.id,
      ambassadorSalesCode: s.ambassadorSalesCode,
      customerName: s.customer?.name ?? null,
      whatsapp: s.customer?.whatsapp ?? null,
      stage: s.stage,
      nextAction: nextActionFor(s.stage),
    }));

  return {
    team: { id: team.id, name: team.name, status: team.status },
    ambassadorCount: ambassadors.length,
    activeAmbassadorCount: ambassadors.filter((a) => a.status === "active").length,
    summary,
    ambassadors: ambassadorPerformance,
    sales: saleViews,
    followUp,
  };
}
