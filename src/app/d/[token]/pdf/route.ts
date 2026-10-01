import { createAdminClient } from "@/lib/supabase/server";
import { clientIp, openSharedPdf } from "@/lib/documents/publicShare";
import { PUBLIC_SHARE_HEADERS, uniformUnavailable } from "@/lib/documents/publicHeaders";

export const dynamic = "force-dynamic";

// PDF behind a share link. Same bytes as the owner's download. Every failure is the same uniform 404 (429 only when rate limited).
export async function GET(request: Request, { params }: { params: { token: string } }) {
  let out;
  try {
    out = await openSharedPdf(createAdminClient(), params.token, clientIp(request.headers));
  } catch {
    return uniformUnavailable(404);
  }
  if (out.kind === "limited") return uniformUnavailable(429);
  if (out.kind !== "ok") return uniformUnavailable(404);
  return new Response(out.result.pdf as unknown as BodyInit, {
    status: 200,
    headers: { ...PUBLIC_SHARE_HEADERS, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${out.result.filename}"` },
  });
}
