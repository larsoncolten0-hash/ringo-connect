import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { extractRequestContext } from "@/lib/requestContext";
import { getPlatformSettings } from "@/lib/platformSettings";
import GetStartedFlow from "@/components/onboarding/GetStartedFlow";

export const dynamic = "force-dynamic";

export default async function GetStartedPage() {
  const supabase = createClient();

  // Temporarily restricted to the Business plan only — remove this
  // .eq() once other plans should be offered through this form again.
  const { data: plans } = await supabase
    .from("plans")
    .select("*")
    .eq("name", "business")
    .order("price_usd", { ascending: true });

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
    />
  );
}