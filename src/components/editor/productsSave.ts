// What "Save Changes" does with the catalogue (see rowsSave.ts): a product needs a name. An empty row
// added with "Add" is dropped; a product with a price, description or photo but no name is refused
// ("required"), because nothing could be shown for it.

import { planRowsSave, type RowsSavePlan } from "./rowsSave";

export interface ProductRowLike {
  id: string;
  name?: string | null;
  price?: unknown;
  description?: string | null;
  image_url?: string | null;
  image_urls?: unknown[] | null;
  landing_url?: string | null;
  whatsapp_message?: string | null;
}

const typed = (v: unknown) => typeof v === "string" && v.trim() !== "";

export type ProductsSavePlan<R extends ProductRowLike> = RowsSavePlan<R, null>;

export function planProductsSave<R extends ProductRowLike>(rows: R[]): ProductsSavePlan<R> {
  return planRowsSave<R, null>(rows, (row) => {
    if (typed(row.name)) return { state: "ok", payload: null };
    const hasOtherContent =
      (row.price !== "" && row.price != null) ||
      typed(row.description) ||
      typed(row.image_url) ||
      (Array.isArray(row.image_urls) && row.image_urls.length > 0) ||
      typed(row.landing_url) ||
      typed(row.whatsapp_message);
    return { state: "empty", hasOtherContent };
  });
}
