// Churches & Ministries expansion, Phase 7: the plain constants of the giving and care funds. Pure, safe in the browser and on the server.
export const GIVING_KINDS = ["giving", "care"] as const;
export type GivingKind = (typeof GIVING_KINDS)[number];
export const FUND_LIMIT = 40;
export const GOAL_MIN_XAF = 1000;
export const GOAL_MAX_XAF = 1_000_000_000;
