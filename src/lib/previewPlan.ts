// The editor's live preview shows what the PUBLIC page will show. The public page (src/app/[username]/page.tsx)
// limits links and products to what the owner's plan allows and swaps in a fixed theme when custom themes
// are not allowed. This does the same for the preview, using the same entitlement helpers, so the
// preview never promises something the public page will not display. Pure; nothing is saved or changed.
//
// FALLBACK_THEME must equal the literals in the public page; scripts/tests/editorReliability.test.mjs
// reads the page and fails if the two ever differ.
import { countHidden, isCustomThemeAllowed, splitByPlanLimit } from "@/lib/planEntitlements";

export const FALLBACK_THEME = {
  theme_color: "#D4A954",
  background_style: "solid",
  background_color: "#0A0A0A",
  background_gradient_end: null,
  text_color: "#FAFAFA",
  button_style: "outline",
  button_radius: "rounded",
} as const;

export interface PreviewPlan {
  max_links?: number | null;
  max_products?: number | null;
  custom_theme_enabled?: boolean | null;
}

export interface PlanPreview<T> {
  profile: T;
  hiddenLinks: number;
  hiddenProducts: number;
  /** The owner's own theme is not shown publicly on this plan. */
  themeLocked: boolean;
  maxLinks: number | null;
  maxProducts: number | null;
}

export function applyPlanToPreview<T extends Record<string, any>>(draft: T, plan: PreviewPlan | null | undefined): PlanPreview<T> {
  const maxLinks = plan?.max_links ?? null;
  const maxProducts = plan?.max_products ?? null;
  const links = (draft.links as any[] | undefined) ?? [];
  const products = (draft.products as any[] | undefined) ?? [];
  const themeLocked = !isCustomThemeAllowed(plan);
  const profile: Record<string, any> = {
    ...draft,
    links: splitByPlanLimit(links, maxLinks).visible,
    products: splitByPlanLimit(products, maxProducts).visible,
    ...(themeLocked ? FALLBACK_THEME : {}),
  };
  return {
    profile: profile as T,
    hiddenLinks: countHidden(links.length, maxLinks),
    hiddenProducts: countHidden(products.length, maxProducts),
    themeLocked,
    maxLinks,
    maxProducts,
  };
}
