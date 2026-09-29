// Ambassador Program — shared per-sale stage derivation, used by BOTH the
// Ambassador dashboard (src/lib/ambassador/dashboard.ts, Phase D) and the
// Team Leader dashboard (src/lib/ambassador/teamDashboard.ts, Phase E).
// Extracted so the two dashboards can never silently disagree about what
// stage a given sale is in — one definition, imported twice, never
// duplicated. Still purely a read/display concern: this derives a label
// from the database's own status/activation fields, it never decides
// milestone eligibility itself (that remains exclusively
// ambassador_is_activation_ready()/ambassador_activation_status() in SQL).
export type AmbassadorSaleStage =
  | "payment_pending"
  | "payment_confirmed"
  | "profile_incomplete"
  | "profile_complete"
  | "fully_activated"
  | "disputed"
  | "voided"
  | "refunded";

export type AmbassadorNextAction = "awaiting_payment" | "awaiting_registration" | "complete_profile" | "install_pwa" | "none";

export function stageFor(saleStatus: string, activation: { profileComplete: boolean; pwaInstalled: boolean } | null): AmbassadorSaleStage {
  if (saleStatus === "disputed") return "disputed";
  if (saleStatus === "voided") return "voided";
  if (saleStatus === "refunded") return "refunded";
  if (saleStatus === "attributed") return "payment_pending";
  if (saleStatus === "locked") return "payment_confirmed";
  if (saleStatus === "milestone_2_earned") return "fully_activated";
  // milestone_1_earned — the database's own activation breakdown decides
  // the finer stage; ambassador_activation_status() is the sole authority
  // on this, never re-derived from raw profile fields here.
  if (!activation) return "profile_incomplete";
  if (!activation.profileComplete) return "profile_incomplete";
  if (!activation.pwaInstalled) return "profile_complete";
  return "fully_activated";
}

export function nextActionFor(stage: AmbassadorSaleStage): AmbassadorNextAction {
  switch (stage) {
    case "payment_pending":
      return "awaiting_payment";
    case "payment_confirmed":
      return "awaiting_registration";
    case "profile_incomplete":
      return "complete_profile";
    case "profile_complete":
      return "install_pwa";
    default:
      return "none";
  }
}

// Card tier bucketing from the snapshotted addon name (e.g. "Ringo
// Physical Card (Standard)") — shared so both dashboards count
// Standard/Pro/Premium identically.
export const cardTierKey = (name: string): "standard" | "pro" | "premium" => (name.includes("Premium") ? "premium" : name.includes("Pro") ? "pro" : "standard");
