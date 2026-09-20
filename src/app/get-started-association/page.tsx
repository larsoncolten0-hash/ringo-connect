import { notFound } from "next/navigation";
import { ASSOCIATION_PUBLIC } from "@/lib/association/publicVisibility";
import { createClient } from "@/lib/supabase/server";
import { getPlatformSettings } from "@/lib/platformSettings";
import AssociationGetStartedFlow from "@/components/association/AssociationGetStartedFlow";

export const dynamic = "force-dynamic";

// A separate, dedicated entry point for the Association Program — not a
// fourth branch on GetStartedFlow.tsx's own account-type step (already an
// intricate state machine by its own comments; this keeps that file
// completely untouched). Association tiers are Mobile-Money-only in v1
// (see the migration's own PAYMENT NOTE) — no Stripe/card branching needed
// here at all, unlike the main Subscription page.
export default async function GetStartedAssociationPage() {
  if (!ASSOCIATION_PUBLIC) notFound();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: plans } = await supabase
    .from("plans")
    .select("*")
    .eq("association_enabled", true)
    .order("max_association_members", { ascending: true, nullsFirst: false });

  const settings = await getPlatformSettings();

  let currentPlanName: string | null = null;
  if (user) {
    const { data: userRow } = await supabase.from("users").select("plans(name)").eq("id", user.id).maybeSingle();
    currentPlanName = (userRow?.plans as any)?.name ?? null;
  }

  return (
    <AssociationGetStartedFlow
      isAuthenticated={!!user}
      plans={plans || []}
      fapshiEnabled={settings.fapshiEnabled}
      currentPlanName={currentPlanName}
    />
  );
}
