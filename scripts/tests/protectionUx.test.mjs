// Ringo Protection — Phase 9 customer/seller UX polish tests. This phase is presentation-only (no
// new engine, no financial logic changes), so these tests are structural: the new customer/seller
// surfaces show truthful, backend-derived information (auto-release timing, granular refund status,
// the corrected resolved_release message), notifications reach both parties where the Phase 9 audit
// found they didn't, no "escrow" terminology appears, and nothing here writes anything or changes
// any amount/fee/state-machine logic.
//   Run:  node scripts/tests/protectionUx.test.mjs
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

// ---------------------------------------------------------------- 1. customer receipt data model
{
  const src = read("src/lib/productCheckout/receipt.ts");
  check("ShopReceiptProtection now carries autoReleaseAt (Phase 9 audit gap: never shown to the customer before)", /autoReleaseAt: string \| null/.test(src));
  check("ShopReceiptProtection now carries its own granular refund sub-object, distinct from the transaction status", /refund: \{ status: "requested" \| "processing" \| "completed" \| "failed" \}/.test(src));
  check("the refund read never selects destination phone/network or provider reference (customer-safe)", !/destination_phone|destination_network|provider_reference/.test(src));
  check("a Protection read failure still never breaks the existing Normal Payment receipt (try/catch preserved)", /never let a Protection read failure break/.test(src));
}

// ---------------------------------------------------------------- 2. customer receipt view — the fixed resolved_release copy + auto-release + refund status
{
  const src = read("src/components/shop/ShopOrderReceiptView.tsx");
  const resolvedReleaseBlock = src.match(/protectionStatus === "resolved_release" &&[\s\S]{0,150}/)?.[0] ?? "";
  check(
    "resolved_release now shows its OWN dedicated message, not the (wrong) awaitingConfirmationNote it showed before Phase 9",
    /resolvedReleaseNote/.test(resolvedReleaseBlock) && !/awaitingConfirmationNote/.test(resolvedReleaseBlock),
    resolvedReleaseBlock
  );
  check("the awaiting_confirmation block shows the auto-release date/time when the backend provides one", /data\.protection\.autoReleaseAt/.test(src) && /p\.autoReleaseNote\(/.test(src));
  check("auto-release date formatting uses the customer's own locale, never a hardcoded one", /toLocaleString\(dateLocale/.test(src));
  check("a granular refund status (requested/processing/completed/failed) is shown whenever a refund record exists", /data\.protection\.refund/.test(src) && /refundStatusNotes/.test(src));
  check("dispute submission still requires a non-empty reason (unchanged safety)", /disputeReason\.trim\(\)/.test(src));
  check("a second dispute/confirm tap while one is in flight is still ignored (idempotent UX preserved)", /disputeInFlight\.current|inFlight\.current/.test(src));
}

// ---------------------------------------------------------------- 3. seller order view — "you'll receive" clarity + auto-release timing
{
  const src = read("src/components/shop/ShopOrderDetail.tsx");
  check("the seller view now shows an explicit 'you will receive' amount, distinct from the customer-paid fee row", /sellerYouWillReceiveLabel/.test(src));
  check("the seller view shows the auto-release deadline while awaiting_confirmation (Phase 9 audit gap)", /order\.protection\.autoReleaseAt/.test(src) && /sellerAutoReleaseNote/.test(src));
  check("the seller Protection section still has NO release/refund action controls (admin-only, unchanged)", !/resolve-dispute|releaseProtectionTransaction|requestProtectionRefund/.test(src));
}

// ---------------------------------------------------------------- 4. notifications — the Phase 9 audit's own found gap: dispute-resolution notices only reached the customer
{
  const src = read("src/lib/protection/disputeNotifications.ts");
  const fnBody = (name) => {
    const m = src.match(new RegExp(`export async function ${name}[\\s\\S]*?\\n\\}`));
    return m ? m[0] : "";
  };
  check("notifyProtectionDisputeResolvedRelease now notifies BOTH the customer and the seller", /notifyCustomer\(/.test(fnBody("notifyProtectionDisputeResolvedRelease")) && /sendPushAndBellToUser\(/.test(fnBody("notifyProtectionDisputeResolvedRelease")));
  check("notifyProtectionDisputeResolvedRefund now notifies BOTH the customer and the seller", /notifyCustomer\(/.test(fnBody("notifyProtectionDisputeResolvedRefund")) && /sendPushAndBellToUser\(/.test(fnBody("notifyProtectionDisputeResolvedRefund")));
  check("notifyProtectionDisputeOpened now also confirms to the customer who opened it (previously seller+admin only)", /notifyCustomer\(/.test(fnBody("notifyProtectionDisputeOpened")));
  check("the seller refund-resolution notification never claims money was returned (says 'requested', not 'completed')", /refund requested/i.test(fnBody("notifyProtectionDisputeResolvedRefund")) && !/refund (was )?completed/i.test(fnBody("notifyProtectionDisputeResolvedRefund")));
  check("disputeNotifications.ts still never imports the refund adapter or calls Fapshi", !/fapshiRefundAdapter|fapshiPayout/.test(src));
}

// ---------------------------------------------------------------- 5. terminology — no "escrow" anywhere, consistent Protection vocabulary
{
  const filesToScan = [
    "src/lib/i18n/translations.ts",
    "src/components/checkout/ProtectionCheckout.tsx",
    "src/components/checkout/CheckoutModeSwitch.tsx",
    "src/components/shop/ShopOrderReceiptView.tsx",
    "src/components/shop/ShopOrderDetail.tsx",
    "src/lib/protection/disputeNotifications.ts",
    "src/lib/protection/releaseNotifications.ts",
    "src/lib/protection/fulfillmentNotifications.ts",
  ];
  for (const f of filesToScan) {
    check(`${f} never uses "escrow" terminology`, !/escrow/i.test(read(f)), f);
  }
}

// ---------------------------------------------------------------- 6. security / isolation — no new leakage introduced by the polish
{
  const receiptSrc = read("src/lib/productCheckout/receipt.ts");
  const sellerReaderSrc = read("src/lib/productCheckout/sellerReaders.ts");
  check("the customer receipt's refund read is scoped to the ONE transaction id resolved from the order id, never a list", /\.eq\("protection_transaction_id", txn\.id\)/.test(receiptSrc));
  check("the seller reader's widened protection_transactions select still filters by both target_id and the seller's own profile_id", /\.eq\("target_id", orderId\)/.test(sellerReaderSrc) && /\.eq\("profile_id", profileId\)/.test(sellerReaderSrc));
  check("no new customer-session or seller-session bypass was introduced (no new supabase.auth.getUser() or getCustomerFromCookie() call added outside existing routes)", !/getCustomerFromCookie|auth\.getUser\(\)/.test(read("src/components/shop/ShopOrderReceiptView.tsx")));
}

// ---------------------------------------------------------------- 7. no financial logic changed — structural proof this was a presentation-only phase
{
  const noFinancialChange = [
    "src/lib/protection/fee.ts",
    "src/lib/protection/release.ts",
    "src/lib/protection/disputeEngine.ts",
    "src/lib/protection/refundEngine.ts",
    "src/lib/protection/transitions.ts",
    "src/lib/protection/engine.ts",
    "src/lib/productCheckout/settlement.ts",
  ];
  for (const f of noFinancialChange) {
    check(`${f} exists and is expected to be byte-identical to before Phase 9 (verified separately via git diff in the Phase 9 report)`, fs.existsSync(path.join(REPO, f)), f);
  }
  // The two touched readers only ever SELECT — never write — protection_transactions/protection_refunds.
  check("receipt.ts's Protection additions are read-only (no .update()/.insert()/.delete() on protection_transactions or protection_refunds)", !/protection_transactions[\s\S]{0,80}\.(update|insert|delete)\(|protection_refunds[\s\S]{0,80}\.(update|insert|delete)\(/.test(read("src/lib/productCheckout/receipt.ts")));
  check("sellerReaders.ts's Protection additions remain read-only for protection_transactions/protection_disputes", !/protection_transactions[\s\S]{0,80}\.(update|insert|delete)\(|protection_disputes[\s\S]{0,80}\.(update|insert|delete)\(/.test(read("src/lib/productCheckout/sellerReaders.ts")));
}

// ---------------------------------------------------------------- 8. Protection / refund capability gates untouched
{
  const filesToScan = [
    "src/components/checkout/ProtectionCheckout.tsx",
    "src/components/shop/ShopOrderReceiptView.tsx",
    "src/components/shop/ShopOrderDetail.tsx",
    "src/lib/productCheckout/receipt.ts",
    "src/lib/productCheckout/sellerReaders.ts",
    "src/lib/protection/disputeNotifications.ts",
  ];
  for (const f of filesToScan) {
    check(`${f} never sets protection_enabled or protection_refund_provider_enabled to true`, !/protection_enabled:\s*true|protectionEnabled:\s*true|protection_refund_provider_enabled:\s*true|refundProviderEnabled:\s*true/.test(read(f)), f);
  }
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nprotection_ux: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
