// Generates every icon file the PWA manifest, iOS meta tags, and browser
// tab favicon reference, from your existing public/logo.png. Run once:
//
//   npm install --save-dev sharp to-ico
//   node scripts/generate-pwa-icons.js
//
// Regenerate any time you update logo.png.

const sharp = require("sharp");
const toIco = require("to-ico");
const path = require("path");
const fs = require("fs");

const SRC = path.join(__dirname, "..", "public", "logo.png");
const OUT = path.join(__dirname, "..", "public");

if (!fs.existsSync(SRC)) {
  console.error(`Couldn't find ${SRC} — make sure logo.png is in the public/ folder first.`);
  process.exit(1);
}

async function run() {
  // Standard icons — used as-is, no padding needed.
  await sharp(SRC).resize(192, 192).png().toFile(path.join(OUT, "icon-192.png"));
  await sharp(SRC).resize(512, 512).png().toFile(path.join(OUT, "icon-512.png"));

  // iOS "Add to Home Screen" icon. Apple flattens transparency to black,
  // so if logo.png has a transparent background, this composites it onto
  // white first to avoid an ugly black-square icon on iOS.
  await sharp(SRC)
    .resize(180, 180)
    .flatten({ background: "#FFFFFF" })
    .png()
    .toFile(path.join(OUT, "apple-touch-icon.png"));

  // Maskable icon: Android crops this into circles/squircles/etc.
  // depending on the device, so the logo needs to sit inside a safe
  // zone — roughly the inner 80% of the canvas — or risk being clipped.
  // This resizes the logo down and pads it onto a solid brand-color
  // canvas rather than shipping the raw logo at full bleed.
  const size = 512;
  const logoSize = Math.round(size * 0.7); // inner ~70%, safely within the ~80% safe zone
  const offset = Math.round((size - logoSize) / 2);

  const resizedLogo = await sharp(SRC).resize(logoSize, logoSize).toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: "#4F46E5", // Ringo indigo — swap if your brand color changes
    },
  })
    .composite([{ input: resizedLogo, left: offset, top: offset }])
    .png()
    .toFile(path.join(OUT, "icon-maskable-512.png"));

  // favicon.ico — browser tab icon. sharp can't output .ico directly (it
  // only does PNG/JPEG/WebP/etc.), so this generates the sizes browsers
  // actually look for inside a real favicon (16/32/48px — all valid
  // to-ico sizes) and packs them into one proper multi-resolution .ico —
  // a plain renamed PNG would look blurry at the small tab size.
  const faviconSizes = [16, 32, 48];
  const faviconBuffers = await Promise.all(
    faviconSizes.map((s) => sharp(SRC).resize(s, s).png().toBuffer())
  );
  const icoBuffer = await toIco(faviconBuffers);
  fs.writeFileSync(path.join(OUT, "favicon.ico"), icoBuffer);

  console.log(
    "Generated: icon-192.png, icon-512.png, apple-touch-icon.png, icon-maskable-512.png, favicon.ico"
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});