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
import { lookupRingoHelp } from "./definitions/lookupHelp";

// The complete list of capabilities Ringo AI has. Nothing outside this list
// can be invoked. Order is deterministic (it's part of the cached prompt).
// To add a capability for a new feature: add a definition file and list it
// here; draft/write tools stay hidden by the registry until Phase 2/3.
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
  lookupRingoHelp,
];
