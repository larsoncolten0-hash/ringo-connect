import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/admin/ai/usage — this month's Ringo AI usage: totals, cost,
// success/error counts, average latency, error breakdown, recent errors,
// and feedback counts. Counts and codes only — never message content.
export async function GET() {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createAdminClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const [{ data: events, error }, { data: feedback }] = await Promise.all([
    db
      .from("ai_usage_events")
      .select("user_id, status, error_code, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tool_calls, latency_ms, cost_usd, created_at")
      .gte("created_at", monthStart)
      .order("created_at", { ascending: false })
      .limit(20000),
    db.from("ai_feedback").select("rating").gte("created_at", monthStart).limit(20000),
  ]);
  if (error) return NextResponse.json({ error: "load_failed" }, { status: 500 });

  const rows = events || [];
  const sum = (key: string) => rows.reduce((s, r: any) => s + (Number(r[key]) || 0), 0);
  const errors = rows.filter((r) => r.status === "error");
  const byError: Record<string, number> = {};
  for (const r of errors) byError[r.error_code || "unknown"] = (byError[r.error_code || "unknown"] || 0) + 1;
  const costRows = rows.filter((r) => r.cost_usd !== null);

  return NextResponse.json({
    monthStart,
    requests: rows.length,
    successful: rows.length - errors.length,
    failed: errors.length,
    activeUsers: new Set(rows.map((r) => r.user_id).filter(Boolean)).size,
    inputTokens: sum("input_tokens"),
    outputTokens: sum("output_tokens"),
    cacheReadTokens: sum("cache_read_tokens"),
    cacheWriteTokens: sum("cache_write_tokens"),
    toolCalls: sum("tool_calls"),
    avgLatencyMs: rows.length ? Math.round(sum("latency_ms") / rows.length) : 0,
    costUsd: Math.round(costRows.reduce((s, r: any) => s + Number(r.cost_usd), 0) * 10000) / 10000,
    costUnknownRequests: rows.length - costRows.length,
    errorsByCode: byError,
    recentErrors: errors.slice(0, 20).map((r) => ({ at: r.created_at, code: r.error_code, model: r.model })),
    feedback: {
      up: (feedback || []).filter((f: any) => f.rating === 1).length,
      down: (feedback || []).filter((f: any) => f.rating === -1).length,
    },
  });
}
