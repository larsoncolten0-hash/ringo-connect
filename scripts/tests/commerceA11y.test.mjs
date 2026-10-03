// Phase 5: commerce accessibility and customer-experience polish. Views are server-rendered with the real
// components (sucrase + a tiny CommonJS loader, as in productCheckoutUi / shopSeller) in EN and FR; behaviour
// that needs a DOM (focus) is pinned on the source and verified in the browser harness. No network, no
// database, no payment: the checkout controller is a fake that only holds state.
//   Run:  node scripts/tests/commerceA11y.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const { transform } = require("sucrase");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${String(e.message).split("\n").join("\n    ")}`);
  }
}
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const src = (rel) => strip(fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n"));

const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
let LOCALE = "en";
const cache = new Map();
const resolveSrc = (id) => {
  const base = path.join(SRC, id.slice(2));
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error("cannot resolve " + id);
};
const stubs = {
  "@/components/LanguageProvider": { useLanguage: () => ({ locale: LOCALE, t: translations[LOCALE], setLocale() {} }), LanguageProvider: ({ children }) => children },
  "next/navigation": { usePathname: () => "/dashboard/shop", useRouter: () => ({ refresh() {}, push() {} }) },
};
function load(file) {
  if (!file.endsWith(".tsx")) return jiti(file);
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const code = transform(fs.readFileSync(file, "utf8"), { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true }).code;
  const relative = (id) => {
    const base = path.join(path.dirname(file), id);
    for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
    throw new Error("cannot resolve " + id);
  };
  const req = (id) => (stubs[id] ? stubs[id] : id.startsWith("@/") ? load(resolveSrc(id)) : id.startsWith(".") ? load(relative(id)) : require(id));
  new Function("require", "module", "exports", code)(req, mod, mod.exports);
  return mod.exports;
}
const V = (rel) => load(path.join(SRC, rel)).default;
const html = (Comp, props, lang) => {
  LOCALE = lang;
  return renderToStaticMarkup(React.createElement(Comp, props)).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
};

// ------------------------------------------------------------------ 1. catalogue card accessible name
const CatalogSection = V("components/catalog/CatalogSection.tsx");
const catalogProps = (products) => ({
  label: "Catalogue", products, username: "ali", currency: "XAF", isMusic: false, accent: "#D4A954", textColor: "#FAFAFA", borderTint: "#333",
  squareCorners: false, buttonStyle: {}, radiusClass: "rounded-full", category: "business_ecommerce", bookingEnabled: false, restaurantOrdering: false,
  checkoutAvailable: false, isDemo: false, preview: false, onOpen() {},
});
const P1 = { id: "p-1", profile_id: "pr", name: "Blue Widget", price: 6000, description: "Nice", sort_order: 1, inventory_count: 0 };
const P2 = { id: "p-2", profile_id: "pr", name: "Red Widget", price: 2500, description: null, sort_order: 2, inventory_count: 5 };
const P3 = { id: "p-3", profile_id: "pr", name: "Free Gift", price: null, description: null, sort_order: 3 };
const cardLabels = (h) => [...h.matchAll(/<a [^>]*aria-label="([^"]*)"/g)].map((m) => m[1]);

await test("catalogue card: the accessible name carries name, price, sold-out state and the action (EN)", () => {
  const labels = cardLabels(html(CatalogSection, catalogProps([P1, P2, P3]), "en"));
  assert.equal(labels.length, 3);
  const [sold, ok, noPrice] = labels;
  assert.ok(sold.startsWith("Blue Widget, ") && /6[\s,. ]?000/.test(sold) && sold.includes(translations.en.music.soldOut), sold);
  assert.ok(ok.startsWith("Red Widget, ") && /2[\s,. ]?500/.test(ok) && !ok.includes(translations.en.music.soldOut), ok);
  assert.ok(sold.split(", ").length >= 4 && ok.split(", ").length >= 3, "an action label is included");
  assert.equal(noPrice.split(", ")[0], "Free Gift");
  assert.ok(!/null|undefined|NaN/.test(labels.join("|")), "a product without a price has no empty or broken part");
});
await test("catalogue card: French uses the French sold-out wording and no English one", () => {
  const [sold] = cardLabels(html(CatalogSection, catalogProps([P1]), "fr"));
  assert.ok(sold.includes(translations.fr.music.soldOut), sold);
  assert.notEqual(translations.fr.music.soldOut, translations.en.music.soldOut);
  assert.ok(!sold.includes(translations.en.music.soldOut), sold);
});
await test("catalogue card: visuals, availability and price logic are unchanged (same classes, same price chip, same link)", () => {
  const h = html(CatalogSection, catalogProps([P1, P2]), "en");
  assert.ok(h.includes('href="/m/ali/merch/p-1"') || h.includes('href="/ali/item/p-1"'));
  assert.ok(h.includes("aspect-[16/11]") === false && h.includes("aspect-[4/5]"));
  const s = src("src/components/catalog/CatalogSection.tsx");
  assert.match(s, /const soldOut = product\.inventory_count === 0;/);
  assert.match(s, /aria-label=\{accessibleName\}/);
  assert.ok(!/aria-label=\{product\.name\}/.test(s));
  assert.match(s, /formatPrice\(product\.price, currency\)/);
});

// ------------------------------------------------------------------ 2. checkout
const ProductCheckout = V("components/checkout/ProductCheckout.tsx");
const FORM = { quantity: 1, name: "", phone: "", email: "", note: "", payPhone: "", medium: "mobile money" };
const fakeController = (state) => ({ subscribe: () => () => {}, getState: () => state, resume: async () => {}, poll: async () => {}, submit: async () => {}, edit() {}, startOver() {} });
const baseProps = (state, extra = {}) => ({
  product: { id: "11111111-1111-1111-1111-111111111111", name: "Blue Widget", description: null, image: null, unitPrice: 6000, currency: "XAF", maxQuantity: 10, lowStock: null },
  seller: { name: "Chez Ali", username: "ali" },
  theme: { accent: "#D4A954", bg: "#0A0A0A", fg: "#FAFAFA" },
  productHref: "/ali/item/11111111-1111-1111-1111-111111111111",
  sellerHref: "/ali",
  preview: true,
  controller: fakeController(state),
  ...extra,
});
const formState = { phase: "form", form: FORM, fieldErrors: {}, order: null, receipt: null, error: null, expiresAt: null, pollFailures: 0 };
const ORDER = { id: "0a0a0a0a-1111-4222-8333-444444444444", order_number: "PO-000007", status: "paid", currency: "XAF", subtotal: 6000, total: 6000, expires_at: "2030-01-01T00:00:00Z", items: [{ name: "Blue Widget", image: null, quantity: 1, unit_price: 6000, line_total: 6000 }] };
const successState = {
  ...formState,
  phase: "success",
  order: ORDER,
  receipt: { receipt_number: "RCP-000007", order: { order_number: "PO-000007", total: 6000, currency: "XAF", paid_at: null, items: [{ name: "Blue Widget", quantity: 1 }] } },
};
const buttonTag = (h, label) => (h.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`)) || [])[0] || "";

await test("quantity buttons: translated accessible labels in EN and FR, no bare symbols", () => {
  const en = html(ProductCheckout, baseProps(formState), "en");
  assert.ok(buttonTag(en, "Decrease quantity") && buttonTag(en, "Increase quantity"));
  const fr = html(ProductCheckout, baseProps(formState), "fr");
  assert.ok(buttonTag(fr, "Diminuer la quantité") && buttonTag(fr, "Augmenter la quantité"));
  for (const h of [en, fr]) assert.ok(!/aria-label="[−+]"/.test(h));
});
await test("quantity buttons: at least 44px (h-11 w-11) in both, behaviour classes and disabled rules unchanged", () => {
  const h = html(ProductCheckout, baseProps(formState), "en");
  for (const label of ["Decrease quantity", "Increase quantity"]) {
    const tag = buttonTag(h, label);
    assert.match(tag, /h-11 w-11/, label);
    assert.ok(!/h-10 w-10/.test(tag), label);
  }
  assert.match(buttonTag(h, "Decrease quantity"), /disabled=""/, "quantity 1: decrease is disabled, as before");
  const s = src("src/components/checkout/ProductCheckout.tsx");
  assert.match(s, /disabled=\{busy \|\| form\.quantity <= 1\} onClick=\{\(\) => ctl\.edit\(\{ quantity: ctl\.getState\(\)\.form\.quantity - 1 \}\)\}/);
  assert.match(s, /disabled=\{busy \|\| form\.quantity >= product\.maxQuantity\} onClick=\{\(\) => ctl\.edit\(\{ quantity: ctl\.getState\(\)\.form\.quantity \+ 1 \}\)\}/);
});
await test("validation focus: after a failed submit, focus goes to the first invalid field, in on-screen order, UI layer only", () => {
  const s = src("src/components/checkout/ProductCheckout.tsx");
  assert.match(s, /const FOCUS_ORDER: FieldName\[\] = \["quantity", "name", "phone", "email", "note", "medium", "payPhone"\];/);
  assert.match(s, /const submitAndFocus = async \(\) => \{\s*await ctl\.submit\(\);\s*const errors = ctl\.getState\(\)\.fieldErrors;\s*const first = FOCUS_ORDER\.find\(\(f\) => errors\[f\] && fieldRefs\.current\[f\]\);\s*if \(first\) fieldRefs\.current\[first\]\?\.focus\(\);/);
  assert.match(s, /onClick=\{\(\) => void submitAndFocus\(\)\}/);
  assert.equal((s.match(/ctl\.submit\(\)/g) || []).length, 1, "the controller is submitted from exactly one place");
  for (const field of ["name", "phone", "email", "note", "payPhone", "quantity"]) assert.match(s, new RegExp(`fieldRefs\\.current\\.${field} = el`), field);
  assert.match(s, /if \(form\.medium === id\) fieldRefs\.current\.medium = el/);
  // the on-screen order really is quantity, name, phone, email, note, payment method, pay number
  const at = (needle) => s.indexOf(needle);
  const order = ["fieldRefs.current.quantity = el", "fieldRefs.current.name = el", "fieldRefs.current.phone = el", "fieldRefs.current.email = el", "fieldRefs.current.note = el", "fieldRefs.current.medium = el", "fieldRefs.current.payPhone = el"].map(at);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "refs are attached in the same order as FOCUS_ORDER");
  // the controller, validation and flow are untouched by this change
  for (const f of ["src/lib/productCheckout/clientFlow.ts", "src/lib/productCheckout/validation.ts"]) assert.ok(!/fieldRefs|submitAndFocus|FOCUS_ORDER/.test(src(f)), f);
});
await test("validation focus: a failed-validation render still shows every field error text exactly as before", () => {
  const st = { ...formState, fieldErrors: { name: "name_required", phone: "phone_invalid" } };
  const h = html(ProductCheckout, baseProps(st), "en");
  assert.ok((h.match(/role="alert"/g) || []).length >= 2);
});

await test("success: a 'View receipt' link to the persistent receipt uses the current order id (EN and FR)", () => {
  const en = html(ProductCheckout, baseProps(successState), "en");
  const m = en.match(/<a[^>]*href="(\/shop\/orders\/[^"]+)"[^>]*>View receipt<\/a>/);
  assert.ok(m, "link present");
  assert.equal(m[1], `/shop/orders/${ORDER.id}`);
  const fr = html(ProductCheckout, baseProps(successState), "fr");
  assert.ok(new RegExp(`<a[^>]*href="/shop/orders/${ORDER.id}"[^>]*>Voir le reçu</a>`).test(fr));
  assert.ok(en.includes("Back to Chez Ali") && fr.includes("Retour à Chez Ali"), "the existing back-to-seller action is kept");
});
await test("success: a different order id gives a different link; the id is URL-encoded; no order id, no link", () => {
  const other = { ...successState, order: { ...ORDER, id: "ffffffff-0000-4000-8000-000000000001" } };
  assert.ok(html(ProductCheckout, baseProps(other), "en").includes('href="/shop/orders/ffffffff-0000-4000-8000-000000000001"'));
  const odd = { ...successState, order: { ...ORDER, id: "a/b?c" } };
  assert.ok(html(ProductCheckout, baseProps(odd), "en").includes('href="/shop/orders/a%2Fb%3Fc"'));
  const none = { ...successState, order: null };
  assert.ok(!html(ProductCheckout, baseProps(none), "en").includes("/shop/orders/"));
});
await test("success: the receipt link appears only on the success screen, and the receipt route is the existing one", () => {
  for (const st of [formState, { ...formState, phase: "waiting", order: ORDER, expiresAt: "2030-01-01T00:00:00Z" }, { ...formState, phase: "failed", order: ORDER }]) {
    assert.ok(!html(ProductCheckout, baseProps(st), "en").includes("View receipt"), st.phase);
  }
  assert.ok(fs.existsSync(path.join(SRC, "app/shop/orders/[id]/page.tsx")), "the persistent receipt route exists");
  const s = src("src/components/checkout/ProductCheckout.tsx");
  assert.match(s, /href=\{`\/shop\/orders\/\$\{encodeURIComponent\(order\.id\)\}`\}/);
  for (const f of ["src/lib/productCheckout/receipt.ts", "src/lib/productCheckout/settlement.ts", "src/lib/productCheckout/createOrder.ts"]) assert.ok(!/viewReceipt|submitAndFocus/.test(src(f)), f);
});

// ------------------------------------------------------------------ 3. product detail back button
await test("product detail: the back button is 44px (h-11 w-11) and still goes to the profile", () => {
  const s = src("src/components/catalog/ProductDetailView.tsx");
  const link = (s.match(/<Link\s+href=\{`\/\$\{username\}`\}\s+aria-label=\{t\.music\.backToProfile\}[\s\S]*?<\/Link>/) || [])[0] || "";
  assert.ok(link, "back link found");
  assert.match(link, /h-11 w-11/);
  assert.ok(!/h-10 w-10/.test(link));
  assert.match(link, /href=\{`\/\$\{username\}`\}/);
});

// ------------------------------------------------------------------ 4. seller views
const ShopOrdersView = V("components/shop/ShopOrdersView.tsx");
const ordersData = (group, page = 2) => ({ group, items: [], page, pageSize: 20, pageCount: 3, total: 45, toFulfillCount: 2 });

await test("seller order filters: real navigation links, not fake tabs (no tablist / tab / aria-selected)", () => {
  for (const lang of ["en", "fr"]) {
    const h = html(ShopOrdersView, { data: ordersData("to_fulfill") }, lang);
    assert.ok(!/role="tablist"|role="tab"|aria-selected/.test(h), lang);
    assert.ok(h.includes(`<nav class="flex flex-wrap gap-2" aria-label="${translations[lang].shopOrders.filtersLabel}">`), lang);
    assert.equal((h.match(/aria-current="page"/g) || []).length, 1, "exactly one active filter");
    assert.ok(/href="\/dashboard\/shop\?group=to_fulfill"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/dashboard\/shop\?group=to_fulfill"/.test(h), "the active one is the selected group");
  }
});
await test("seller order filters: same links, same look (classes, 44px) as before", () => {
  const h = html(ShopOrdersView, { data: ordersData("sales", 1) }, "en");
  for (const href of ["/dashboard/shop", "/dashboard/shop?group=to_fulfill", "/dashboard/shop?group=unpaid"]) assert.ok(h.includes(`href="${href}"`), href);
  assert.ok((h.match(/min-h-\[44px\]/g) || []).length >= 3);
  assert.ok(h.includes("border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo"));
});
await test("seller pagination: a translated, descriptive label in EN and FR (orders and earnings), never the bare word", () => {
  for (const lang of ["en", "fr"]) {
    const h = html(ShopOrdersView, { data: ordersData("sales") }, lang);
    assert.ok(h.includes(`aria-label="${translations[lang].shopOrders.ordersPaginationLabel}"`), lang);
    assert.ok(!h.includes('aria-label="pagination"'), lang);
  }
  assert.equal(translations.en.shopOrders.ordersPaginationLabel, "Orders pages");
  assert.equal(translations.fr.shopOrders.ordersPaginationLabel, "Pages des commandes");
  const e = src("src/components/shop/ShopEarningsView.tsx");
  assert.match(e, /aria-label=\{s\.earningsPaginationLabel\}/);
  assert.ok(!/aria-label="pagination"/.test(e));
  assert.equal(translations.en.shopOrders.earningsPaginationLabel, "Earnings pages");
  assert.equal(translations.fr.shopOrders.earningsPaginationLabel, "Pages des gains");
});
await test("seller views: earnings figures, payouts and order queries are untouched", () => {
  const e = fs.readFileSync(path.join(REPO, "src/components/shop/ShopEarningsView.tsx"), "utf8");
  assert.match(e, /s\.pageOf\(data\.page, data\.pageCount\)/);
  for (const f of ["src/lib/productCheckout/sellerOrders.ts", "src/lib/productCheckout/sellerReaders.ts", "src/lib/shopPayouts.ts"]) assert.ok(!/ordersPaginationLabel|filtersLabel|earningsPaginationLabel/.test(src(f)), f);
});

// ------------------------------------------------------------------ 5. private order pages
await test("/shop/orders/[id] and /order/[id] are not indexable: metadata only, access and lookup unchanged", () => {
  const receipt = src("src/app/shop/orders/[id]/page.tsx");
  const tracking = src("src/app/order/[id]/page.tsx");
  for (const s of [receipt, tracking]) {
    assert.match(s, /export const metadata: Metadata = \{ robots: \{ index: false, follow: false \} \};/);
    assert.match(s, /import type \{ Metadata \} from "next";/);
  }
  assert.match(receipt, /const data = await getShopOrderReceiptData\(params\.id\);\s*if \(!data\) return notFound\(\);\s*return <ShopOrderReceiptView data=\{data\} \/>;/);
  assert.match(tracking, /return <GuestOrderTrackingView orderId=\{params\.id\} \/>;/);
  assert.match(receipt, /export const dynamic = "force-dynamic"/);
  assert.match(tracking, /export const dynamic = "force-dynamic"/);
  assert.ok(!/generateMetadata/.test(receipt + tracking), "no dynamic metadata (and so no order data in <head>)");
});
await test("robots.ts and middleware are unchanged by this phase (still guidance only; matcher untouched)", () => {
  assert.match(src("src/app/robots.ts"), /"\/shop\/orders"/);
  assert.match(src("src/middleware.ts"), /matcher: \["\/dashboard\/:path\*", "\/admin\/:path\*"\]/);
});

// ------------------------------------------------------------------ 6. translations
const shape = (v) => (typeof v === "function" ? "fn" : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v);
await test("new strings exist in EN and FR, differ between them, and productCheckout / shopOrders keep identical structure", () => {
  const keys = [
    ["productCheckout", "viewReceipt", "View receipt", "Voir le reçu"],
    ["productCheckout", "decreaseQuantity", "Decrease quantity", "Diminuer la quantité"],
    ["productCheckout", "increaseQuantity", "Increase quantity", "Augmenter la quantité"],
    ["shopOrders", "filtersLabel", "Filter orders", "Filtrer les commandes"],
    ["shopOrders", "ordersPaginationLabel", "Orders pages", "Pages des commandes"],
    ["shopOrders", "earningsPaginationLabel", "Earnings pages", "Pages des gains"],
  ];
  for (const [ns, key, en, fr] of keys) {
    assert.equal(translations.en[ns][key], en, `${ns}.${key} EN`);
    assert.equal(translations.fr[ns][key], fr, `${ns}.${key} FR`);
    assert.notEqual(translations.en[ns][key], translations.fr[ns][key]);
  }
  for (const ns of ["productCheckout", "shopOrders"]) assert.deepEqual(shape(translations.en[ns]), shape(translations.fr[ns]), ns);
});
await test("no hard-coded English accessibility text was introduced in the touched components", () => {
  for (const f of ["src/components/checkout/ProductCheckout.tsx", "src/components/shop/ShopOrdersView.tsx", "src/components/shop/ShopEarningsView.tsx", "src/components/catalog/CatalogSection.tsx"]) {
    const s = src(f);
    assert.ok(!/aria-label="(pagination|[−+]|View receipt|Increase quantity|Decrease quantity)"/.test(s), f);
    assert.ok(!/>View receipt</.test(s), f);
  }
});

console.log(`\ncommerceA11y: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
