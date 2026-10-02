import type { Translations } from "@/lib/i18n/translations";
import type { Bilingual, CriterionId, Recommendation, RecommendationId } from "@/lib/profileHealth";

type Locale = "en" | "fr";

export interface RecText {
  title: string;
  reason: string;
  benefit: string;
  cta: string;
}

/** Looks up the EN/FR wording for a recommendation id (the catalog item uses the category's own wording). */
export function recText(t: Translations, locale: Locale, id: RecommendationId, catalogLabel?: Bilingual): RecText {
  const g = t.guidance.rec;
  if (id === "catalog") {
    const label = catalogLabel?.[locale];
    return { title: g.catalog.title(label), reason: g.catalog.reason, benefit: g.catalog.benefit, cta: g.catalog.cta };
  }
  return g[id];
}

export function recTextFor(t: Translations, locale: Locale, rec: Recommendation): RecText {
  return recText(t, locale, rec.id, rec.catalogLabel);
}

/** The checklist label for an item that is already done. */
export function doneText(t: Translations, locale: Locale, id: CriterionId, catalogLabel?: Bilingual): string {
  return id === "catalog" ? t.guidance.done.catalog(catalogLabel?.[locale]) : t.guidance.done[id];
}
