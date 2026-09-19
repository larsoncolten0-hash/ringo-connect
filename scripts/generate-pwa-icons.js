// Generates every icon file the PWA manifests, iOS meta tags, and browser
// tab favicon reference, from the official Ringo R symbol
// (public/brand/ringo-symbol.png — extracted unchanged from the approved
// logo). App identity is the R symbol ONLY, never the full wordmark.
//
//   node scripts/generate-pwa-icons.js
//
// Regenerate any time public/brand/ringo-symbol.png changes.

const sharp = require("sharp");
const toIco = require("to-ico");
const path = require("path");
const fs = require("fs");

const SRC = path.join(__dirname, "..", "public", "brand", "ringo-symbol.png");
const OUT = path.join(__dirname, "..", "public");
const APP_FAVICON = path.join(__dirname, "..", "src", "app", "favicon.ico");

if (!fs.existsSync(SRC)) {
  console.error(`Couldn't find ${SRC}.`);
  process.exit(1);
}

// The R centered on a solid white square, at `fill` of the canvas width.
// Never stretched: the symbol is square and is only ever scaled uniformly.
async function symbolOnWhite(size, fill) {
  const inner = Math.round(size * fill);
  const symbol = await sharp(SRC).resize(inner, inner, { kernel: "lanczos3" }).toBuffer();
  const offset = Math.round((size - inner) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: "#FFFFFF" } })
    .composite([{ input: symbol, left: offset, top: offset }])
    .flatten({ background: "#FFFFFF" })
    .png();
}

async function run() {
  // "any" icons: white square with comfortable padding around the R.
  await (await symbolOnWhite(512, 0.62)).toFile(path.join(OUT, "icon-512.png"));
  await (await symbolOnWhite(192, 0.62)).toFile(path.join(OUT, "icon-192.png"));

  // iOS "Add to Home Screen" — Apple flattens transparency to black, so
  // this is opaque white.
  await (await symbolOnWhite(180, 0.62)).toFile(path.join(OUT, "apple-touch-icon.png"));

  // Maskable: Android crops this into circles/squircles, so the R stays
  // inside the inner ~52% (well within the 80% safe zone).
  await (await symbolOnWhite(512, 0.52)).toFile(path.join(OUT, "icon-maskable-512.png"));

  // favicon.ico — transparent, R fills the tab icon. Multi-resolution.
  const buffers = await Promise.all(
    [16, 32, 48].map((s) => sharp(SRC).resize(s, s, { kernel: "lanczos3" }).png().toBuffer())
  );
  const ico = await toIco(buffers);
  fs.writeFileSync(path.join(OUT, "favicon.ico"), ico);
  fs.writeFileSync(APP_FAVICON, ico);

  console.log("Generated: icon-192.png, icon-512.png, apple-touch-icon.png, icon-maskable-512.png, favicon.ico (public + src/app)");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
