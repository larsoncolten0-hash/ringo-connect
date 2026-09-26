// Bug fix: buying a Ringo Card + Subscription bundle (e.g. the 3,500 FCFA Standard bundle, which
// grants 'basic') upgraded the account's plan but left bookings_enabled false — the creator had to
// go turn it on manually even though Basic is booking-eligible. Root cause: the earlier
// "bookings defaults on for an eligible plan" fix only covered brand-new account creation
// (api/admin/requests/[id]/approve/route.ts) — it never covered an EXISTING account's plan being
// upgraded via applyCardBundleGrant() (src/lib/cardBundle.ts), which is a separate code path.
//
// Fixed narrowly: only in the FREE -> paid transition (the "granted_from_free" outcome) — the exact
// moment a creator becomes booking-eligible for the first time, mirroring the signup case exactly.
// Deliberately NOT applied in the "extend an existing paid plan" branch, so a creator who already
// had the chance to turn bookings off on their current paid plan never has that choice silently
// overridden by buying another bundle (e.g. renewing/extending an already-Basic account).
//   Run:  node scripts/tests/bookingDefaultOnCardBundle.test.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

const src = read("src/lib/cardBundle.ts");

// ---------------------------------------------------------------- 1. the fix exists, correctly scoped
{
  check("the target plan's bookings_feature_enabled is loaded (not guessed/hardcoded per plan name)", /\.from\("plans"\)\.select\("id, name, bookings_feature_enabled"\)/.test(src));

  const freeIdx = src.indexOf("if (isFree) {");
  const bookingsIdx = src.indexOf("bookings_enabled: true", freeIdx);
  const grantedIdx = src.indexOf('outcome: "granted_from_free"', freeIdx);
  check("bookings_enabled: true is set INSIDE the isFree branch", freeIdx !== -1 && bookingsIdx > freeIdx && bookingsIdx < grantedIdx, `freeIdx=${freeIdx} bookingsIdx=${bookingsIdx} grantedIdx=${grantedIdx}`);

  const extendIdx = src.indexOf('outcome: "extended_existing_plan"', grantedIdx);
  check(
    "bookings_enabled is never touched in the 'extend an existing paid plan' branch (never overrides a creator's own earlier choice)",
    bookingsIdx < extendIdx && !src.slice(grantedIdx, extendIdx + 40).includes("bookings_enabled")
  );

  check("the update is gated on the TARGET plan's own bookings_feature_enabled — never applied unconditionally", /if \(targetPlan\.bookings_feature_enabled\) \{/.test(src));
  check("the update is scoped to this user's own profile via user_id — never a blanket/unscoped update", /\.from\("profiles"\)\.update\(\{ bookings_enabled: true \}\)\.eq\("user_id", userId\)/.test(src));
}

// ---------------------------------------------------------------- 2. the stripe-subscriber and generic structure are untouched
{
  check("the Stripe-subscriber no-op branch is unchanged (still returns before any bookings logic)", /if \(user\.payment_provider === "stripe"\) \{\s*\/\/[\s\S]{0,400}return \{ applied: true, outcome: "stripe_subscriber_unchanged" \};/.test(src));
  check("planRank/PLAN_RANK (the never-downgrade helper) is untouched", /const PLAN_RANK = \["free", "basic", "pro", "business_basic", "business_pro"\];/.test(src));
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nbooking_default_on_card_bundle: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
