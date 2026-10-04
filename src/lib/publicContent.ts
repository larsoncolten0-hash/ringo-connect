// What a visitor to a public Ringo page is shown, as opposed to what merely exists as a row.
//
// "Add" in the editor inserts an empty row straight away (a link whose address is just "https://", a
// product or dish with no name, a track or release with no title) and Phase 2 removes most abandoned ones,
// but a half-filled row can still be saved. Showing it publicly produces a hollow card: an empty button
// that goes nowhere, or a priced item with no name. This module is the single, pure answer to "is this row
// worth showing?", built on the SAME definitions Profile Health already uses (hasUsableUrl, filled) so the
// dashboard, the editor preview and the public page agree. It is a rendering decision only: nothing is
// deleted, changed or hidden in the database, and the owner still sees and edits every row in the editor.

import { filled, hasUsableUrl } from "./profileHealth/criteria";
import { normalizeLinkUrl } from "./linkUrl";
import { splitByPlanLimit } from "./planEntitlements";

type Row = Record<string, any> | null | undefined;

/** A link is shown only when its address is real AND passes the same safety rules the editor enforces on save. */
export function isPublicLink(row: Row): boolean {
  return !!row && hasUsableUrl(row.url) && normalizeLinkUrl(row.url).ok;
}

/** A social icon needs an address that can actually be opened. */
export function isPublicSocialLink(row: Row): boolean {
  return isPublicLink(row);
}

/** A product / catalogue item needs a name. */
export function isPublicProduct(row: Row): boolean {
  return !!row && filled(row.name);
}

/** A menu dish needs a name. */
export function isPublicMenuItem(row: Row): boolean {
  return !!row && filled(row.name);
}

/** A track needs a title. */
export function isPublicTrack(row: Row): boolean {
  return !!row && filled(row.title);
}

/** A release needs a title. */
export function isPublicRelease(row: Row): boolean {
  return !!row && filled(row.title);
}

/** The rows that pass `test`, in their original order. Never mutates the input; null / non-arrays give []. */
export function publicRows<T>(rows: unknown, test: (row: T) => boolean): T[] {
  return Array.isArray(rows) ? (rows as T[]).filter((r) => test(r)) : [];
}

/**
 * The rows a plan allows publicly, in the right order: first drop the rows that are not worth showing, THEN
 * apply the plan's limit to what is left. The other way round, an empty placeholder row inside the first N
 * would use up a slot and push a real link or product beyond the limit, hidden for no reason. `visible` is
 * the creator's own first N meaningful rows in their own order; `hidden` is only meaningful rows over the
 * limit (so a "n hidden by your plan" figure never counts placeholders). `maxCount === null` = unlimited.
 * Nothing is deleted or changed.
 */
export function limitPublicRows<T extends { sort_order?: number | null }>(
  rows: unknown,
  test: (row: T) => boolean,
  maxCount: number | null
): { visible: T[]; hidden: T[] } {
  return splitByPlanLimit(publicRows<T>(rows, test), maxCount);
}

/**
 * The words on a link button. A link saved without a title shows its address, readably
 * ("example.com/page"), instead of an empty button.
 */
export function publicLinkTitle(row: Row): string {
  const title = typeof row?.title === "string" ? row.title.trim() : "";
  if (title) return title;
  const address = typeof row?.url === "string" ? row.url.trim() : "";
  return address.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?/i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}
