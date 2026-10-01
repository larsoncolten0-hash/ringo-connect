// Shared plumbing for the /api/documents/** routes: owner resolution (the same owner-only gate as bookkeeping: session user, own
// profile, Business & E-commerce category, plan flag, not a demo), JSON body reading, and building the Response.
// The business is ALWAYS the caller's own profile, resolved from the session — no route reads a business id from the request.
import { NextResponse } from "next/server";
import { resolveBookkeepingOwner } from "@/lib/bookkeeping/access";
import { denialResponse } from "@/lib/bookkeeping/http";
import type { ApiResult, DocOwner } from "./handlers";

export async function withOwner(fn: (owner: DocOwner) => Promise<ApiResult>): Promise<Response> {
  const access = await resolveBookkeepingOwner();
  if (!access.ok) return denialResponse(access.reason);
  return respond(await fn(access.owner as DocOwner));
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Never cached, never indexed, never leaks the URL as a referrer: these responses contain private financial documents. */
export const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

export function respond(r: ApiResult): Response {
  if ("pdf" in r) {
    return new Response(r.pdf as unknown as BodyInit, {
      status: 200,
      headers: { ...PRIVATE_HEADERS, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${r.filename}"` },
    });
  }
  return NextResponse.json(r.body, { status: r.status, headers: { ...PRIVATE_HEADERS } });
}
