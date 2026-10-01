// Safe text for the PDF renderer. The PDF uses the standard Helvetica fonts (WinAnsi / Windows-1252), which THROW on
// anything outside that set: narrow no-break spaces in French-locale money, emoji in shop names, Yoruba/Arabic/CJK names.
//
// IMPORTANT: this is applied ONLY when drawing. Stored database values (seller/customer snapshots, line descriptions,
// notes) are never sanitised — the database keeps the original UTF-8 exactly; the PDF falls back for glyphs it cannot draw.
//   DB "Chukwudi 😊" -> PDF "Chukwudi"          DB "12 000 FCFA" (U+202F) -> PDF "12 000 FCFA" (ASCII space)
//
// Policy (never throws, output contains only WinAnsi-encodable characters plus "\n" when multiline):
//   * all exotic spaces -> one ASCII space; control and invisible/format characters are removed
//   * WinAnsi-encodable characters are kept as they are (accents, ’ “ ” – — … œ Œ € ™ …)
//   * letters with a Latin decomposition fall back to the base letter (Ọ -> O, Ṣ -> S)
//   * emoji / pictographs / ZWJ sequences are dropped silently
//   * any other unsupported character becomes "?" (one "?" per run), so a non-Latin name is visibly "not printable"
//     rather than silently vanishing

const CP1252_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c,
  0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** Can the standard-font WinAnsi encoding draw this code point? (Soft hyphen is treated as invisible, not drawn.) */
export function isPdfEncodable(cp: number): boolean {
  if (cp >= 0x20 && cp <= 0x7e) return true;
  if (cp >= 0xa0 && cp <= 0xff) return cp !== 0xad;
  return CP1252_EXTRAS.has(cp);
}

const SPACE_LIKE = new Set([0x09, 0x0b, 0x0c, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000]);
const NEWLINE_LIKE = new Set([0x0a, 0x0d, 0x85, 0x2028, 0x2029]);
const PUNCT_MAP: Record<number, string> = {
  0x2010: "-", 0x2011: "-", 0x2012: "-", 0x2015: "-", 0x2212: "-",
  0x201b: "'", 0x2032: "'", 0x201f: '"', 0x2033: '"', 0x2044: "/",
};

function isInvisible(cp: number): boolean {
  return (
    cp === 0xad || cp === 0x180e || cp === 0xfeff ||
    (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x206f) || (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xe0000 && cp <= 0xe007f) || (cp >= 0xe0100 && cp <= 0xe01ef)
  );
}

// Built with the RegExp constructor so the source is not statically checked against the ES2017 compile target.
const EMOJI_LIKE = new RegExp("[\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\u{1F1E6}-\\u{1F1FF}\\u20E3\\u200D]", "u");
const MARK = new RegExp("^\\p{M}$", "u");

/** Base-letter fallback via NFD, or null if some part is still not drawable. */
function foldToEncodable(ch: string): string | null {
  const parts = Array.from(ch.normalize("NFD"));
  let out = "";
  for (const p of parts) {
    const cp = p.codePointAt(0)!;
    if (MARK.test(p)) continue;
    if (!isPdfEncodable(cp)) return null;
    out += p;
  }
  return out.length > 0 && out !== ch ? out : null;
}

export function toPdfText(input: unknown, opts: { maxLength?: number; multiline?: boolean } = {}): string {
  let s = typeof input === "string" ? input : typeof input === "number" || typeof input === "bigint" || typeof input === "boolean" ? String(input) : "";
  try {
    s = s.normalize("NFC");
  } catch {
    // normalisation cannot throw for strings, but the renderer must never depend on that
  }
  const out: string[] = [];
  let unknownRun = false;
  const push = (t: string) => {
    out.push(t);
    unknownRun = false;
  };

  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) continue; // lone surrogate
    if (NEWLINE_LIKE.has(cp)) { push(opts.multiline ? "\n" : " "); continue; }
    if (SPACE_LIKE.has(cp)) { push(" "); continue; }
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue; // control characters
    if (isInvisible(cp)) continue;
    if (isPdfEncodable(cp)) { push(ch); continue; }
    if (PUNCT_MAP[cp]) { push(PUNCT_MAP[cp]); continue; }
    if (EMOJI_LIKE.test(ch) || MARK.test(ch)) continue; // pictographs and stray combining marks: dropped
    const folded = foldToEncodable(ch);
    if (folded) { push(folded); continue; }
    if (!unknownRun) { out.push("?"); unknownRun = true; }
  }

  let text = out.join("");
  if (opts.multiline) {
    text = text.split("\n").map((l) => l.replace(/ {2,}/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  } else {
    text = text.replace(/ {2,}/g, " ").trim();
  }
  const max = opts.maxLength;
  if (typeof max === "number" && max > 0 && text.length > max) text = text.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
  return text;
}

/** Download filename: letters, digits, dot, dash and underscore only. */
export function safeFilename(name: string, fallback = "document"): string {
  const cleaned = toPdfText(name).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+|_+$/g, "").slice(0, 80);
  return cleaned || fallback;
}
