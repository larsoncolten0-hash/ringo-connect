import { isPhase19ProtectedFile } from "./phase19Files.mjs";
import { isPhase20ProtectedFile } from "./phase20Files.mjs";
import { isPhase22ProtectedFile } from "./phase22Files.mjs";
import { isPhase23ProtectedFile } from "./phase23Files.mjs";
import { isPhase24ProtectedFile } from "./phase24Files.mjs";
import { isPhase26ProtectedFile } from "./phase26Files.mjs";
import { isPhase27ProtectedFile } from "./phase27Files.mjs";
// The EXACT files the security remediation (Phase 1) changes or adds: privileged-column guards for users / profiles, executable-URL
// schemes, the avatar SSRF, Stripe webhook idempotency, the disabled free-upgrade endpoint, the example secret, SECURITY DEFINER
// hardening, the next / sharp upgrade. Every SQL file is a migration that REQUIRES OWNER APPROVAL and is not applied by this change.
// Same convention as phase15Files.mjs: explicit, no wildcards.
export const PHASE16_FILES = new Set([
  ".env.example",
  "next-env.d.ts",
  "package-lock.json",
  "package.json",
  "scripts/tests/aiBusinessDrafts.test.mjs",
  "scripts/tests/inventory.test.mjs",
  "scripts/tests/musicProfile.test.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/phase16Files.mjs",
  "scripts/tests/receivables.test.mjs",
  "scripts/tests/recordSaleUnit.test.mjs",
  "scripts/tests/securityPhase1.test.mjs",
  "scripts/tests/shopReceiptPdf.test.mjs",
  "scripts/tests/whatsappSecurityAudit.test.mjs",
  "src/app/api/billing/stripe/webhook/route.ts",
  "src/app/api/billing/upgrade/route.ts",
  "src/app/api/profile/avatar-icons/route.ts",
  "src/components/catalog/CatalogSection.tsx",
  "src/components/catalog/ProductDetailView.tsx",
  "src/components/dashboard/CommunityAnnouncementComposer.tsx",
  "src/components/editor/CatalogCard.tsx",
  "src/components/editor/TrackRow.tsx",
  "src/components/music/EventCheckinDashboard.tsx",
  "src/components/music/EventsSection.tsx",
  "src/components/music/ItemDetailPage.tsx",
  "src/components/music/MusicSection.tsx",
  "src/components/music/PinnedSpotlight.tsx",
  "src/components/music/useTrackPlayback.ts",
  "src/components/my-ringo/CustomerBell.tsx",
  "src/components/shop/ShopDestination.tsx",
  "src/lib/community/send.ts",
  "src/lib/linkUrl.ts",
  "src/lib/safeAvatarSource.ts",
  "src/lib/stripeIdempotency.ts",
  "supabase/migrations/2026-10-06a_users_privileged_column_guard.sql",
  "supabase/migrations/2026-10-06b_profiles_privileged_column_guard.sql",
  "supabase/migrations/2026-10-06c_security_definer_search_path.sql",
  "supabase/migrations/2026-10-06d_payment_transactions_idempotency.sql",
  "supabase/migrations/2026-10-06e_unsafe_url_scheme_guard.sql",
  "supabase/support/2026-10-06a_security_phase1.verify.sql",
  "supabase/support/2026-10-06a_users_privileged_column_guard.rollback.sql",
  "supabase/support/2026-10-06b_profiles_privileged_column_guard.rollback.sql",
  "supabase/support/2026-10-06c_security_definer_search_path.rollback.sql",
  "supabase/support/2026-10-06d_payment_transactions_idempotency.rollback.sql",
  "supabase/support/2026-10-06e_unsafe_url_scheme_guard.rollback.sql",
  "supabase/support/tests/security_phase1.adversarial.mjs",
]);

// The few files of this phase that sit inside an area an OLDER scope guard protects ("no payment / billing / webhook file", "no package
// file"). A guard exempts exactly these paths (never a directory, never a pattern); every other protected path stays protected in every
// guard. securityPhase1.test.mjs separately proves that the package files changed ONLY in the versions of next and sharp (no package
// added or removed, lockfile package set identical) and that the two billing files change only as described there.
export const PHASE16_PROTECTED_FILES = new Set([
  "package.json",
  "package-lock.json",
  "next-env.d.ts",
  "src/app/api/billing/stripe/webhook/route.ts",
  "src/app/api/billing/upgrade/route.ts",
  // new SQL whose NAME contains "payment" (an older guard matches on file names): the idempotency index and its rollback
  "supabase/migrations/2026-10-06d_payment_transactions_idempotency.sql",
  "supabase/support/2026-10-06d_payment_transactions_idempotency.rollback.sql",
]);
export const isPhase16ProtectedFile = (f) => PHASE16_PROTECTED_FILES.has(String(f).replace(/\\/g, "/")) || isPhase19ProtectedFile(f) || isPhase20ProtectedFile(f) || isPhase22ProtectedFile(f) || isPhase23ProtectedFile(f) || isPhase24ProtectedFile(f) || isPhase26ProtectedFile(f) || isPhase27ProtectedFile(f); // + the Phase 5 next.config.js (phase20Files.mjs) + the Phase 4 music-order payment binding (exact paths, phase19Files.mjs)

// The five security migrations, dated 2026-10-06 on the owner's instruction (today's date). Older guards that require "any new migration is dated AFTER
// the latest existing one" (receivables.test.mjs) exempt exactly these five paths and nothing else. NOTE for the owner: because their dates are earlier than
// 24 existing migrations (2026-10-07 .. 2026-12-16), a CLEAN rebuild that replays migrations in filename order would run them first. They are written to be
// safe in that order (every block skips what does not exist yet, and the verify script reports anything left unpinned), and production is applied by hand.
export const PHASE16_MIGRATIONS = new Set([
  "supabase/migrations/2026-10-06a_users_privileged_column_guard.sql",
  "supabase/migrations/2026-10-06b_profiles_privileged_column_guard.sql",
  "supabase/migrations/2026-10-06c_security_definer_search_path.sql",
  "supabase/migrations/2026-10-06d_payment_transactions_idempotency.sql",
  "supabase/migrations/2026-10-06e_unsafe_url_scheme_guard.sql",
]);
export const isPhase16Migration = (f) => PHASE16_MIGRATIONS.has(String(f).replace(/\\/g, "/"));
