import type { Locale, Translations } from "@/lib/i18n/translations";
import type { ActivityItem } from "@/lib/customer/activity";
import { actionText, fmtDate, fmtMoney, fmtNumber } from "@/components/loyalty/format";

// Wording for loyalty events in the EXISTING My Ringo Activity feed and the Home "Recent
// Activity" list. The server sends structured facts (item.loyalty); the text is built here from
// translations so it is English or French to match the customer. One shared helper keeps the two
// places identical.

type T = Translations;
export type LoyaltyActivityKind = Extract<
  ActivityItem["kind"],
  "loyalty_progress" | "loyalty_correction" | "reward_unlocked" | "reward_redeemed" | "package_activated" | "package_used"
>;

export const isLoyaltyKind = (kind: ActivityItem["kind"]): kind is LoyaltyActivityKind =>
  kind === "loyalty_progress" ||
  kind === "loyalty_correction" ||
  kind === "reward_unlocked" ||
  kind === "reward_redeemed" ||
  kind === "package_activated" ||
  kind === "package_used";

export function loyaltyKindLabel(t: T, kind: LoyaltyActivityKind): string {
  const k = t.myRingo.loyalty.activity.kinds;
  return {
    loyalty_progress: k.progress,
    loyalty_correction: k.correction,
    reward_unlocked: k.unlocked,
    reward_redeemed: k.redeemed,
    package_activated: k.packageActivated,
    package_used: k.packageUsed,
  }[kind];
}

/** "8/10", "12,500 XAF / 50,000 XAF" or "40/100 points" — never above the target. */
export function progressShown(t: T, locale: Locale, info: NonNullable<ActivityItem["loyalty"]>): string {
  const target = info.target ?? 0;
  const value = target > 0 ? Math.min(info.progress ?? 0, target) : info.progress ?? 0;
  if (info.type === "spend") return `${fmtMoney(value, info.currency ?? null, locale)} / ${fmtMoney(target, info.currency ?? null, locale)}`;
  if (info.type === "points") return `${fmtNumber(value, locale)}/${fmtNumber(target, locale)} ${t.myRingo.loyalty.rewards.points}`;
  return `${value}/${target}`;
}

export function loyaltyLine(t: T, locale: Locale, item: ActivityItem): string | null {
  const info = item.loyalty;
  if (!info) return null;
  const a = t.myRingo.loyalty.activity;
  switch (item.kind) {
    case "loyalty_progress":
      return a.progressLine(progressShown(t, locale, info));
    case "loyalty_correction":
      return info.packageName !== undefined
        ? a.packageUsedLine(info.packageName, info.remaining ?? 0, actionText(t.loyalty, info.actionKey ?? "").many)
        : a.correctionLine(progressShown(t, locale, info));
    case "reward_unlocked":
      return a.unlockedLine(info.rewardTitle ?? "");
    case "reward_redeemed":
      return a.redeemedLine(info.rewardTitle ?? "");
    case "package_activated":
      return a.packageActivatedLine(info.packageName ?? "", fmtDate(info.endsAt ?? null, locale));
    case "package_used":
      return a.packageUsedLine(info.packageName ?? "", info.remaining ?? 0, actionText(t.loyalty, info.actionKey ?? "").many);
    default:
      return null;
  }
}
