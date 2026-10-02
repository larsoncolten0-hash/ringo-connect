import type { Translations } from "@/lib/i18n/translations";
import { computeProfileHealth, pickNextAction, type HealthPlan, type HealthProfile } from "@/lib/profileHealth";
import { readDismissed } from "@/lib/profileHealth/dismissals";
import { recText } from "@/components/guidance/guidanceText";
import type { NextHint } from "./SectionFeedback";

/**
 * The single "Next: …" shown under a section after a successful Save. It is NOT a second recommendation
 * engine: it asks the same Profile Health logic Home uses (computeProfileHealth + pickNextAction) about the
 * profile as it is now, and respects the suggestions this device has hidden with "Not now" on Home.
 * Returns null when there is nothing worth suggesting.
 */
export function nextStepAfterSave(
  draft: Record<string, any>,
  plan: HealthPlan | null | undefined,
  t: Translations,
  locale: "en" | "fr",
  readHidden: (profileId: string) => string[] = readDismissed
): NextHint | null {
  const health = computeProfileHealth({ profile: draft as HealthProfile, plan });
  const dismissed = typeof draft.id === "string" ? readHidden(draft.id) : [];
  const action = pickNextAction(health.recommendations, { dismissed, missingCount: health.missingItems.length });
  if (!action) return null;
  const text = recText(t, locale, action.id, action.catalogLabel);
  // "Share your profile" has no editor destination of its own: it lives on Ringo Home
  const href = action.action === "share" ? "/dashboard/home" : action.href;
  return { title: text.title, href, cta: t.editor.postSave.next };
}
