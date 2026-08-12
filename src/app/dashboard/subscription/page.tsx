import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getPlatformSettings } from "@/lib/platformSettings";
import SubscriptionView from "@/components/subscription/SubscriptionView";

// See src/app/admin/settings/page.tsx for why this matters — especially
// here, since showing a stale plan/payment status after an upgrade or
// cancellation would be actively misleading, not just inconvenient.
export const dynamic = "force-dynamic";

export default async function SubscriptionPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: userRow } = await supabase
    .from("users")
    .select("plans(name), payment_provider, plan_expires_at, billing_interval")
    .eq("id", user.id)
    .single();

  const { data: plans } = await supabase
    .from("plans")
    .select("*")
    .order("max_links", { ascending: true, nullsFirst: false });

  // Same Vercel geo header used for analytics — here it just pre-selects
  // the likelier payment method (Mobile Money for Cameroon, Card
  // otherwise). The person can still switch either way in the modal.
  const country = headers().get("x-vercel-ip-country");
  const settings = await getPlatformSettings();

  let defaultMethod: "mobile_money" | "card" = country === "CM" ? "mobile_money" : "card";
  // If geo suggests a provider the admin has turned off, fall back to
  // whichever one is actually enabled instead of defaulting to a dead option.
  if (defaultMethod === "mobile_money" && !settings.fapshiEnabled) defaultMethod = "card";
  if (defaultMethod === "card" && !settings.stripeEnabled) defaultMethod = "mobile_money";

  return (
    <SubscriptionView
      plans={plans || []}
      currentPlan={(userRow?.plans as any)?.name ?? "free"}
      currentInterval={userRow?.billing_interval === "yearly" ? "yearly" : "monthly"}
      paymentProvider={userRow?.payment_provider ?? null}
      planExpiresAt={userRow?.plan_expires_at ?? null}
      defaultMethod={defaultMethod}
      isCameroon={country === "CM"}
      fapshiEnabled={settings.fapshiEnabled}
      stripeEnabled={settings.stripeEnabled}
    />
  );
}