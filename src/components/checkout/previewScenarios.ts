// Scenario names for the checkout preview harness. Kept in a plain (non-client) module so the server
// page can read them — importing a value from a "use client" file into a server component is not allowed.
export const PREVIEW_SCENARIOS = ["form", "waiting", "success", "failed", "expired", "order_expired", "review", "unavailable", "pay_error"] as const;
export type PreviewScenario = (typeof PREVIEW_SCENARIOS)[number];
