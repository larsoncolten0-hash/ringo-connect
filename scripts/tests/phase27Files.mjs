// The EXACT files the product-completeness phase (password visibility toggle, Privacy Policy, Terms of Service, Cookie Policy, legal links, the profile picture shape save fix, and the switch that keeps
// optional advertising tracking off until there is a visitor-choice mechanism: src/lib/optionalTracking.ts) changes or adds.
// Presentation, static legal text and that switch only: no authentication flow, payment, Fapshi, Stripe, RLS, authorization, migration or business rule is changed.
// Same convention as phase26Files.mjs: explicit, no wildcards, no directories.
export const PHASE27_FILES = new Set([
  "scripts/tests/avatarShape.test.mjs",
  "scripts/tests/legal.test.mjs",
  "scripts/tests/musicProfile.test.mjs",
  "scripts/tests/phase27Files.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/phase16Files.mjs",
  "scripts/tests/performance.test.mjs",
  "src/app/auth/signup/page.tsx",
  "src/app/cookies/page.tsx",
  "src/app/privacy/page.tsx",
  "src/app/terms/page.tsx",
  "src/components/ProfileView.tsx",
  "src/components/association/AssociationGetStartedFlow.tsx",
  "src/components/auth/AuthShell.tsx",
  "src/components/auth/FormField.tsx",
  "src/components/dashboard/AvatarMenu.tsx",
  "src/components/editor/ProfileHeaderCard.tsx",
  "src/components/legal/LegalDocument.tsx",
  "src/components/legal/LegalLinks.tsx",
  "src/components/onboarding/GetStartedFlow.tsx",
  "src/lib/i18n/translations.en.ts",
  "src/lib/i18n/translations.fr.ts",
  "src/lib/legal/cookies.en.ts",
  "src/lib/legal/cookies.fr.ts",
  "src/lib/legal/privacy.en.ts",
  "src/lib/legal/privacy.fr.ts",
  "src/lib/legal/terms.en.ts",
  "src/lib/legal/terms.fr.ts",
  "src/lib/legal/types.ts",
  "src/lib/optionalTracking.ts",
  "src/lib/pixelTracking.ts",
]);

export const isPhase27File = (f) => PHASE27_FILES.has(String(f).replace(/\\/g, "/"));

// The files of this phase whose NAME falls inside an area an OLDER scope guard protects (the shared form field, the page shell and the sign-up page under auth/: only the show / hide password button
// and the legal links were added, the sign-in / sign-up / reset requests, validation and redirects are untouched): exempted by exact path, never by directory.
export const PHASE27_PROTECTED_FILES = new Set([
  "src/components/auth/AuthShell.tsx",
  "src/components/auth/FormField.tsx",
  "src/app/auth/signup/page.tsx",
]);
export const isPhase27ProtectedFile = (f) => PHASE27_PROTECTED_FILES.has(String(f).replace(/\\/g, "/"));
