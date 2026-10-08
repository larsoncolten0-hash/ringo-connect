// The dictionaries used to be ONE file (src/lib/i18n/translations.ts). They now live in translations.en.ts and translations.fr.ts so the browser can load only the language it
// needs (the performance project), with translations.ts as the aggregate. Several older tests check the TEXT of the dictionaries (a key exists in both languages, an exact copy
// line is unchanged, which block a string sits in). This rebuilds the old single-file text from the two halves, exactly as it was (same lines, same order), so those checks keep
// asserting what they always asserted. Nothing here is new behaviour: it is only the old file, reassembled.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const readRepo = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

/** The lines between `export const <name>: ... = {` and the closing `};` of a dictionary module. */
function body(source, name) {
  const nl = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(nl);
  const start = lines.findIndex((l) => new RegExp(`^export const ${name}\\b.*= \\{$`).test(l));
  const end = lines.findIndex((l, i) => i > start && l === "};");
  if (start < 0 || end < 0) throw new Error(`cannot find the ${name} dictionary`);
  return { lines: lines.slice(start + 1, end), nl };
}

/** The old src/lib/i18n/translations.ts, rebuilt: header, `en: { ... }`, `fr: { ... }`, footer. */
export function legacyTranslationsSource() {
  const en = body(readRepo("src/lib/i18n/translations.en.ts"), "en");
  const fr = body(readRepo("src/lib/i18n/translations.fr.ts"), "fr");
  const nl = en.nl;
  return [
    'export type Locale = "en" | "fr";',
    "",
    "export const translations = {",
    "  en: {",
    ...en.lines,
    "  },",
    "  fr: {",
    ...fr.lines,
    "  },",
    "} satisfies Record<Locale, any>;",
    "",
    "export type Translations = typeof translations.en;",
  ].join(nl);
}
