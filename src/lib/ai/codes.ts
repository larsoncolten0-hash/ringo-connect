// Stable machine codes shared by the Ringo AI API and its UI. The UI maps
// every code to translated text (t.ringoAi.errors.*) — no human-readable
// English ever travels in an API error, and no provider/database detail
// ever reaches the browser.

export const AI_DENY_REASONS = [
  "not_authenticated",
  "account_inactive",
  "no_profile",
  "staff_workspace",
  "demo_account",
  "disabled",
  "not_configured",
  "not_in_beta",
] as const;
export type AiDenyReason = (typeof AI_DENY_REASONS)[number];

export const AI_LIMIT_REASONS = ["daily_limit", "monthly_limit", "budget_reached", "quota_unavailable"] as const;
export type AiLimitReason = (typeof AI_LIMIT_REASONS)[number];

export const AI_RUNTIME_ERRORS = [
  "invalid_request",
  "conversation_not_found",
  "provider_busy",
  "provider_unavailable",
  "response_blocked",
  "response_truncated",
  "internal",
] as const;
export type AiRuntimeError = (typeof AI_RUNTIME_ERRORS)[number];

export type AiErrorCode = AiDenyReason | AiLimitReason | AiRuntimeError;

/** Max characters a user may type into one Ringo AI message. */
export const AI_MAX_USER_MESSAGE_CHARS = 2000;
