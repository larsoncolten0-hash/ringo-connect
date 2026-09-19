import { NextResponse } from "next/server";
import { outcomeHttpStatus } from "@/lib/loyalty/engine";

// Small response helpers shared by every /api/loyalty route, so the shape the UI reads is
// always the same: route-level problems are { error }, engine results are { outcome, ... }.
// Both carry a stable code the UI translates (t.loyalty.outcomes[code]); no English text
// ever travels over the wire.

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export const jsonError = (error: string, status: number) => NextResponse.json({ error }, { status });
export const invalidRequest = () => jsonError("invalid_request", 400);
export const notFound = () => jsonError("not_found", 404);
// One response for every "that connection is not usable by this business" case (unknown id,
// another business's connection, disconnected), so the reply never reveals which it was.
export const notConnected = () => jsonError("not_connected", 409);
export const serverError = () => jsonError("server_error", 500);

export function outcomeJson(outcome: string, data: Record<string, unknown> = {}) {
  return NextResponse.json({ outcome, ...data }, { status: outcomeHttpStatus(outcome) });
}
