// What "Save Changes" does with the menu's items (see rowsSave.ts): a dish needs a name. An empty row
// added with "Add item" is dropped; a dish with a price, description or photo but no name is refused
// ("required"), because nothing could be shown for it.

import { planRowsSave, type RowsSavePlan } from "./rowsSave";

export interface MenuItemRowLike {
  id: string;
  name?: string | null;
  price?: unknown;
  description?: string | null;
  image_url?: string | null;
  image_urls?: unknown[] | null;
  prep_time_minutes?: unknown;
}

const typed = (v: unknown) => typeof v === "string" && v.trim() !== "";
const has = (v: unknown) => v !== "" && v != null && !(typeof v === "number" && v === 0);

export type MenuSavePlan<R extends MenuItemRowLike> = RowsSavePlan<R, null>;

export function planMenuItemsSave<R extends MenuItemRowLike>(rows: R[]): MenuSavePlan<R> {
  return planRowsSave<R, null>(rows, (row) => {
    if (typed(row.name)) return { state: "ok", payload: null };
    const hasOtherContent =
      has(row.price) || typed(row.description) || typed(row.image_url) || (Array.isArray(row.image_urls) && row.image_urls.length > 0) || has(row.prep_time_minutes);
    return { state: "empty", hasOtherContent };
  });
}
