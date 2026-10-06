import { NextResponse } from "next/server";
import { checkAiQuota, resolveAiAccess } from "@/lib/ai/guard";

// GET /api/ai/status — whether Ringo AI should appear for this user, and how
// many messages remain today. The launcher renders nothing unless
// `available` is true, so users outside the beta never see Ringo AI at all.
export const dynamic = "force-dynamic";

export async function GET() {
  const access = await resolveAiAccess();
  if (!access.ok) {
    // A plan that simply does not include Ringo AI is told so (the launcher then shows a locked, upgrade-oriented Ringo AI so the feature can be
    // discovered). Every other reason (kill switch, beta allowlist, demo, staff workspace...) is not about the plan and keeps Ringo AI hidden.
    // Nothing about the person's data is returned either way, and the chat API still refuses a plan without Ringo AI.
    return NextResponse.json(access.reason === "plan_not_eligible" ? { available: false, locked: "plan" } : { available: false });
  }

  const quota = await checkAiQuota(access.access);
  return NextResponse.json({
    available: true,
    canSend: quota.ok,
    limitReason: quota.ok ? null : quota.reason,
    remainingToday: quota.remainingToday,
    dailyLimit: access.access.dailyMessageLimit,
  });
}
