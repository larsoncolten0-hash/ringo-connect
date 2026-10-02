import { createAdminClient } from "@/lib/supabase/server";
import { clientIp, openSharedLogo } from "@/lib/documents/publicShare";
import { PUBLIC_SHARE_HEADERS, uniformUnavailable } from "@/lib/documents/publicHeaders";

export const dynamic = "force-dynamic";

// The business logo of a shared document: the document's own FROZEN copy (referenced by its seller snapshot), never the live profile picture. Same token rules as
// the page and the PDF: every failure is the same uniform 404 (429 only when rate limited).
export async function GET(request: Request, { params }: { params: { token: string } }) {
  let out;
  try {
    out = await openSharedLogo(createAdminClient(), params.token, clientIp(request.headers));
  } catch {
    return uniformUnavailable(404);
  }
  if (out.kind === "limited") return uniformUnavailable(429);
  if (out.kind !== "ok") return uniformUnavailable(404);
  return new Response(out.bytes as unknown as BodyInit, { status: 200, headers: { ...PUBLIC_SHARE_HEADERS, "Content-Type": out.contentType } });
}
