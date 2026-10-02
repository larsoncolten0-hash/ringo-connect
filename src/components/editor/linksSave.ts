// What "Save Changes" does with the Links section (see rowsSave.ts for the shared rules):
// a link needs a usable address; an empty row added with "Add link" is dropped; a row with a title or
// description but no usable address is refused ("required"); an address that cannot be a link is refused
// ("invalid"). The address check is injected (normalizeLinkUrl in the app).

import { planRowsSave, type RowsSavePlan } from "./rowsSave";

export interface LinkRowLike {
  id: string;
  title?: string | null;
  url?: string | null;
  description?: string | null;
  image_url?: string | null;
}

export type NormalizeResult = { ok: true; url: string } | { ok: false; reason: "empty" | "invalid" };

const typed = (v: unknown) => typeof v === "string" && v.trim() !== "";

export type LinksSavePlan<R extends LinkRowLike> = RowsSavePlan<R, { url: string }>;

export function planLinksSave<R extends LinkRowLike>(rows: R[], normalize: (url: unknown) => NormalizeResult): LinksSavePlan<R> {
  return planRowsSave<R, { url: string }>(rows, (row) => {
    const check = normalize(row.url);
    if (check.ok) return { state: "ok", payload: { url: check.url } };
    if (check.reason === "invalid") return { state: "invalid", reason: "invalid" };
    return { state: "empty", hasOtherContent: typed(row.title) || typed(row.description) || typed(row.image_url) };
  });
}
