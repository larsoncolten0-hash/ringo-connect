import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { clientIp } from "@/lib/smartCards/ids";
import { scanCard } from "@/lib/smartCards/scan";
import { translations } from "@/lib/i18n/translations";
import CardClaim from "@/components/smartCard/CardClaim";

// What a Ringo Smart Card's QR code opens. The token is the only credential. Unknown, malformed and switched-off cards all show the SAME
// "unavailable" page. A claimed card redirects to its owner's CURRENT public profile (looked up now; nothing about the owner is in the QR).
// An unclaimed card shows the claim page: the visitor must sign in before anything can be claimed. The page is never cached, never indexed,
// and never sent onward as a referrer (also set for the whole /c/ path in next.config.js).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Ringo Card",
  robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true },
  referrer: "no-referrer",
};

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-6 text-center last:mb-0">
      <h1 className="text-lg font-semibold text-ringo-text">{title}</h1>
      <p className="mt-2 text-sm text-ringo-muted">{body}</p>
    </div>
  );
}

export default async function SmartCardPage({ params }: { params: { token: string } }) {
  let outcome: Awaited<ReturnType<typeof scanCard>> = { kind: "unavailable" };
  try {
    outcome = await scanCard(createAdminClient(), params.token, clientIp(headers()));
  } catch {
    outcome = { kind: "unavailable" };
  }

  if (outcome.kind === "claimed") redirect(`/${encodeURIComponent(outcome.username)}`);

  if (outcome.kind === "unclaimed") {
    let profiles: { id: string; username: string; name: string | null }[] = [];
    let signedIn = false;
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        signedIn = true;
        const res = await supabase.from("profiles").select("id, username, name").eq("user_id", data.user.id).order("created_at", { ascending: true });
        profiles = (res.data as any[]) || [];
      }
    } catch {
      signedIn = false;
    }
    return <CardClaim token={params.token} serial={outcome.serial} signedIn={signedIn} profiles={profiles} />;
  }

  const en = translations.en.smartCard;
  const fr = translations.fr.smartCard;
  const limited = outcome.kind === "limited";
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FAFAF8] px-4 py-10">
      <div className="max-w-md rounded-2xl border border-ringo-border bg-white p-6 shadow-sm">
        <Notice title={limited ? fr.limitedTitle : fr.unavailableTitle} body={limited ? fr.limitedBody : fr.unavailableBody} />
        <Notice title={limited ? en.limitedTitle : en.unavailableTitle} body={limited ? en.limitedBody : en.unavailableBody} />
      </div>
    </main>
  );
}
