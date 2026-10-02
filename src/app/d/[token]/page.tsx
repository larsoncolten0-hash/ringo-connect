import type { Metadata } from "next";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { clientIp, openShare } from "@/lib/documents/publicShare";
import { translations } from "@/lib/i18n/translations";
import PublicDocumentView from "@/components/documents/PublicDocumentView";

// Public document page behind a share link. No Ringo account. The token is the only credential; every failure shows the same
// "unavailable" page. The title is generic (never the business or number), crawlers are told not to index, and the document is
// never cached. The customer's language is the document's own language; the unavailable page shows both languages.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Document",
  robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true },
  referrer: "no-referrer",
};

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-6 text-center last:mb-0">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-gray-600">{body}</p>
    </div>
  );
}

export default async function SharedDocumentPage({ params }: { params: { token: string } }) {
  let outcome: Awaited<ReturnType<typeof openShare>> = { kind: "unavailable" };
  try {
    outcome = await openShare(createAdminClient(), params.token, clientIp(headers()));
  } catch {
    outcome = { kind: "unavailable" };
  }

  if (outcome.kind === "ok") {
    return <PublicDocumentView model={outcome.model} pdfHref={`/d/${encodeURIComponent(params.token)}/pdf`} logoHref={outcome.model.branding.logoAssetId ? `/d/${encodeURIComponent(params.token)}/logo` : null} />;
  }
  const en = translations.en.documents.public;
  const fr = translations.fr.documents.public;
  const limited = outcome.kind === "limited";
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10 text-gray-900">
      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <Message title={limited ? fr.limitedTitle : fr.unavailableTitle} body={limited ? fr.limitedBody : fr.unavailableBody} />
        <Message title={limited ? en.limitedTitle : en.unavailableTitle} body={limited ? en.limitedBody : en.unavailableBody} />
      </div>
    </main>
  );
}
