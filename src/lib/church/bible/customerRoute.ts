import { NextResponse } from "next/server";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";
import { createAdminClient } from "@/lib/supabase/server";
import type { Result } from "../handlers";
import type { JourneyCtx } from "./journey";

// The entry point of every /api/customer/bible/** route (the PARTICIPANT side of Bible programmes). In order:
//   1. a write must come from this site (the same Origin check every cookie-authenticated customer POST uses)       403
//   2. the signed-in VISITOR from their My Ringo cookie (never from the request)                                      401
//   3. a size-capped, tolerant JSON body                                                                             400 / 413
// Only after that is the service-role client created, and it is handed to the handler together with the visitor's id: the handler filters every statement by it. A church staff session does NOT open
// these routes (they look for the visitor cookie only). Responses are never cached; an unexpected failure is never echoed.

const MAX_BODY_CHARS = 2_000;
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function journeyRoute(request: Request, opts: { write: boolean }, handler: (ctx: JourneyCtx, input: { body: unknown }) => Promise<Result>): Promise<NextResponse> {
  if (opts.write && !isSameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
  const session = await getCustomerFromCookie();
  if (!session) return json({ ok: false, error: "not_signed_in" }, 401);

  let body: unknown = null;
  if (opts.write && request.method !== "DELETE") {
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_CHARS) return json({ ok: false, error: "invalid_body" }, 413);
      body = raw.trim() === "" ? {} : JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "invalid_body" }, 400);
    }
  }
  try {
    const result = await handler({ customerId: session.customer.id, db: createAdminClient() as unknown as JourneyCtx["db"] }, { body });
    return json(result.body, result.status);
  } catch {
    console.error(JSON.stringify({ scope: "church_journey", result: "handler_error" }));
    return json({ ok: false, error: "server_error" }, 500);
  }
}
