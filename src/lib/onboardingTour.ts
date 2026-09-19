import { profileHasCategory } from "@/lib/categories";
import { isCommunityEnabled } from "@/lib/community/enabled";

// The onboarding tour's step model and step-list construction — kept
// separate from OnboardingTourController.tsx (the React/driver.js side)
// so the "what steps, in what order, for which profile" logic is plain,
// testable data rather than tangled into component lifecycle code.
//
// Each step names the PAGE its target actually lives on. Several targets
// (Community/Booking toggles, a specific Editor accordion section) are not
// on /dashboard at all, or aren't in the DOM until a section is expanded —
// see OnboardingTourController.tsx's own comment on why this means the
// tour has to survive real page navigations, not just live inside one
// page's component tree.

export type OnboardingStepKey =
  | "welcome"
  | "profilePhoto"
  | "menuItem"
  | "uploadTrack"
  | "addLink"
  | "community"
  | "bookings"
  | "installApp"
  | "share";

export interface OnboardingStepConfig {
  key: OnboardingStepKey;
  // The pathname this step's target lives on — the tour only ever
  // activates a step while the visitor is actually on this page.
  page: string;
  // An Editor accordion section id (see EditorSection ids in Editor.tsx)
  // that must be opened to reveal this step's target — reusing the exact
  // same `?section=<id>` hard-navigation mechanism
  // ProfileCompletionCard.tsx already uses, since Accordion only reads its
  // defaultOpenId once, on mount (a client-side reopen doesn't work).
  section?: string;
  // The data-tour attribute value (see the component files listed in the
  // Step 4 proposal) to spotlight. Null for the two steps with no fixed
  // page element: "welcome" (a centered intro) and "installApp" (a custom
  // modal reusing AddToHomeScreenMenuItem — see OnboardingInstallStep.tsx).
  selector: string | null;
}

const WELCOME_STEP: OnboardingStepConfig = { key: "welcome", page: "/dashboard", selector: null };
const PROFILE_PHOTO_STEP: OnboardingStepConfig = { key: "profilePhoto", page: "/dashboard", selector: '[data-tour="profile-photo"]' };

// Exactly one of these three, chosen by category — mirrors the same
// isMusic/isRestaurant branching Editor.tsx's own EditorCards already
// uses (profileHasCategory), not a new category list.
const MENU_ITEM_STEP: OnboardingStepConfig = { key: "menuItem", page: "/dashboard", section: "menu", selector: '[data-tour="add-menu-item"]' };
const UPLOAD_TRACK_STEP: OnboardingStepConfig = { key: "uploadTrack", page: "/dashboard", section: "tracks", selector: '[data-tour="add-track"]' };
const ADD_LINK_STEP: OnboardingStepConfig = { key: "addLink", page: "/dashboard", section: "links", selector: '[data-tour="add-link"]' };

const COMMUNITY_STEP: OnboardingStepConfig = { key: "community", page: "/dashboard/community/settings", selector: '[data-tour="community-toggle"]' };
const BOOKINGS_STEP: OnboardingStepConfig = { key: "bookings", page: "/dashboard/bookings/settings", selector: '[data-tour="bookings-toggle"]' };
const INSTALL_APP_STEP: OnboardingStepConfig = { key: "installApp", page: "/dashboard", selector: null };
const SHARE_STEP: OnboardingStepConfig = { key: "share", page: "/dashboard", selector: '[data-tour="view-live-page"]' };

export interface ProfileForTour {
  category?: string | null;
  categories?: string[] | null;
  community_enabled?: boolean | null;
  bookings_enabled?: boolean | null;
}

/**
 * Builds the actual step list for one profile — variable length: Community/
 * Bookings/Install are each included only when genuinely relevant (off, or
 * installable), per the product decision to never show a "turn on
 * something already on" prompt. `canInstallApp` is resolved client-side by
 * the controller (the same beforeinstallprompt/iOS detection
 * AddToHomeScreenMenuItem.tsx already uses) since it can't be known at
 * step-list-build time otherwise.
 */
export function buildOnboardingSteps(profile: ProfileForTour, canInstallApp: boolean): OnboardingStepConfig[] {
  const steps: OnboardingStepConfig[] = [WELCOME_STEP, PROFILE_PHOTO_STEP];

  if (profileHasCategory(profile, "restaurant_food")) steps.push(MENU_ITEM_STEP);
  else if (profileHasCategory(profile, "music_entertainment")) steps.push(UPLOAD_TRACK_STEP);
  else steps.push(ADD_LINK_STEP);

  // Community is always on (see src/lib/community/enabled.ts) — there is no
  // longer a toggle to point at, so this step is never included.
  if (!isCommunityEnabled(profile)) steps.push(COMMUNITY_STEP);
  if (!profile.bookings_enabled) steps.push(BOOKINGS_STEP);
  if (canInstallApp) steps.push(INSTALL_APP_STEP);

  steps.push(SHARE_STEP);
  return steps;
}

export function buildStepUrl(step: OnboardingStepConfig): string {
  return step.section ? `${step.page}?section=${step.section}` : step.page;
}

// --- sessionStorage-backed resume state ---------------------------------
// Deliberately sessionStorage, not the DB: this is "which step was I on,"
// a per-tab, per-visit resume convenience — completely different from
// onboarding_completed_at/onboarding_dismissed_at (users table), which is
// the real "has this account ever finished or skipped the tour at all"
// record. Losing this on tab close just restarts the CURRENT attempt at
// step 1, it never un-completes/un-dismisses anything already persisted.
const STORAGE_KEY = "ringo-onboarding-tour-step";

export function getStoredStepIndex(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function setStoredStepIndex(index: number) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, String(index));
  } catch {
    // sessionStorage can throw (private mode, disabled storage) — the
    // tour simply won't survive a navigation in that case, never worth
    // failing over.
  }
}

export function clearStoredStepIndex() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort, same reasoning as above
  }
}
