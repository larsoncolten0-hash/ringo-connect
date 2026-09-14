import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { extractRequestContext } from "@/lib/requestContext";
import { getPlatformSettings } from "@/lib/platformSettings";
import GetStartedFlow from "@/components/onboarding/GetStartedFlow";

export const dynamic = "force-dynamic";

export default async function GetStartedPage({
  searchParams,
}: {
  // ?plan=<plan name> — set by the landing page's #pricing section (see
  // PricingSection.tsx) when a visitor picks a specific plan before ever
  // reaching this form. Resolved server-side into a real plan row (never
  // trusted as anything more than "which one to pre-highlight") and
  // handed to GetStartedFlow, which still lets them change their mind —
  // see that component's own comment on preselectedPlan.
  searchParams: { plan?: string };
}) {
  const supabase = createClient();

  // All 5 plans now (free/basic/pro/business_basic/business_pro) — this
  // used to be filtered to the Business plan alone while the rest of this
  // flow had nowhere to offer them; that's exactly what this task restores.
  const { data: plans } = await supabase.from("plans").select("*").order("price_usd", { ascending: true });

  const preselectedPlan = searchParams.plan ? (plans || []).find((p) => p.name === searchParams.plan) || null : null;

  const { data: addons } = await supabase
    .from("addons")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  const { country } = extractRequestContext(headers());
  const settings = await getPlatformSettings();

  return (
    <GetStartedFlow
      plans={plans || []}
      addons={addons || []}
      isCameroon={country === "CM"}
      allowPayNow={settings.allowCustomerPaymentAtSignup}
      manualPaymentName={settings.manualPaymentName}
      manualPaymentMtnNumber={settings.manualPaymentMtnNumber}
      manualPaymentOrangeNumber={settings.manualPaymentOrangeNumber}
      preselectedPlan={preselectedPlan}
    />
  );
}