import { NextResponse } from "next/server";
import { checkAiQuota, resolveAiAccess } from "@/lib/ai/guard";

// GET /api/ai/status — whether Ringo AI should appear for this user, and how
// many messages remain today. The launcher renders nothing unless
// `available` is true, so users outside the beta never see Ringo AI at all.
export const dynamic = "force-dynamic";

export async function GET() {
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ available: false });

  const quota = await checkAiQuota(access.access);
  return NextResponse.json({
    available: true,
    canSend: quota.ok,
    limitReason: quota.ok ? null : quota.reason,
    remainingToday: quota.remainingToday,
    dailyLimit: access.access.dailyMessageLimit,
  });
}
