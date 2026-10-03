// The EXACT files the Phase 2 editor work (reliability, creation experience, preview, guidance continuity) changes or adds.
// The older scope-guard tests (overview, aiBusinessTools, customers, reports) assert that an earlier feature did not touch
// anything outside its own area; they allow these files and nothing else, so any other change still fails them.
// An explicit list (no wildcards, no directories) is deliberate: adding a file here is a conscious, reviewable act.
import { PHASE3_FILES } from "./phase3Files.mjs";

export const PHASE2_FILES = new Set([
  "scripts/tests/aiBusinessTools.test.mjs",
  "scripts/tests/customers.test.mjs",
  "scripts/tests/documentsAi.test.mjs",
  "scripts/tests/editorReliability.test.mjs",
  "scripts/tests/overview.test.mjs",
  "scripts/tests/phase2Files.mjs",
  "scripts/tests/reports.test.mjs",
  "scripts/tests/saveTrust.test.mjs",
  "scripts/tests/subscriptionEntitlements.test.mjs",
  "src/app/globals.css",
  "src/components/Editor.tsx",
  "src/components/ProfileView.tsx",
  "src/components/SocialIcon.tsx",
  "src/components/dashboard/EditorSection.tsx",
  "src/components/dashboard/SectionFeedback.tsx",
  "src/components/dashboard/UnsavedChangesDialog.tsx",
  "src/components/dashboard/UnsavedNavigationGuard.tsx",
  "src/components/dashboard/autosaveEngine.ts",
  "src/components/dashboard/navigationGuard.ts",
  "src/components/dashboard/nextStep.ts",
  "src/components/dashboard/sectionAutosave.tsx",
  "src/components/dashboard/sectionSaveState.ts",
  "src/components/dashboard/unsavedRegistry.tsx",
  "src/components/editor/AboutCard.tsx",
  "src/components/editor/AudioUploadField.tsx",
  "src/components/editor/AvatarCropperField.tsx",
  "src/components/editor/CatalogCard.tsx",
  "src/components/editor/CategoryCard.tsx",
  "src/components/editor/DigitalFileUploadField.tsx",
  "src/components/editor/EditorPreviewContext.tsx",
  "src/components/editor/LinkRow.tsx",
  "src/components/editor/LinksCard.tsx",
  "src/components/editor/LivePreviewPanel.tsx",
  "src/components/editor/MenuCard.tsx",
  "src/components/editor/MenuCategorySection.tsx",
  "src/components/editor/MenuItemRow.tsx",
  "src/components/editor/MusicReleasesCard.tsx",
  "src/components/editor/MusicSettingsCard.tsx",
  "src/components/editor/PinnedSpotlightCard.tsx",
  "src/components/editor/PixelsCard.tsx",
  "src/components/editor/ProductRow.tsx",
  "src/components/editor/ProtectedAudioUploadField.tsx",
  "src/components/editor/RestaurantSettingsCard.tsx",
  "src/components/editor/SocialLinksCard.tsx",
  "src/components/editor/TablesCard.tsx",
  "src/components/editor/ThemeCard.tsx",
  "src/components/editor/TrackRow.tsx",
  "src/components/editor/TracksCard.tsx",
  "src/components/editor/draftSync.ts",
  "src/components/editor/linksSave.ts",
  "src/components/editor/musicBlank.ts",
  "src/components/editor/menuSave.ts",
  "src/components/editor/productsSave.ts",
  "src/components/editor/rowsSave.ts",
  "src/components/editor/useAutosavedRows.ts",
  "src/components/ui/Accordion.tsx",
  "src/components/ui/Disclosure.tsx",
  "src/components/ui/useModalA11y.ts",
  "src/components/ui/useMotionDuration.ts",
  "src/lib/ai/knowledge/index.ts",
  "src/lib/ai/knowledge/modules/editorSaving.ts",
  "src/lib/i18n/translations.ts",
  "src/lib/linkUrl.ts",
  "src/lib/previewPlan.ts"
]);

/** True for a file the Phase 2 editor work is allowed to change. */
export const isPhase2File = (f) => PHASE2_FILES.has(f) || PHASE3_FILES.has(f); // Phase 3's list is in phase3Files.mjs

/** The subset under the editor components, for the guards that protect that folder. */
export const isPhase2EditorFile = (f) => isPhase2File(f) && f.startsWith("src/components/editor/");
