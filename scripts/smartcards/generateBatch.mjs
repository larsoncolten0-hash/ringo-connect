// Generates a batch of Ringo Smart Cards: serials, secret tokens, QR images, the supplier package and the private hash file. LOCAL ONLY: it never connects to a
// database or any network service, and it refuses to overwrite an existing output directory.
//
//   node scripts/smartcards/generateBatch.mjs --out <new directory> --origin https://www.ringoconnectltd.com [--batch batch-001] [--count 500]
//
// Output (the directory is created OUTSIDE the repository; never commit it):
//   <out>/SUPPLIER_PACKAGE/   qr_png/RINGO-0001.png ...   qr_vector_svg/RINGO-0001.svg ...   manifest.csv   contact_sheet_NN.png   README.txt   integrity_report.txt
//                             NOTE: the QR images (and the URLs in manifest.csv) necessarily contain the live card tokens. Treat the whole package as CONFIDENTIAL.
//   <out>/PRIVATE_DO_NOT_SHARE/ token_hashes.csv   import_<batch>.json   (SHA-256 hashes only: what the database stores. No raw token is written here.)
//
// The only thing printed to the console is counts and pass/fail: never a token.
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true, cache: false });
const T = jiti(path.join(REPO, "src/lib/smartCards/token.ts"));
const QR = require("qrcode");
const sharp = require("sharp");
const jsQR = require("jsqr");
const { PNG } = require("pngjs");

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const out = arg("out");
const origin = (arg("origin", "") || "").replace(/\/+$/, "");
const batch = arg("batch", "batch-001");
const count = Number(arg("count", String(T.CARD_BATCH_SIZE)));

// ---- guards: a verified production origin only; never localhost, a preview URL or a guess
const ALLOWED_ORIGINS = new Set(["https://www.ringoconnectltd.com", "https://ringoconnectltd.com"]);
if (!out) throw new Error("--out <directory> is required");
if (!ALLOWED_ORIGINS.has(origin)) throw new Error(`--origin must be exactly one of: ${[...ALLOWED_ORIGINS].join(", ")}`);
if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(batch)) throw new Error("--batch must look like batch-001");
if (!Number.isInteger(count) || count < 1 || count > 9999) throw new Error("--count must be 1..9999");
const absOut = path.resolve(out);
if (absOut.startsWith(path.resolve(REPO) + path.sep) || absOut === path.resolve(REPO)) throw new Error("the output directory must be OUTSIDE the repository (it holds live tokens)");
if (fs.existsSync(absOut)) throw new Error(`refusing to overwrite: ${absOut} already exists`);

const SUP = path.join(absOut, "SUPPLIER_PACKAGE");
const PRIV = path.join(absOut, "PRIVATE_DO_NOT_SHARE");
for (const d of [path.join(SUP, "qr_png"), path.join(SUP, "qr_vector_svg"), PRIV]) fs.mkdirSync(d, { recursive: true });

// ---- 1. serials and tokens (CSPRNG; regenerate on the astronomically unlikely duplicate)
const cards = [];
const seenTokens = new Set();
for (let n = 1; n <= count; n++) {
  let token;
  do token = T.generateCardToken(); while (seenTokens.has(token));
  seenTokens.add(token);
  cards.push({ serial: T.cardSerial(n), token, hash: T.hashCardToken(token), url: T.cardUrl(origin, token), file: `${T.cardSerial(n)}.png`, svg: `${T.cardSerial(n)}.svg` });
}

// ---- 2. QR images: black on white, error correction M, 4-module quiet zone, NO logo or decoration inside. 30 px per module, then tagged at 1200 dpi.
const QR_OPTS = { errorCorrectionLevel: "M", margin: 4, color: { dark: "#000000", light: "#FFFFFF" } };
for (const c of cards) {
  const png = await QR.toBuffer(c.url, { ...QR_OPTS, type: "png", scale: 30 });
  fs.writeFileSync(path.join(SUP, "qr_png", c.file), await sharp(png).png({ compressionLevel: 9 }).withMetadata({ density: 1200 }).toBuffer());
  fs.writeFileSync(path.join(SUP, "qr_vector_svg", c.svg), await QR.toString(c.url, { ...QR_OPTS, type: "svg" }));
}

// ---- 3. manifests
const csv = (rows) => rows.map((r) => r.join(",")).join("\r\n") + "\r\n";
fs.writeFileSync(path.join(SUP, "manifest.csv"), csv([["serial", "qr_png_file", "qr_svg_file", "qr_url"], ...cards.map((c) => [c.serial, `qr_png/${c.file}`, `qr_vector_svg/${c.svg}`, c.url])]));
fs.writeFileSync(path.join(PRIV, "token_hashes.csv"), csv([["serial", "token_sha256", "batch"], ...cards.map((c) => [c.serial, c.hash, batch])]));
fs.writeFileSync(path.join(PRIV, `import_${batch}.json`), JSON.stringify({ batch, rows: cards.map((c) => ({ serial: c.serial, token_hash: c.hash })) }, null, 1));

// ---- 4. contact sheets (25 per page: 5 x 5), each tile labelled with its serial
const PER = 25, COLS = 5, TILE = 320, LABEL = 44, PAD = 24;
const sheets = Math.ceil(cards.length / PER);
for (let s = 0; s < sheets; s++) {
  const slice = cards.slice(s * PER, (s + 1) * PER);
  const rows = Math.ceil(slice.length / COLS);
  const W = COLS * (TILE + PAD) + PAD, Hh = rows * (TILE + LABEL + PAD) + PAD + 60;
  const layers = [];
  const title = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="60"><rect width="100%" height="100%" fill="#FFFFFF"/><text x="${PAD}" y="38" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="#4F46E5">Ringo Smart Cards · ${batch} · ${slice[0].serial} to ${slice[slice.length - 1].serial} · sheet ${s + 1}/${sheets}</text></svg>`;
  layers.push({ input: Buffer.from(title), left: 0, top: 0 });
  for (let i = 0; i < slice.length; i++) {
    const x = PAD + (i % COLS) * (TILE + PAD), y = 60 + PAD + Math.floor(i / COLS) * (TILE + LABEL + PAD);
    layers.push({ input: await sharp(path.join(SUP, "qr_png", slice[i].file)).resize(TILE, TILE, { kernel: "nearest" }).png().toBuffer(), left: x, top: y });
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${LABEL}"><text x="${TILE / 2}" y="30" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" fill="#111111">${slice[i].serial}</text></svg>`), left: x, top: y + TILE });
  }
  await sharp({ create: { width: W, height: Hh, channels: 3, background: "#FFFFFF" } }).composite(layers).png().toFile(path.join(SUP, `contact_sheet_${String(s + 1).padStart(2, "0")}.png`));
}

// ---- 5. integrity checks: decode EVERY image back and compare it with its serial's URL
const checks = [];
const add = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail });
const files = fs.readdirSync(path.join(SUP, "qr_png")).filter((f) => f.endsWith(".png"));
const svgs = fs.readdirSync(path.join(SUP, "qr_vector_svg")).filter((f) => f.endsWith(".svg"));
const manifest = fs.readFileSync(path.join(SUP, "manifest.csv"), "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
let decodeOk = 0, mismatch = [];
for (const c of cards) {
  const png = PNG.sync.read(fs.readFileSync(path.join(SUP, "qr_png", c.file)));
  const res = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (res && res.data === c.url) decodeOk++; else mismatch.push(c.serial);
}
add(`exactly ${count} card records`, cards.length === count && manifest.length === count);
add(`exactly ${count} PNG files, one per serial`, files.length === count && cards.every((c) => files.includes(c.file)));
add(`exactly ${count} SVG files, one per serial`, svgs.length === count);
add("serials run RINGO-0001 .. in sequence with no gaps or duplicates", new Set(cards.map((c) => c.serial)).size === count && cards.every((c, i) => c.serial === T.cardSerial(i + 1)));
add("no duplicate tokens", new Set(cards.map((c) => c.token)).size === count);
add("no duplicate token hashes", new Set(cards.map((c) => c.hash)).size === count);
add("no duplicate QR URLs", new Set(cards.map((c) => c.url)).size === count);
add("every token is well formed (27 chars, base64url, 160 bits)", cards.every((c) => T.isWellFormedCardToken(c.token)));
add(`every URL is exactly ${origin}/c/<token> (the opaque token only: no username, serial or other data)`, cards.every((c) => c.url === `${origin}/c/${c.token}`));
add("the manifest row for each serial points to that serial's own image and URL", manifest.every(([serial, png, svg, url], i) => serial === cards[i].serial && png === `qr_png/${cards[i].file}` && svg === `qr_vector_svg/${cards[i].svg}` && url === cards[i].url));
add("every stored hash is the SHA-256 of its token", cards.every((c) => T.hashCardToken(c.token) === c.hash));
add(`all ${count} QR images decode to their own URL`, decodeOk === count, mismatch.slice(0, 5).join(" "));
add(`${sheets} contact sheet(s) written`, fs.readdirSync(SUP).filter((f) => /^contact_sheet_\d+\.png$/.test(f)).length === sheets);
const privText = fs.readFileSync(path.join(PRIV, "token_hashes.csv"), "utf8") + fs.readFileSync(path.join(PRIV, `import_${batch}.json`), "utf8");
add("the private files contain hashes only (no raw token appears in them)", cards.every((c) => !privText.includes(c.token)));

const lines = [`Ringo Smart Cards · ${batch} · integrity report`, `Origin: ${origin}`, `Cards: ${count}`, "", ...checks.map((c) => `${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.ok || !c.detail ? "" : "  [" + c.detail + "]"}`), "", checks.every((c) => c.ok) ? "RESULT: ALL CHECKS PASSED" : "RESULT: FAILURES PRESENT: DO NOT PRINT"];
fs.writeFileSync(path.join(SUP, "integrity_report.txt"), lines.join("\r\n") + "\r\n");

// ---- 6. README for the supplier (no tokens)
fs.writeFileSync(path.join(SUP, "README.txt"), [
  `RINGO CONNECT SMART CARDS · QR PRINT PACKAGE · ${batch}`,
  "",
  `CONFIDENTIAL. Each QR code is the secret key of one card. Do not publish, post, forward or reuse these files, and delete them when the order is complete.`,
  "",
  "WHAT IS IN THIS PACKAGE",
  `  qr_png/            ${count} QR images, one per card, named by the card's serial number (RINGO-0001.png ... RINGO-${String(count).padStart(4, "0")}.png). 1230 x 1230 px, tagged 1200 dpi (26 mm).`,
  `  qr_vector_svg/     the same ${count} codes as vectors (SVG) for the sharpest print. Use PNG or SVG, not both.`,
  "  manifest.csv       serial, image file names. One row per card. The file name IS the serial.",
  "  contact_sheet_NN.png   overview sheets (25 codes each) for a quick visual check. NOT for printing.",
  "  integrity_report.txt   the automatic checks run before this package was released.",
  "",
  "NUMBERING",
  `  Serial numbers run from RINGO-0001 to RINGO-${String(count).padStart(4, "0")}. Print the serial on the card (small, human-readable, on the back is fine) so each card can be matched to its code. The serial is only a label; the QR is the key.`,
  "",
  "HOW TO PRINT AND MATCH",
  "  1. Print file RINGO-0001.png on the card marked RINGO-0001, RINGO-0002.png on RINGO-0002, and so on. Never reorder, skip, reuse or duplicate a code.",
  "  2. Keep the QR in black on a plain white square with the white border that is part of the image (the 'quiet zone', 4 modules wide). Do NOT crop it, recolour it, invert it, add a logo or pattern inside it, or place it on a coloured or glossy-reflective background without a white box.",
  "  3. Print size: between 20 mm and 30 mm square (including the white border). Never below 18 mm. Use a sharp, dark, matte or satin black. Do not use gradients or screen the black.",
  "  4. Test: scan a sample from EACH print run (the first, the middle and the last cards) with at least two different phones, in normal indoor light, from about 10 to 15 cm. Each must open a Ringo page (a card activation page, or an 'unavailable' page; never a browser error).",
  "  5. If any code fails to scan, stop and contact Ringo Connect before printing more. Do not try to repair or regenerate a code yourself.",
  "  6. Keep a spoilage note: if a card is damaged, write its serial down and return the spoiled card. A serial is never reused on a different card.",
  "",
  "WHEN THE ORDER IS FINISHED",
  "  Send Ringo Connect the list of serials that were printed (and any spoiled ones). Then delete these files.",
  "",
].join("\r\n"));

// ---- 7. restrictive permissions on the private folder (best effort; Windows ACL or POSIX mode)
try {
  if (process.platform === "win32") {
    const user = process.env.USERNAME || "";
    if (user) { execFileSync("icacls", [PRIV, "/inheritance:r", "/grant:r", `${user}:(OI)(CI)F`], { stdio: "ignore" }); }
  } else {
    fs.chmodSync(PRIV, 0o700);
    for (const f of fs.readdirSync(PRIV)) fs.chmodSync(path.join(PRIV, f), 0o600);
  }
} catch { /* permissions are best effort */ }

const failed = checks.filter((c) => !c.ok);
console.log(`batch ${batch}: ${cards.length} cards, ${checks.length - failed.length}/${checks.length} integrity checks passed`);
console.log(`output: ${absOut}`);
if (failed.length) { for (const f of failed) console.log("FAIL:", f.name); process.exit(1); }
