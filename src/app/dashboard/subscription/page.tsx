import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import SubscriptionView from "@/components/subscription/SubscriptionView";

export default async function SubscriptionPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: userRow } = await supabase
    .from("users")
    .select("plans(name), payment_provider, plan_expires_at")
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

  return (
    <SubscriptionView
      plans={plans || []}
      currentPlan={(userRow?.plans as any)?.name ?? "free"}
      paymentProvider={userRow?.payment_provider ?? null}
      planExpiresAt={userRow?.plan_expires_at ?? null}
      defaultMethod={country === "CM" ? "mobile_money" : "card"}
    />
  );
}