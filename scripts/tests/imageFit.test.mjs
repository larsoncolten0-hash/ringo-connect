// Image display + optimisation guard: link icons and product / merch photos must show whole and fixed-size; resizing must stay safe.
// Run: node scripts/tests/imageFit.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const raw = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
let passed = 0;
const failures = [];
const test = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };
const lineWith = (rel, needle) => { const l = raw(rel).split("\n").filter((x) => x.includes(needle)); assert.ok(l.length, `${rel}: no line with ${needle}`); return l; };

// ---- link icons: fixed, never shrunk or enlarged, whole image visible, contrast background that follows the theme
for (const [rel, px] of [["src/components/ProfileView.tsx", 56], ["src/components/music/profile/MusicSections.tsx", 44]]) {
  test(`${rel}: the link icon has intrinsic ${px}px size, cannot shrink or grow, and FILLS its square (object-cover, square crop, no padding)`, () => {
    const l = lineWith(rel, "link.image_url} width=").join("\n");
    assert.ok(l.includes(`width={${px}} height={${px}}`) && l.includes("shrink-0") && l.includes("object-cover") && !l.includes("object-contain") && l.includes(" square ") && !l.includes(" p-"));
    assert.ok(/max-w-/.test(l) && /max-h-/.test(l) && l.includes("currentColor"));
  });
}

// ---- product / merch photography: whole product shown, no hover zoom
const PRODUCT_SITES = [
  ["src/components/catalog/ProductDetailView.tsx", "snap-center"],
  ["src/components/catalog/ProductDetailView.tsx", "alt={r.name}"],
  ["src/components/shop/ShopDestination.tsx", "images[0]"],
  ["src/components/music/MusicStorePage.tsx", "imgClassName"],
];
for (const [rel, needle] of PRODUCT_SITES) {
  test(`${rel} (${needle}): product photo uses object-contain, no object-cover and no hover zoom`, () => {
    const l = raw(rel).split("\n").filter((x) => x.includes(needle) && /object-(contain|cover)/.test(x)).join("\n");
    assert.ok(l, "site not found");
    assert.ok(l.includes("object-contain") && !l.includes("object-cover") && !/group-hover:scale|hover:scale/.test(l));
  });
}
test("catalog tile (multi-line OptImg): fills its frame (object-cover), no hover zoom", () => {
  const src = raw("src/components/catalog/CatalogSection.tsx");
  const from = src.indexOf("alt={product.name}");
  const m = from < 0 ? null : /className=\{`([^`]*)`\}/.exec(src.slice(from));
  assert.ok(m && m[1].includes("object-cover") && !m[1].includes("object-contain") && !/scale/.test(m[1]));
});
test("product detail gallery frame has a tinted ground so a contained photo has no bare edges", () => {
  assert.ok(/<div className=\{frame\} style=\{\{ backgroundColor: hexToRgba\(fg, 0\.06\) \}\}>/.test(raw("src/components/catalog/ProductDetailView.tsx")));
});
test("intentional crops are left alone: artwork, covers, avatars and restaurant (food) photos", () => {
  assert.ok(raw("src/components/music/ReleasesSection.tsx").includes("object-cover"));
  assert.ok(raw("src/components/restaurant/MenuItemDetailView.tsx").includes('imgClassName="object-cover"'));
  assert.ok(raw("src/components/shop/ShopDestination.tsx").includes("square priority className=\"h-full w-full object-cover\""));
});

// ---- editor previews match the public page
test("editor: link preview uses fit=contain, ImageUploadField previews through OptImg with a fixed size, product previews are contained", () => {
  assert.ok(raw("src/components/editor/LinkRow.tsx").includes('fit="contain"'));
  const f = raw("src/components/editor/ImageUploadField.tsx");
  assert.ok(f.includes('import OptImg') && f.includes("<OptImg src={value} width={size} height={size}") && f.includes('fit = "cover"'));
  assert.ok(lineWith("src/components/editor/ProductRow.tsx", "<img src={product.image_urls").join("").includes("object-contain"));
  assert.ok(lineWith("src/components/editor/ImageGalleryUploadField.tsx", "<img src={url}").join("").includes("object-contain"));
});

// ---- optimisation stays safe
const U = jiti(path.join(SRC, "lib/imageUrl.ts"));
const D = jiti(path.join(SRC, "lib/imageDownscale.ts"));
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
const own = (p) => `https://proj.supabase.co/storage/v1/object/public/uploads/${p}`;
test("imageUrl: only own public raster uploads are resized; svg, gif, external, query and other buckets are returned unchanged", () => {
  assert.ok(U.isTransformableImage(own("u/links/a.png")) && U.isTransformableImage(own("u/links/a.webp")));
  for (const bad of [own("u/a.svg"), own("u/a.gif"), own("u/a.png?v=1"), "https://example.com/a.png", "https://proj.supabase.co/storage/v1/object/public/other/a.png", "data:image/png;base64,AA", ""])
    assert.ok(!U.isTransformableImage(bad), bad);
  assert.strictEqual(U.transformedImageUrl("https://example.com/a.png", { width: 100 }), "https://example.com/a.png");
});
test("imageUrl: `square` crops; `contain` asks for the whole picture; a bare width is unchanged (Supabase answers it with the ORIGINAL height, a centred crop)", () => {
  const free = new URL(U.transformedImageUrl(own("u/a.png"), { width: 200 }));
  assert.ok(!free.searchParams.has("height") && !free.searchParams.has("resize"), "default URL must stay exactly as before");
  const sq = new URL(U.transformedImageUrl(own("u/a.png"), { width: 200, square: true }));
  assert.ok(sq.searchParams.get("resize") === "cover" && sq.searchParams.get("height") === "200");
  const whole = new URL(U.transformedImageUrl(own("u/a.png"), { width: 200, contain: true }));
  assert.ok(whole.searchParams.get("resize") === "contain" && whole.searchParams.get("width") === "200" && !whole.searchParams.has("height"));
  const both = new URL(U.transformedImageUrl(own("u/a.png"), { width: 200, square: true, contain: true }));
  assert.ok(both.searchParams.get("resize") === "cover", "square keeps winning, so avatars are untouched");
  assert.strictEqual(U.transformedImageUrl("https://example.com/a.png", { width: 200, contain: true }), "https://example.com/a.png");
});
test("imageUrl: every srcset candidate of a `contain` image keeps resize=contain (1x/2x/3x and fluid widths)", () => {
  const dens = U.imageDensitySrcSet(own("u/a.png"), 56, { contain: true }).split(", ");
  const fluid = U.imageSrcSet(own("u/a.png"), [240, 400, 640], { contain: true }).split(", ");
  assert.ok(dens.length === 3 && fluid.length === 3 && [...dens, ...fluid].every((c) => c.includes("resize=contain")));
  assert.ok(!U.imageDensitySrcSet(own("u/a.png"), 56).includes("resize"), "no flag, no change");
});
test("OptImg forwards `contain` to the fallback src, the density srcset and the fluid srcset", () => {
  const o = raw("src/components/ui/OptImg.tsx");
  assert.ok(/contain\?: boolean/.test(o) && o.includes("contain = false"));
  assert.ok(o.includes("transformedImageUrl(src, { width: fallbackWidth, square, contain })"));
  assert.ok(o.includes("imageDensitySrcSet(src, cssWidth, { square, contain })") && o.includes("imageSrcSet(src, widths, { square, contain })"));
});
test("Links and Merch (profile) fill their frame: link icons and the merch grid use a square crop + object-cover, the 4:5 catalog tile uses the whole-picture resize + object-cover", () => {
  assert.ok(/<OptImg src=\{link\.image_url\} width=\{56\} height=\{56\} cssWidth=\{56\} square className="[^"]*object-cover/.test(raw("src/components/ProfileView.tsx")));
  const ms = raw("src/components/music/profile/MusicSections.tsx");
  assert.ok(/<OptImg src=\{link\.image_url\} width=\{44\} height=\{44\} cssWidth=\{44\} square className="[^"]*object-cover/.test(ms));
  assert.ok(/<OptImg src=\{img\} widths=\{\[200, 360, 540\]\} sizes="[^"]*" square className="h-full w-full object-cover"/.test(ms));
  const cs = raw("src/components/catalog/CatalogSection.tsx");
  const from = cs.indexOf("alt={product.name}");
  assert.ok(from > 0 && /sizes=[^\n]*\n\s*contain\n/.test(cs.slice(from)), "non-square frame: the transform keeps the aspect ratio, object-cover then fills it");
});
test("downscale: svg and gif are never touched; small images are not enlarged; aspect ratio is kept", () => {
  assert.strictEqual(D.planDownscale({ type: "image/svg+xml", size: 9e6 }, { width: 4000, height: 4000 }), null);
  assert.strictEqual(D.planDownscale({ type: "image/gif", size: 9e6 }, { width: 4000, height: 4000 }), null);
  assert.strictEqual(D.planDownscale({ type: "image/png", size: 9e6 }, { width: 800, height: 600 }), null);
  const p = D.planDownscale({ type: "image/jpeg", size: 4e6 }, { width: 4000, height: 3000 });
  assert.deepStrictEqual(p, { width: 1600, height: 1200 });
  assert.ok(D.planDownscale({ type: "image/png", size: 4e6 }, { width: 100, height: 100 }, { reencode: true, minBytes: 1 }).width === 100);
  assert.strictEqual(D.uploadKindForFolder("links"), null);
});

if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} FAILED`); process.exit(1); }
console.log(`imageFit: ${passed} passed`);
