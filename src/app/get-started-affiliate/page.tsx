import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import Link from "next/link";
import Image from "next/image";
import { extractRequestContext } from "@/lib/requestContext";
import { getPlatformSettings } from "@/lib/platformSettings";
import GetStartedFlow from "@/components/onboarding/GetStartedFlow";

// The dedicated landing/checkout page for partnered affiliate marketers'
// own links (e.g. ringoconnectltd.com/get-started-affiliate?ref=CODE).
// Unlike the public /get-started form, payment here is mandatory — there
// is no "submit without paying, admin follows up" path — and every plan
// is offered, not just the one the public form is temporarily limited to.
export const dynamic = "force-dynamic";

export default async function GetStartedAffiliatePage() {
  const supabase = createClient();

  // Free is excluded — payment is mandatory on this page, and there's
  // nothing to charge for a $0 plan (see the "nothing to pay" guard in
  // /api/signup-requests/[id]/pay).
  const { data: plans } = await supabase
    .from("plans")
    .select("*")
    .neq("name", "free")
    .order("price_usd", { ascending: true });

  // Curated independently of the public form's add-on list — an admin
  // may want a different (or empty) set shown to partner-driven traffic.
  const { data: addons } = await supabase
    .from("addons")
    .select("*")
    .eq("active", true)
    .eq("show_on_affiliate_page", true)
    .order("sort_order", { ascending: true });

  const { country } = extractRequestContext(headers());
  const settings = await getPlatformSettings();

  if (!settings.fapshiEnabled) {
    return (
      <div className="min-h-screen bg-ringo-bg text-ringo-text flex flex-col items-center justify-center px-4 text-center gap-4">
        <Image src="/logo.png" alt="" width={32} height={32} className="rounded-md" />
        <p className="text-sm text-ringo-muted max-w-xs">
          Online payments aren't available right now — please check back shortly.
        </p>
        <Link href="/" className="text-sm text-ringo-indigo font-medium">
          Back home
        </Link>
      </div>
    );
  }

  return (
    <GetStartedFlow
      plans={plans || []}
      addons={addons || []}
      isCameroon={country === "CM"}
      allowPayNow={true}
      manualPaymentName={settings.manualPaymentName}
      manualPaymentMtnNumber={settings.manualPaymentMtnNumber}
      manualPaymentOrangeNumber={settings.manualPaymentOrangeNumber}
      variant="affiliate"
    />
  );
}
