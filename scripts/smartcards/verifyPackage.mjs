// Independent, READ-ONLY verification of a generated Smart Card package, run from the files on disk (not from the generator's memory).
//
//   node scripts/smartcards/verifyPackage.mjs --dir <batch directory> [--origin https://www.ringoconnectltd.com] [--count 500]
//
// It re-reads manifest.csv, decodes EVERY PNG and every SVG, and checks each decoded URL against the manifest row for the same serial; it also checks that the SHA-256
// of each token equals the hash in PRIVATE_DO_NOT_SHARE/import_<batch>.json (what the database will hold). It writes nothing and prints only counts, never a token.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const jsQR = require("jsqr");
const { PNG } = require("pngjs");
const sharp = require("sharp");
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const dir = arg("dir");
const origin = (arg("origin", "https://www.ringoconnectltd.com") || "").replace(/\/+$/, "");
const count = Number(arg("count", "500"));
if (!dir) throw new Error("--dir <batch directory> is required");

const SUP = path.join(path.resolve(dir), "SUPPLIER_PACKAGE");
const PRIV = path.join(path.resolve(dir), "PRIVATE_DO_NOT_SHARE");
const checks = [];
const add = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail });
const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

const lines = fs.readFileSync(path.join(SUP, "manifest.csv"), "utf8").trim().split(/\r?\n/);
const header = lines.shift();
const rows = lines.map((l) => { const [serial, png, svg, ...rest] = l.split(","); return { serial, png, svg, url: rest.join(",") }; });
add("manifest header is serial,qr_png_file,qr_svg_file,qr_url", header === "serial,qr_png_file,qr_svg_file,qr_url");
add(`manifest has exactly ${count} rows`, rows.length === count, String(rows.length));
add("serials are RINGO-0001.. in order, none missing or repeated", rows.every((r, i) => r.serial === `RINGO-${String(i + 1).padStart(4, "0")}`));
add("serials are unique", new Set(rows.map((r) => r.serial)).size === count);
add("URLs are unique", new Set(rows.map((r) => r.url)).size === count);
const urlRe = new RegExp("^" + origin.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "/c/[A-Za-z0-9_-]{27}$");
add(`every URL is exactly ${origin}/c/<27-character token>`, rows.every((r) => urlRe.test(r.url)));
const tokenOf = (u) => u.slice(u.lastIndexOf("/") + 1);
add("tokens are unique", new Set(rows.map((r) => tokenOf(r.url))).size === count);
add("manifest file names equal the serial", rows.every((r) => r.png === `qr_png/${r.serial}.png` && r.svg === `qr_vector_svg/${r.serial}.svg`));
const pngFiles = fs.readdirSync(path.join(SUP, "qr_png")), svgFiles = fs.readdirSync(path.join(SUP, "qr_vector_svg"));
add(`qr_png holds exactly ${count} files, all in the manifest`, pngFiles.length === count && pngFiles.every((f) => rows.some((r) => r.png === `qr_png/${f}`)));
add(`qr_vector_svg holds exactly ${count} files, all in the manifest`, svgFiles.length === count && svgFiles.every((f) => rows.some((r) => r.svg === `qr_vector_svg/${f}`)));

let pngBad = [], svgBad = [], sizeBad = [];
for (const r of rows) {
  const png = PNG.sync.read(fs.readFileSync(path.join(SUP, r.png)));
  if (png.width !== png.height || png.width < 800) sizeBad.push(r.serial);
  const a = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!a || a.data !== r.url) pngBad.push(r.serial);
  const raster = await sharp(path.join(SUP, r.svg), { density: 300 }).flatten({ background: "#ffffff" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = jsQR(new Uint8ClampedArray(raster.data), raster.info.width, raster.info.height);
  if (!b || b.data !== r.url) svgBad.push(r.serial);
}
add(`all ${count} PNG codes decode to their own manifest URL`, pngBad.length === 0, pngBad.slice(0, 5).join(" "));
add(`all ${count} SVG codes decode to their own manifest URL`, svgBad.length === 0, svgBad.slice(0, 5).join(" "));
add("every PNG is square and at least 800 px", sizeBad.length === 0, sizeBad.slice(0, 5).join(" "));

const privFiles = fs.readdirSync(PRIV).filter((f) => /^import_.+\.json$/.test(f));
add("exactly one import_<batch>.json in the private folder", privFiles.length === 1);
if (privFiles.length === 1) {
  const imp = JSON.parse(fs.readFileSync(path.join(PRIV, privFiles[0]), "utf8"));
  add(`import file has exactly ${count} rows with only serial and token_hash`, Array.isArray(imp.rows) && imp.rows.length === count && imp.rows.every((x) => Object.keys(x).sort().join() === "serial,token_hash"));
  add("each import hash equals SHA-256 of the token in that serial's QR URL", imp.rows.every((x, i) => x.serial === rows[i].serial && x.token_hash === sha(tokenOf(rows[i].url))));
  add("import hashes are unique 64-hex values", new Set(imp.rows.map((x) => x.token_hash)).size === count && imp.rows.every((x) => /^[0-9a-f]{64}$/.test(x.token_hash)));
  const privText = privFiles.concat(["token_hashes.csv"]).map((f) => fs.readFileSync(path.join(PRIV, f), "utf8")).join("\n");
  add("no raw token appears anywhere in the private folder", rows.every((r) => !privText.includes(tokenOf(r.url))));
}
const readme = fs.readFileSync(path.join(SUP, "README.txt"), "utf8");
add("README.txt contains no token and no URL", rows.every((r) => !readme.includes(tokenOf(r.url))) && !/https?:\/\//.test(readme));

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.ok || !c.detail ? "" : "  [" + c.detail + "]"}`);
console.log(failed.length ? `RESULT: ${failed.length} CHECK(S) FAILED` : `RESULT: ALL ${checks.length} CHECKS PASSED`);
process.exit(failed.length ? 1 : 0);
