// Ambassador Program (Phase D) — the Ambassador's own dashboard data.
//
// Mirrors src/lib/affiliate.ts's getMyAffiliateOverview() shape exactly:
// one server-only function, resolved entirely from the caller's own
// session identity (never a client-supplied id anywhere), returning null
// when the signed-in person isn't an Ambassador at all. No API route
// exists for this — src/app/dashboard/ambassador/page.tsx calls it
// directly, server-side, the same way /dashboard/affiliate/page.tsx
// already does for the legacy affiliate dashboard. Purely read-only:
// nothing here writes to any table.
import { createAdminClient } from "@/lib/supabase/server";
import { stageFor, nextActionFor, cardTierKey, type AmbassadorSaleStage, type AmbassadorNextAction } from "@/lib/ambassador/stage";

// Re-exported for backward compatibility with existing imports
// (src/components/dashboard/AmbassadorDashboardView.tsx) — the real
// definitions now live in stage.ts, shared with the Team Leader dashboard.
export type { AmbassadorSaleStage };

export interface AmbassadorSaleView {
  id: string;
  cardType: string;
  sellingPrice: number;
  status: string;
  stage: AmbassadorSaleStage;
  attributedAt: string;
  // Only ever populated for THIS ambassador's own attributed sale — see
  // the dashboard.ts module comment. Name/WhatsApp only, for follow-up
  // purposes; no email, no account credentials, nothing else.
  customer: { name: string | null; whatsapp: string | null } | null;
  activation: { profileComplete: boolean; pwaInstalled: boolean } | null;
  milestone1Earned: boolean;
  milestone2Earned: boolean;
}

export interface AmbassadorFollowUpItem {
  saleId: string;
  customerName: string | null;
  whatsapp: string | null;
  stage: AmbassadorSaleStage;
  nextAction: AmbassadorNextAction;
}

export interface AmbassadorOverview {
  ambassador: { id: string; salesCode: string; status: string; teamName: string | null };
  summary: {
    cardsSold: number;
    standardCount: number;
    proCount: number;
    premiumCount: number;
    revenueAttributed: number;
    commissionEarned: number;
    commissionEligible: number;
    commissionPaid: number;
    commissionReversed: number;
  };
  sales: AmbassadorSaleView[];
  followUp: AmbassadorFollowUpItem[];
}

export async function getMyAmbassadorOverview(userId: string): Promise<AmbassadorOverview | null> {
  const admin = createAdminClient();

  const { data: ambassador } = await admin
    .from("ambassador_profiles")
    .select("id, sales_code, status, team_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!ambassador) return null;

  let teamName: string | null = null;
  if (ambassador.team_id) {
    const { data: team } = await admin.from("ambassador_teams").select("name").eq("id", ambassador.team_id).maybeSingle();
    teamName = team?.name ?? null;
  }

  const { data: salesRows } = await admin
    .from("ambassador_sales")
    .select("id, card_type, selling_price, status, attributed_at, customer_user_id")
    .eq("ambassador_id", ambassador.id)
    .order("attributed_at", { ascending: false });
  const sales = salesRows || [];

  // Customer name/whatsapp — only for THIS ambassador's own attributed
  // sales, resolved from `profiles` by the sale's own customer_user_id
  // (never a client-supplied id). Batched into one query, not N.
  const customerUserIds = sales.map((s) => s.customer_user_id).filter((id): id is string => !!id);
  const { data: customerProfiles } = customerUserIds.length
    ? await admin.from("profiles").select("user_id, name, username, whatsapp_number").in("user_id", customerUserIds)
    : { data: [] as any[] };
  const customerByUserId = new Map((customerProfiles || []).map((p: any) => [p.user_id, p]));

  // Activation breakdown — only for sales that have actually reached
  // Milestone 1 (registration complete); the sole authority on this is
  // the database's own ambassador_activation_status(), never re-derived here.
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

  const saleViews: AmbassadorSaleView[] = sales.map((s) => {
    const activation = s.customer_user_id ? activationByUserId.get(s.customer_user_id) ?? null : null;
    const stage = stageFor(s.status, activation);
    const customer = s.customer_user_id ? customerByUserId.get(s.customer_user_id) : null;
    return {
      id: s.id,
      cardType: s.card_type,
      sellingPrice: Number(s.selling_price),
      status: s.status,
      stage,
      attributedAt: s.attributed_at,
      customer: customer ? { name: customer.name || customer.username || null, whatsapp: customer.whatsapp_number || null } : null,
      activation,
      milestone1Earned: s.status === "milestone_1_earned" || s.status === "milestone_2_earned",
      milestone2Earned: s.status === "milestone_2_earned",
    };
  });

  const soldStatuses = new Set(["locked", "milestone_1_earned", "milestone_2_earned"]);
  const soldSales = sales.filter((s) => soldStatuses.has(s.status));
  const summary = {
    cardsSold: soldSales.length,
    standardCount: soldSales.filter((s) => cardTierKey(s.card_type) === "standard").length,
    proCount: soldSales.filter((s) => cardTierKey(s.card_type) === "pro").length,
    premiumCount: soldSales.filter((s) => cardTierKey(s.card_type) === "premium").length,
    revenueAttributed: soldSales.reduce((sum, s) => sum + Number(s.selling_price), 0),
    commissionEarned: 0,
    commissionEligible: 0,
    commissionPaid: 0,
    commissionReversed: 0,
  };

  // Commission totals come from the ledger — the source of truth — never
  // recomputed from card prices/percentages here.
  const { data: ledgerRows } = await admin
    .from("ambassador_commission_ledger")
    .select("status, entry_type, commission_amount")
    .eq("recipient_user_id", userId)
    .eq("recipient_type", "ambassador");
  for (const row of ledgerRows || []) {
    const amount = Number(row.commission_amount);
    if (row.entry_type === "reversal") {
      summary.commissionReversed += Math.abs(amount);
      continue;
    }
    if (row.status === "earned") summary.commissionEarned += amount;
    else if (row.status === "eligible_for_payout") summary.commissionEligible += amount;
    else if (row.status === "paid") summary.commissionPaid += amount;
  }

  const followUp: AmbassadorFollowUpItem[] = saleViews
    .filter((s) => !["fully_activated", "disputed", "voided", "refunded"].includes(s.stage))
    .map((s) => ({
      saleId: s.id,
      customerName: s.customer?.name ?? null,
      whatsapp: s.customer?.whatsapp ?? null,
      stage: s.stage,
      nextAction: nextActionFor(s.stage),
    }));

  return {
    ambassador: { id: ambassador.id, salesCode: ambassador.sales_code, status: ambassador.status, teamName },
    summary,
    sales: saleViews,
    followUp,
  };
}
