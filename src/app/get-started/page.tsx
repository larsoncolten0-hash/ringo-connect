import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { extractRequestContext } from "@/lib/requestContext";
import GetStartedFlow from "@/components/onboarding/GetStartedFlow";

export const dynamic = "force-dynamic";

export default async function GetStartedPage() {
  const supabase = createClient();
  const { data: plans } = await supabase
    .from("plans")
    .select("*")
    .order("price_usd", { ascending: true });

  const { data: addons } = await supabase
    .from("addons")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  const { country } = extractRequestContext(headers());

  return <GetStartedFlow plans={plans || []} addons={addons || []} isCameroon={country === "CM"} />;
}