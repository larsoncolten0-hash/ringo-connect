import { NextResponse } from "next/server";
import { resolveChurchActor, type ChurchActor } from "./actor";
import type { Result } from "./handlers";

// Shared entry point of every /api/church/** route. In order:
//   1. a write must be JSON (a plain cross-site form post cannot be)                                    415
//   2. the signed-in user from the session                                                              401
//   3. the church and the permissions of THIS user, resolved on the server (never from the request)     403
//   4. a size-capped, tolerant JSON body                                                                400 / 413
// Responses are never cached. Nothing here accepts a profile id, user id, role or permission from the browser.

export const MAX_BODY_CHARS = 8_000;
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function churchRoute(
  request: Request,
  opts: { write: boolean },
  handler: (actor: ChurchActor, input: { body: unknown; params: URLSearchParams }) => Promise<Result>
): Promise<NextResponse> {
  if (opts.write && request.method !== "DELETE" && !(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    return json({ ok: false, error: "invalid_body" }, 415);
  }

  const resolved = await resolveChurchActor();
  if (!resolved.ok) return resolved.reason === "not_signed_in" ? json({ ok: false, error: "not_signed_in" }, 401) : json({ ok: false, error: "forbidden" }, 403);

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

  let params: URLSearchParams;
  try {
    params = new URL(request.url).searchParams;
  } catch {
    params = new URLSearchParams();
  }
  try {
    const result = await handler(resolved.actor, { body, params });
    return json(result.body, result.status);
  } catch {
    // never echo an unexpected failure (it can quote a person's data)
    console.error(JSON.stringify({ scope: "church", result: "handler_error" }));
    return json({ ok: false, error: "server_error" }, 500);
  }
}
