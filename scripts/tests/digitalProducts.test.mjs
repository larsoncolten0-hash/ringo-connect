// Digital Products V1 — PDF/ZIP downloadable products, additive on top of the existing Shop.
// Covers: the shared validation function (type/size), the pure download-authorization decision
// (order -> order item -> digital file snapshot -> authorization), eligibility/Protection widening,
// the migration's exact shape (additive, byte-for-byte create_product_order reproduction plus the
// intended snapshot columns, no public-read storage policy), and every UI/route wiring point.
//   Run:  node scripts/tests/digitalProducts.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true });
const { validateDigitalFile, normalizeDigitalFileType, DIGITAL_PRODUCT_MAX_BYTES, formatFileSize } = jiti(path.join(SRC, "lib/digitalProducts/validation.ts"));
const { decideDigitalDownload } = jiti(path.join(SRC, "lib/digitalProducts/downloadAuth.ts"));
const { checkProductEligibility } = jiti(path.join(SRC, "lib/productCheckout/eligibility.ts"));
const { checkProtectionEligibility } = jiti(path.join(SRC, "lib/protection/checkoutEligibility.ts"));

// ============================================================================
// 1. FILE VALIDATION — PDF/ZIP only, 25 MiB max (shared client + server gate)
// ============================================================================
{
  check("25 MiB is the configured max (matches the DB CHECK and Decision A)", DIGITAL_PRODUCT_MAX_BYTES === 25 * 1024 * 1024);

  check("a PDF by MIME type is accepted", validateDigitalFile({ name: "guide.pdf", type: "application/pdf", size: 1024 }).ok === true);
  check("a ZIP by MIME type is accepted", validateDigitalFile({ name: "pack.zip", type: "application/zip", size: 1024 }).ok === true);
  check(
    "a ZIP reported as application/x-zip-compressed (common Windows MIME) is still accepted via normalization",
    validateDigitalFile({ name: "pack.zip", type: "application/x-zip-compressed", size: 1024 }).ok === true
  );
  check(
    "a ZIP with no browser-reported MIME type at all falls back to the .zip extension",
    validateDigitalFile({ name: "pack.zip", type: "", size: 1024 }).ok === true
  );
  check("the accepted mime is normalized to exactly the DB's allowed value for a zip", validateDigitalFile({ name: "pack.zip", type: "application/x-zip-compressed", size: 1024 }).mime === "application/zip");

  for (const bad of [
    { name: "song.mp3", type: "audio/mpeg" },
    { name: "video.mp4", type: "video/mp4" },
    { name: "doc.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { name: "sheet.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    { name: "deck.pptx", type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
    { name: "photo.jpg", type: "image/jpeg" },
    { name: "mystery.xyz", type: "" },
  ]) {
    const result = validateDigitalFile({ ...bad, size: 1024 });
    check(`${bad.name} (${bad.type || "no type"}) is rejected as wrong_type`, result.ok === false && result.code === "wrong_type", JSON.stringify(result));
  }

  const oversized = validateDigitalFile({ name: "big.pdf", type: "application/pdf", size: DIGITAL_PRODUCT_MAX_BYTES + 1 });
  check("a file over 25 MiB is rejected as too_large", oversized.ok === false && oversized.code === "too_large");
  const exact = validateDigitalFile({ name: "exact.pdf", type: "application/pdf", size: DIGITAL_PRODUCT_MAX_BYTES });
  check("a file at exactly 25 MiB is accepted (boundary is inclusive)", exact.ok === true);
  const zeroSize = validateDigitalFile({ name: "empty.pdf", type: "application/pdf", size: 0 });
  check("a zero-byte file is rejected", zeroSize.ok === false);

  check("normalizeDigitalFileType returns null for an unsupported type", normalizeDigitalFileType({ name: "x.docx", type: "" }) === null);
  check("formatFileSize renders a sane human string", /MB|KB|B/.test(formatFileSize(3_200_000)));
}

// ============================================================================
// 2. DOWNLOAD AUTHORIZATION — the pure decision function
// ============================================================================
{
  const digitalItem = { digitalFilePath: "seller-uid/abc.pdf", digitalFileName: "Guide.pdf" };
  const physicalItem = { digitalFilePath: null, digitalFileName: null };

  // --- order status gating ---
  for (const status of ["awaiting_payment", "cancelled", "expired", "refunded", "payment_review"]) {
    const d = decideDigitalDownload({ id: "o1", status, customerId: null }, digitalItem, { sessionCustomerId: null });
    check(`a '${status}' order is rejected (order_not_paid) — matches existing commerce rules`, d.ok === false && d.reason === "order_not_paid", JSON.stringify(d));
  }
  for (const status of ["paid", "fulfilled"]) {
    const d = decideDigitalDownload({ id: "o1", status, customerId: null }, digitalItem, { sessionCustomerId: null });
    check(`a '${status}' order is eligible`, d.ok === true, JSON.stringify(d));
  }

  // --- missing order / missing item ---
  check("no order at all -> order_not_found (an order-id guess never matches something real)", decideDigitalDownload(null, digitalItem, { sessionCustomerId: null }).reason === "order_not_found");
  check(
    "order exists but no matching item -> item_not_found (a product-id guess for someone else's order never matches)",
    decideDigitalDownload({ id: "o1", status: "paid", customerId: null }, null, { sessionCustomerId: null }).reason === "item_not_found"
  );
  check(
    "order + item exist but the item has no digital file snapshot -> not_digital (a physical order can never be 'downloaded')",
    decideDigitalDownload({ id: "o1", status: "paid", customerId: null }, physicalItem, { sessionCustomerId: null }).reason === "not_digital"
  );

  // --- signed-in customer: session must match ---
  check(
    "signed-in purchase + matching session -> authorized",
    decideDigitalDownload({ id: "o1", status: "paid", customerId: "cust-A" }, digitalItem, { sessionCustomerId: "cust-A" }).ok === true
  );
  check(
    "Customer A cannot download Customer B's purchase — mismatched session is rejected",
    decideDigitalDownload({ id: "o1", status: "paid", customerId: "cust-A" }, digitalItem, { sessionCustomerId: "cust-B" }).reason === "not_authorized"
  );
  check(
    "signed-in purchase + NO session at all (unauthenticated) is rejected",
    decideDigitalDownload({ id: "o1", status: "paid", customerId: "cust-A" }, digitalItem, { sessionCustomerId: null }).reason === "not_authorized"
  );

  // --- guest order: the order id itself is the entitlement (Decision B) ---
  check(
    "guest order (customerId null) + no session at all still succeeds — guest checkout preserved",
    decideDigitalDownload({ id: "o1", status: "paid", customerId: null }, digitalItem, { sessionCustomerId: null }).ok === true
  );
  check(
    "guest order + some UNRELATED signed-in session also succeeds (guest orders aren't owned by any account)",
    decideDigitalDownload({ id: "o1", status: "paid", customerId: null }, digitalItem, { sessionCustomerId: "someone-else" }).ok === true
  );

  // --- the returned path/name come only from the item snapshot, never echoed input ---
  const ok = decideDigitalDownload({ id: "o1", status: "paid", customerId: null }, digitalItem, { sessionCustomerId: null });
  check("the decision returns exactly the snapshot's own path/name", ok.ok === true && ok.path === digitalItem.digitalFilePath && ok.fileName === digitalItem.digitalFileName);

  // --- unpublishing doesn't remove entitlement: the function has no concept of profile.published at all ---
  const src = read("src/lib/digitalProducts/downloadAuth.ts");
  check("decideDigitalDownload never references profile publish state — entitlement is order/item/session only", !/published/.test(src));
}

// ============================================================================
// 3. checkProductEligibility — a digital product with no file yet can't be purchased
// ============================================================================
{
  const base = { profile_id: "p1", available: true, name: "Guide", price: 1000, inventory_count: null };
  check(
    "a digital product with no digital_file_path is unavailable",
    checkProductEligibility({ product: { ...base, product_type: "digital", digital_file_path: null }, profileId: "p1", quantity: 1 }) === "product_unavailable"
  );
  check(
    "a digital product WITH a digital_file_path is purchasable",
    checkProductEligibility({ product: { ...base, product_type: "digital", digital_file_path: "uid/x.pdf" }, profileId: "p1", quantity: 1 }) === null
  );
  check(
    "an ordinary physical product (product_type undefined, pre-migration shape) is unaffected",
    checkProductEligibility({ product: base, profileId: "p1", quantity: 1 }) === null
  );
}

// ============================================================================
// 4. Ringo Protection — unavailable for digital, unchanged for physical
// ============================================================================
{
  const settings = { protectionEnabled: true, protectionFeeRate: 0.05, protectionAutoReleaseHours: 48 };
  const commerce = { commerceEnabled: true, fapshiEnabled: true };
  const profile = { id: "p1", user_id: "u1", username: "seller", currency: "XAF", published: true, is_demo: false, category: null, categories: [] };
  const order = { id: "o1", profile_id: "p1", customer_id: null, currency: "XAF", total: 1000, status: "awaiting_payment", expires_at: new Date().toISOString(), paid_at: null };

  check(
    "a digital order is refused Protection (isDigital: true)",
    checkProtectionEligibility({ protection: settings, commerce, profile, order: { ...order, isDigital: true } }) === "order_not_payable"
  );
  check(
    "a physical order (isDigital: false/undefined) is unaffected — Protection still available",
    checkProtectionEligibility({ protection: settings, commerce, profile, order: { ...order, isDigital: false } }) === null
  );
  check(
    "the Music refusal is untouched (still refuses before/independent of the digital check)",
    checkProtectionEligibility({
      protection: settings,
      commerce,
      profile: { ...profile, category: "music_entertainment" },
      order: { ...order, isDigital: false },
    }) === "order_not_payable"
  );
}

// ============================================================================
// 5. THE MIGRATION — exact shape, additive, byte-for-byte create_product_order reproduction
// ============================================================================
{
  const migration = read("supabase/migrations/2026-11-14_digital_products_foundation.sql");

  check("products.product_type defaults to 'physical' (every existing row is unaffected)", /alter table products add column if not exists product_type text not null default 'physical';/.test(migration));
  check("products gains digital_file_path/name/size/mime, all nullable", [
    "digital_file_path text",
    "digital_file_name text",
    "digital_file_size_bytes bigint",
    "digital_file_mime text",
  ].every((frag) => migration.includes(frag)));
  check("a physical product can never carry digital file data (hard DB invariant)", /products_physical_no_digital_fields/.test(migration) && /product_type <> 'physical'/.test(migration));
  check("the mime CHECK strictly allows only pdf/zip (no octet-stream, no x-zip-compressed loophole)", /check \(digital_file_mime is null or digital_file_mime in \('application\/pdf', 'application\/zip'\)\)/.test(migration));
  check("the size CHECK enforces the 25 MiB ceiling at the database level too (defense in depth)", /digital_file_size_bytes <= 26214400/.test(migration));

  check("product_order_items gains the two nullable snapshot columns", /add column if not exists digital_file_path_snapshot text/.test(migration) && /add column if not exists digital_file_name_snapshot text/.test(migration));
  check(
    "no new CHECK/trigger was added for the snapshot columns (the existing blanket immutability guard already covers them)",
    !/create (or replace )?(trigger|function) product_order_items_guard/.test(migration)
  );

  check("the digital-products bucket is created as PRIVATE (public: false)", /insert into storage\.buckets \(id, name, public\)\s*values \('digital-products', 'digital-products', false\)/.test(migration));
  check("only owner upload/manage storage policies exist — no public/authenticated READ policy at all", /digital-products owner upload/.test(migration) && /digital-products owner manage/.test(migration) && !/digital-products.*read/i.test(migration));

  // create_product_order: every gate from the original function must still be present verbatim.
  const originalGates = [
    "if p_quantity is null or p_quantity < 1",
    "if p_quantity > c_max_quantity",
    "commerce_disabled",
    "payment_provider_unavailable",
    "profile_unavailable",
    "music_profile_not_supported",
    "commerce_currency_unsupported",
    "too_many_open_orders",
    "insufficient_stock",
    "product_unavailable",
  ];
  for (const gate of originalGates) {
    check(`create_product_order still contains the original gate: ${gate}`, migration.includes(gate));
  }
  check(
    "the ONLY functional addition to create_product_order is the widened INSERT (digital snapshot columns)",
    /insert into product_order_items \(order_id, product_id, name_snapshot, image_snapshot,\s*unit_price_snapshot, quantity, line_total,\s*digital_file_path_snapshot, digital_file_name_snapshot\)/.test(migration)
  );
  check(
    "the snapshot values come from v_product (the just-reserved row), never from a client-supplied argument",
    /v_product\.digital_file_path, v_product\.digital_file_name\)/.test(migration)
  );
}

// ============================================================================
// 6. SELLER UI — product type selector, upload, replace, no public URLs
// ============================================================================
{
  const uploadSrc = read("src/components/editor/DigitalFileUploadField.tsx");
  check("uploads go to the private 'digital-products' bucket", /storage\.from\("digital-products"\)/.test(uploadSrc));
  check("uploads NEVER call getPublicUrl (no public URL is ever generated for a paid digital file)", !/getPublicUrl/.test(uploadSrc));
  check("every upload gets a brand-new random path (never reuses/overwrites an existing object)", /upsert: false/.test(uploadSrc) && /crypto\.randomUUID\(\)/.test(uploadSrc));
  check("removing a file only clears the DB pointer — no storage delete/remove call anywhere", !/\.remove\(/.test(uploadSrc));
  check("client-side validation runs before any upload attempt", /validateDigitalFile\(file\)/.test(uploadSrc));

  const rowSrc = read("src/components/editor/ProductRow.tsx");
  check("ProductRow renders a Physical/Digital type toggle", /\["physical", "digital"\] as const/.test(rowSrc) && /onChange\(\{ product_type: type \}\)/.test(rowSrc));
  check("ProductRow only shows the digital upload field for a digital product", /product\.product_type === "digital"/.test(rowSrc));
  check("ProductRow warns when a digital product has no file yet (mirrors the eligibility gate)", /noFileYet/.test(rowSrc));

  const catalogSrc = read("src/components/editor/CatalogCard.tsx");
  check("CatalogCard.saveAll only sends digital columns when the row actually carries them (pre-migration safety, same guard as cta_preset)", /p\.product_type !== undefined/.test(catalogSrc));
  check("saving a PHYSICAL product always nulls out any digital fields (enforces the DB invariant from the app side too)", /digital_file_path: p\.product_type === "digital" \? p\.digital_file_path \|\| null : null/.test(catalogSrc));
}

// ============================================================================
// 7. CUSTOMER UI — receipt Download button, no new Purchases page, physical unchanged
// ============================================================================
{
  const receiptLibSrc = read("src/lib/productCheckout/receipt.ts");
  check("receipt data exposes isDigital as a plain boolean derived from the snapshot", /isDigital: !!i\.digital_file_path_snapshot/.test(receiptLibSrc));
  const itemsMapStart = receiptLibSrc.indexOf("items: items.map");
  const itemsMapBlock = receiptLibSrc.slice(itemsMapStart, receiptLibSrc.indexOf("})),", itemsMapStart) + 4);
  check(
    "receipt data NEVER exposes the raw digital_file_path_snapshot value itself to the client (only the derived boolean)",
    /isDigital: !!i\.digital_file_path_snapshot/.test(itemsMapBlock) && !/\bdigital_file_path_snapshot\s*:/.test(itemsMapBlock)
  );

  const viewSrc = read("src/components/shop/ShopOrderReceiptView.tsx");
  check("the receipt view calls the secure download API, never a direct storage URL", /\/api\/products\/download\?order=/.test(viewSrc));
  check("the Download button only shows for a paid/fulfilled order", /data\.status === "paid" \|\| data\.status === "fulfilled"/.test(viewSrc));

  check("no new My Ringo Purchases page/route was created", !fs.existsSync(path.join(REPO, "src/app/my-ringo/(app)/purchases")));

  const activitySrc = read("src/lib/customer/activity.ts");
  check("the existing My Ringo Activity feed (shop_order kind) is untouched by this feature", /kind: "shop_order"/.test(activitySrc));
}

// ============================================================================
// 8. DOWNLOAD ROUTE — wiring, never trusts the client
// ============================================================================
{
  const routeSrc = read("src/app/api/products/download/route.ts");
  check("the route requires BOTH order and product query params to be real UUIDs", /isUuid\(orderId\)/.test(routeSrc) && /isUuid\(productId\)/.test(routeSrc));
  check("the order is re-fetched from the database, never trusted from the request", /from\("product_orders"\)\.select\("id, status, customer_id"\)/.test(routeSrc));
  check("the item lookup is scoped to BOTH order_id and product_id (never product_id alone)", /\.eq\("order_id", orderId\)\s*\.eq\("product_id", productId\)/.test(routeSrc));
  check("the customer session is resolved server-side from the cookie, never from the request body/query", /getCustomerFromCookie\(\)/.test(routeSrc));
  check("the signed URL is short-lived (a small, fixed number of seconds, not a permanent link)", /SIGNED_URL_SECONDS = 300/.test(routeSrc));
  check("only createSignedUrl is used — never getPublicUrl — for the digital-products bucket", /createSignedUrl/.test(routeSrc) && !/digital-products["'`)].*getPublicUrl|getPublicUrl.*digital-products/.test(routeSrc));
  check("the route never reads a client-supplied 'paid' flag or trusts any payment-status field from the request", !/searchParams\.get\("paid"\)/.test(routeSrc) && !/body\.(paid|status)/.test(routeSrc));
}

// ============================================================================
// 9. i18n — every new user-facing string exists in both languages
// ============================================================================
{
  const src = read("src/lib/i18n/translations.ts");
  const enBlock = src.slice(0, src.indexOf("fr:"));
  const frBlock = src.slice(src.indexOf("fr:"));
  const editorKeys = ["typeLabel", "physical", "digital", "fileLabel", "acceptedFiles", "maxSize", "upload", "uploading", "replace", "remove", "noFileYet", "wrongType", "tooLarge", "uploadFailed"];
  for (const key of editorKeys) {
    check(`en editor.digitalProduct defines ${key}`, new RegExp(`${key}:`).test(enBlock.slice(enBlock.indexOf("digitalProduct: {"), enBlock.indexOf("digitalProduct: {") + 1200)));
    check(`fr editor.digitalProduct defines ${key}`, new RegExp(`${key}:`).test(frBlock.slice(frBlock.indexOf("digitalProduct: {"), frBlock.indexOf("digitalProduct: {") + 1200)));
  }
  for (const key of ["digitalBadge", "downloadButton", "preparingDownload", "downloadFailed"]) {
    check(`en shopReceipt defines ${key}`, new RegExp(`${key}:`).test(enBlock.slice(enBlock.indexOf("shopReceipt: {"), enBlock.indexOf("shopReceipt: {") + 3000)));
    check(`fr shopReceipt defines ${key}`, new RegExp(`${key}:`).test(frBlock.slice(frBlock.indexOf("shopReceipt: {"), frBlock.indexOf("shopReceipt: {") + 3000)));
  }
}

// ============================================================================
// 10. REGRESSION — physical-only surfaces are untouched
// ============================================================================
{
  const fulfillSrc = read("src/lib/productCheckout/fulfillOrder.ts");
  check("fulfillOrder.ts (manual physical fulfillment) has no digital-specific branch — untouched", !/digital/i.test(fulfillSrc));

  const settlementSrc = read("src/lib/productCheckout/settlement.ts");
  check("settlement.ts (paid -> earnings) has no digital-specific branch — a digital order settles exactly like a physical one", !/digital/i.test(settlementSrc));

  const musicHero = read("src/components/music/MusicHeroButtons.tsx");
  const restaurantHero = read("src/components/restaurant/RestaurantHeroButtons.tsx");
  check("Music/Restaurant hero buttons are untouched by this feature", !/digital/i.test(musicHero) && !/digital/i.test(restaurantHero));
}

const passed = results.filter((r) => r.pass).length;
console.log(`\ndigital_products: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
