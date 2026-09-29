import { resolveAiAccess } from "@/lib/ai/guard";
import ContentCalendarView from "@/components/ai/calendar/ContentCalendarView";
import ContentCalendarUnavailable from "@/components/ai/calendar/ContentCalendarUnavailable";

// /dashboard/content-calendar — Ringo AI Content Calendar V1. Gated by the
// SAME resolveAiAccess() every other /api/ai/* route uses (kill switch,
// plan eligibility, profile ownership, staff-workspace rule, beta
// allowlist) — calendar planning is a text-AI capability, no second
// authorization system.
export const dynamic = "force-dynamic";

export default async function ContentCalendarPage() {
  const access = await resolveAiAccess();
  if (!access.ok) return <ContentCalendarUnavailable reason={access.reason} />;

  const now = new Date();
  return <ContentCalendarView initialYear={now.getUTCFullYear()} initialMonth={now.getUTCMonth() + 1} />;
}
