import { timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { evaluateSecuritySuiteReport, raiseFinding } from "@/lib/watchdog";
import { NextResponse } from "next/server";

// WD-005 intake: a CI / pre-deploy job (or `npm run security:test -- --report`) tells Ringo that the security suite FAILED. Nothing runs here: this only records the
// report as a Watchdog incident and alerts the owner. It never deploys, rolls back or changes anything.
//
// Not a user-facing endpoint: it needs a shared secret (WATCHDOG_INGEST_TOKEN). With the variable unset or too short it answers 503 and does nothing (fail closed), so it
// is inert until the owner chooses to set it. The body is validated against an allow-list (status, suite ids, a short reference); nothing free-text is stored.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.WATCHDOG_INGEST_TOKEN;
  if (!secret || secret.length < 16) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const given = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (Number(request.headers.get("content-length") || 0) > 4096) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const body = await request.json().catch(() => null);
  const finding = evaluateSecuritySuiteReport(body);
  if (!finding) return NextResponse.json({ ok: true, raised: false });

  const result = await raiseFinding(createAdminClient(), finding);
  return NextResponse.json({ ok: result !== "failed", raised: result === "created", duplicate: result === "duplicate" }, { status: result === "failed" ? 500 : 200 });
}
