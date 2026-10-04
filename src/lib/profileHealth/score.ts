import { buildContext, evaluateCriteria } from "./criteria";
import { pickNextAction } from "./nextAction";
import { fromMissingItems, growthRecommendations, sortRecommendations } from "./recommendations";
import type { HealthInput, HealthStatus, ProfileHealth } from "./types";

/**
 * "How complete is this Ringo, using only the features this profile can actually use?"
 * Pure and read-time: nothing is stored, and the same input always gives the same answer.
 */
export function computeProfileHealth(input: HealthInput): ProfileHealth {
  const ctx = buildContext(input);
  const items = evaluateCriteria(ctx).sort((a, b) => a.priority - b.priority);
  const completedItems = items.filter((i) => i.met);
  const missingItems = items.filter((i) => !i.met);

  const percentage = items.length === 0 ? 100 : Math.round((completedItems.length / items.length) * 100);
  const isComplete = missingItems.length === 0;

  const recommendations = sortRecommendations([...fromMissingItems(items), ...growthRecommendations(ctx, input.activity)]);
  const nextAction = pickNextAction(recommendations, { missingCount: missingItems.length });

  const published = ctx.p.published !== false;
  // Status describes COMPLETION. Publication is reported separately (`published`) and never changes the percentage or the checklist.
  const status: HealthStatus = isComplete ? (published ? "live" : "complete") : percentage >= 60 ? "good" : "attention";

  return { percentage, isComplete, published, status, group: ctx.group, category: ctx.category, items, completedItems, missingItems, recommendations, nextAction };
}
