// Abuse-limit check used by order creation and payment initiation. Dependency-free.
// The limiter stores only keyed hashes (never a raw IP or phone). If the limiter itself is
// unavailable (database function missing, network trouble) the request is ALLOWED and the problem is
// logged: these limits are defence in depth, and a limiter outage must never block a genuine
// customer from paying. Callers pass a raw subject; hashing is the limiter implementation's job.

import type { RateKind } from "./constants";
import type { CheckoutDeps } from "./types";

/** true = the request may proceed. A missing limiter or missing subject means "no limit applies". */
export async function withinLimit(deps: CheckoutDeps, kind: RateKind, subject: string | null | undefined): Promise<boolean> {
  if (!deps.limiter || !subject) return true;
  try {
    return await deps.limiter.hit(kind, subject);
  } catch (err) {
    deps.log("product_rate_limit_error", { kind, error: String((err as Error)?.message || err).slice(0, 120) });
    return true;
  }
}
