// Churches & Ministries expansion, Phase 7: the plain constants of the giving and care funds. Pure, safe in the browser and on the server.
export const GIVING_KINDS = ["giving", "care"] as const;
export type GivingKind = (typeof GIVING_KINDS)[number];
export const FUND_LIMIT = 40;
export const GOAL_MIN_XAF = 1000;
export const GOAL_MAX_XAF = 1_000_000_000;

/** Optional starting points a church can pick when it adds a fund. They only fill the form: nothing is created until the church saves, and every field can be changed. Both languages are given. */
export interface FundTemplate {
  key: "general" | "building" | "missions" | "benevolence";
  kind: GivingKind;
  title_en: string;
  title_fr: string;
  description_en: string;
  description_fr: string;
}
export const FUND_TEMPLATES: readonly FundTemplate[] = [
  { key: "general", kind: "giving", title_en: "General fund", title_fr: "Fonds général", description_en: "Offerings and tithes for the everyday work and ministry of the church.", description_fr: "Offrandes et dîmes pour le travail quotidien et le ministère de l'église." },
  { key: "building", kind: "giving", title_en: "Building fund", title_fr: "Fonds de construction", description_en: "Help us build and maintain the place where we meet.", description_fr: "Aidez-nous à construire et à entretenir le lieu où nous nous réunissons." },
  { key: "missions", kind: "giving", title_en: "Missions", title_fr: "Missions", description_en: "Support the church's mission and outreach work.", description_fr: "Soutenez la mission et les actions d'évangélisation de l'église." },
  { key: "benevolence", kind: "care", title_en: "Benevolence fund", title_fr: "Fonds d'entraide", description_en: "Help for families and people in need in our community.", description_fr: "Aide aux familles et aux personnes dans le besoin de notre communauté." },
];
