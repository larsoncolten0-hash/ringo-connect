import type { DraftDefinition, DraftType } from "./types";
import { profileUpdateDraft } from "./profileUpdate";
import { productCreateDraft } from "./productCreate";
import { eventCreateDraft } from "./eventCreate";

// Every draft type Ringo AI can prepare. Future types (menu item, booking
// service, track, release, link, promotion…) are added here — plus the
// ai_drafts.draft_type CHECK in a new additive migration — without touching
// the tools, store, apply endpoint or UI.
export const DRAFT_DEFINITIONS: Record<DraftType, DraftDefinition<any>> = {
  "profile.update": profileUpdateDraft,
  "product.create": productCreateDraft,
  "event.create": eventCreateDraft,
};

export function getDraftDefinition(type: string): DraftDefinition<any> | null {
  return Object.prototype.hasOwnProperty.call(DRAFT_DEFINITIONS, type) ? DRAFT_DEFINITIONS[type as DraftType] : null;
}
