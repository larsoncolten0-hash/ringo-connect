import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { extractRequestContext } from "@/lib/requestContext";
import { getPlatformSettings } from "@/lib/platformSettings";
import GetStartedFlow from "@/components/onboarding/GetStartedFlow";

// The dedicated "Ringo Card only" get-started link — see CardsLinkCard.tsx
// (rendered on /admin/addons) for where an admin copies this URL from.
// Unlike the public /get-started form's ?card=1 track (still there,
// unchanged, for the landing page's #pricing tab), a visitor who lands
// here never sees Personal/Business/plan picking at all — this link
// exists specifically so it can be shared on its own, with nothing else
// of the signup form attached. See GetStartedFlow.tsx's initialIntent
// comment for the "card_direct" vs "card_only" distinction.
export const dynamic = "force-dynamic";

export default async function GetStartedCardsPage() {
  const supabase = createClient();

  const { data: addons } = await supabase
    .from("addons")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true });

  const { country } = extractRequestContext(headers());
  const settings = await getPlatformSettings();

  return (
    <GetStartedFlow
      plans={[]}
      addons={addons || []}
      isCameroon={country === "CM"}
      allowPayNow={settings.allowCustomerPaymentAtSignup}
      manualPaymentName={settings.manualPaymentName}
      manualPaymentMtnNumber={settings.manualPaymentMtnNumber}
      manualPaymentOrangeNumber={settings.manualPaymentOrangeNumber}
      initialIntent="card_only"
    />
  );
}
