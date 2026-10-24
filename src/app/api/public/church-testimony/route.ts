import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/customer/session";
import { MAX_BODY_CHARS, parseSubmission, submitTestimony } from "@/lib/church/testimonies/submit";

export const dynamic = "force-dynamic";

// POST /api/public/church-testimony: a visitor shares a testimony with a church. PUBLIC by design (no account), so everything is re-derived on the server: the church comes from the public page's
// username and must be a published church page, every field is validated, and the answer is a plain { ok: true } whether the testimony is new, repeated or spam (nothing to probe).
// The table has no policy for any API role, so this route (service role) is the only way in. It never reads or returns anything about other submissions.
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return json({ ok: false, error: "invalid_body" }, 415);

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return json({ ok: false, error: "invalid_body" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const parsed = parseSubmission(body);
  if (!parsed.ok) return json({ ok: false, error: parsed.code, ...(parsed.field ? { field: parsed.field } : {}) }, 400);

  try {
    const result = await submitTestimony(createAdminClient(), parsed.value);
    if (!result.ok) return json({ ok: false, error: result.code }, result.status);
    return json({ ok: true }, 200);
  } catch {
    console.error(JSON.stringify({ scope: "church_testimony", result: "handler_error" }));
    return json({ ok: false, error: "server_error" }, 500);
  }
}
