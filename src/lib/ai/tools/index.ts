import type { AiTool } from "./types";
import { getMyProfileOverview } from "./definitions/profileOverview";
import { runMySetupCheck } from "./definitions/setupCheck";
import { getMyAnalyticsSummary } from "./definitions/analyticsSummary";
import { getMyCatalogSummary } from "./definitions/catalogSummary";
import { getMyMusicSummary } from "./definitions/musicSummary";
import { getMyRestaurantSummary } from "./definitions/restaurantSummary";
import { getMyEventsSummary } from "./definitions/eventsSummary";
import { getMyBookingsSummary } from "./definitions/bookingsSummary";
import { getMyConnectSummary } from "./definitions/connectSummary";
import { getMyRestaurantSales } from "./definitions/restaurantSales";
import { getMyMusicSales } from "./definitions/musicSales";
import { getMyEventSales } from "./definitions/eventSales";
import { lookupRingoHelp } from "./definitions/lookupHelp";
import { getSetupOptions } from "./definitions/setupOptions";
import {
  createEventDraft,
  createProductDraft,
  createProfileDraft,
  discardMyDraft,
  getMyDrafts,
  updateProductDraft,
  updateEventDraft,
  updateTrackDraft,
  updateMenuItemDraft,
  createMenuItemDraft,
} from "./definitions/drafts";
import { generateContent } from "./definitions/content";

// The complete list of capabilities Ringo AI has. Nothing outside this list
// can be invoked. Order is deterministic (it's part of the cached prompt).
// To add a capability for a new feature: add a definition file and list it
// here. Draft tools (Phase 2) prepare drafts only; there is no apply tool.
export const AI_TOOLS: readonly AiTool<any>[] = [
  getMyProfileOverview,
  runMySetupCheck,
  getMyAnalyticsSummary,
  getMyCatalogSummary,
  getMyMusicSummary,
  getMyRestaurantSummary,
  getMyEventsSummary,
  getMyBookingsSummary,
  getMyConnectSummary,
  getMyRestaurantSales,
  getMyMusicSales,
  getMyEventSales,
  lookupRingoHelp,
  getSetupOptions,
  createProfileDraft,
  createProductDraft,
  updateProductDraft,
  createEventDraft,
  updateEventDraft,
  updateTrackDraft,
  updateMenuItemDraft,
  createMenuItemDraft,
  getMyDrafts,
  discardMyDraft,
  generateContent,
];
